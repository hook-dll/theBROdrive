import * as THREE from 'three';
import budget from '../../config/program-budget.json';

/**
 * THE SHADER PROGRAM BUDGET (dev builds only): every program the game links, by tier,
 * against the list it is allowed (`config/program-budget.json`).
 *
 * A material is nearly free; a program is not. Each new combination of a material's
 * type and flags (`vertexColors`, a map, `flatShading`, `transparent`, `side`, an
 * `onBeforeCompile` patch, instancing...) is a program of its own: linked behind the
 * loading cover it lengthens the boot, linked mid-drive it is a 300-800 ms freeze on
 * ANGLE (.omp/rules/shader-variants.md), and every one is a switch in the frame. New
 * scenery that could have used a material already in the game (the flat palette, the
 * props' vertex colours, the sign atlas...) shows up here as a NEW program:
 *
 *  - after the boot, every program not on the tier's list is reported with
 *    `console.error`, with the materials drawing with it, so it can be found in the
 *    source and moved onto a shared material; or, when it is truly needed, added to the
 *    list (`tools/look/programs.mjs --write`), on purpose and in the same commit;
 *  - after that, any program linked during the drive is reported the same way: a
 *    variant first seen mid-drive is the freeze itself, whatever the list says.
 *
 * A program is named by a hash of three's own cache key, which holds its shader source
 * and every parameter that selects it, and nothing per material or per run. The one
 * parameter that is the DEVICE's, not the game's, is left out: whether the context
 * draws with the reversed depth buffer (render/depthconvention.ts), so one list holds on
 * a machine with EXT_clip_control and on one without (`budgetKey`).
 */

export interface ProgramEntry {
  readonly id: string;
  /** What draws with it, for a reader: the first few materials found using it. */
  readonly label: string;
}

type Budget = Readonly<Record<string, readonly ProgramEntry[]>>;

interface LiveProgram {
  readonly cacheKey: string;
  readonly name: string;
}

function hash(text: string): string {
  // FNV-1a, 32 bits twice over (forwards, then backwards) for a 64-bit name.
  let a = 0x811c9dc5;
  let b = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    a = Math.imul(a ^ text.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ text.charCodeAt(text.length - 1 - i), 0x01000193);
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}

/**
 * Parameters three r185 writes into a cache key from the precision on
 * (`getProgramCacheKeyParameters`); the two flag masks follow them.
 */
const KEY_PARAMETERS = 48;
/** `reversedDepthBuffer`'s bit in the second mask (`getProgramCacheKeyBooleans`). */
const REVERSED_DEPTH_BIT = 1 << 4;

/**
 * `cacheKey` with the reversed-depth flag cleared. The key is comma-joined: the shader
 * ids, the defines, then (not for a raw shader) the precision, `KEY_PARAMETERS - 1` more
 * parameters and the two masks; the defines' length varies, so the precision is found by
 * its value.
 */
function budgetKey(cacheKey: string): string {
  const parts = cacheKey.split(',');
  const precision = parts.findIndex((part) => part === 'highp' || part === 'mediump' || part === 'lowp');
  if (precision < 0) return cacheKey;
  const at = precision + KEY_PARAMETERS + 1;
  const mask = Number(parts[at]);
  if (!Number.isInteger(mask) || (mask & REVERSED_DEPTH_BIT) === 0) return cacheKey;
  parts[at] = String(mask & ~REVERSED_DEPTH_BIT);
  return parts.join(',');
}

function describe(material: THREE.Material, object: THREE.Object3D): string {
  const m = material as THREE.MeshStandardMaterial;
  let owner = '';
  for (let node: THREE.Object3D | null = object; node; node = node.parent) {
    if (node.name) {
      owner = node.name;
      break;
    }
  }
  return `${m.type}${m.name ? ` "${m.name}"` : ''}${m.color ? ` #${m.color.getHexString()}` : ''}` +
    `${m.map ? ' map' : ''}${m.vertexColors ? ' vc' : ''}${m.flatShading ? ' flat' : ''}` +
    `${m.transparent ? ' transparent' : ''}${m.side === THREE.DoubleSide ? ' double' : ''}` +
    `${(object as THREE.InstancedMesh).isInstancedMesh ? ' [instanced]' : ''}` +
    `${(object as THREE.SkinnedMesh).isSkinnedMesh ? ' [skinned]' : ''}${owner ? ` in ${owner}` : ''}`;
}

/** Every linked program, named and labelled by the materials in `scene` that use it. */
export function programEntries(renderer: THREE.WebGLRenderer, scene: THREE.Object3D): ProgramEntry[] {
  const users = new Map<unknown, Set<string>>();
  scene.traverse((object) => {
    const materials = (object as THREE.Mesh).material;
    if (!materials) return;
    for (const material of Array.isArray(materials) ? materials : [materials]) {
      const program = (renderer.properties.get(material) as { currentProgram?: unknown }).currentProgram;
      if (!program) continue;
      let set = users.get(program);
      if (!set) users.set(program, (set = new Set()));
      set.add(describe(material, object));
    }
  });
  return ((renderer.info.programs ?? []) as unknown as LiveProgram[]).map((program) => {
    const set = users.get(program);
    const first = set ? [...set].slice(0, 3).join(' | ') + (set.size > 3 ? ` (+${set.size - 3})` : '') : 'no material in the scene';
    return { id: hash(budgetKey(program.cacheKey)), label: `${program.name || 'unnamed'}: ${first}` };
  });
}

/** Reports every program the tier's list does not have; see the file comment. */
export function checkProgramBudget(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, tier: string): void {
  const allowed = new Set(((budget as Budget)[tier] ?? []).map((entry) => entry.id));
  const live = programEntries(renderer, scene);
  // For tools/look/programs.mjs: the list as the boot left it.
  (globalThis as { __broBootPrograms?: unknown }).__broBootPrograms = { tier, programs: live };
  const fresh = live.filter((entry) => !allowed.has(entry.id));
  const liveIds = new Set(live.map((entry) => entry.id));
  const gone = [...allowed].filter((id) => !liveIds.has(id)).length;
  if (fresh.length > 0) {
    console.error(
      `[program budget] ${tier}: ${fresh.length} program(s) not in config/program-budget.json ` +
        `(${live.length} linked). Draw with a material already in the game, or add it on purpose ` +
        `(node tools/look/programs.mjs --write):\n` + fresh.map((entry) => `  ${entry.id} ${entry.label}`).join('\n'),
    );
  } else if (gone > 0) {
    console.info(`[program budget] ${tier}: ${live.length} programs, ${gone} fewer than the list; it can shrink (tools/look/programs.mjs --write)`);
  }
}

/**
 * A per-frame watch for programs linked after the boot: returns the function the frame
 * calls after drawing. Silent until `ready` (the loading cover's own links are the
 * budget's business), and started over whenever `settings` returns a new object: a
 * changed tier, shadow mode or mirror setting relinks on purpose.
 */
export function watchLateLinks(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Object3D,
  ready: () => boolean,
  settings: () => { readonly graphicsQuality: string },
): () => void {
  let known = -1;
  let knownSettings: unknown = null;
  return () => {
    const count = renderer.info.programs?.length ?? 0;
    const current = settings();
    if (!ready() || current !== knownSettings || known < 0 || count < known) {
      knownSettings = current;
      known = count;
      return;
    }
    if (count === known) return;
    const fresh = programEntries(renderer, scene).slice(known);
    known = count;
    console.error(
      `[program budget] ${current.graphicsQuality}: ${fresh.length} program(s) linked mid-drive, a freeze on ANGLE: ` +
        `anchor them at boot (.omp/rules/shader-variants.md) or draw with a material already linked:\n` +
        fresh.map((entry) => `  ${entry.id} ${entry.label}`).join('\n'),
    );
  };
}
