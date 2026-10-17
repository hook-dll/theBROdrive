/**
 * Everything about a toilet that changes: its fixtures (fixtures.ts), the ceiling
 * lamp's glow and light, the optional face (face.ts) and the live mirror's face
 * (mirror.ts). A rig is laid over the variant's merged static shell (geometry.ts via
 * world/poivariantbuild.ts) on the same plan, and is posed from progress (state.ts):
 * the geometry is the catalogue's, the state is the save's.
 *
 * Lights. Every cabin has exactly one point light, always present, never casting, and
 * lit by intensity alone: the renderer's light count never changes with a toilet's state
 * (see the shader-variant rules), so a lamp going out or coming on compiles nothing.
 */

import * as THREE from 'three';
import { mirrorFaceGeometry } from '../../render/mirrorview';
import { emotionForState, ToiletFace } from './face';
import { ToiletFixture } from './fixtures';
import { toiletLayout } from './geometry';
import { toiletMirrorMaterial } from './mirror';
import type { ToiletProgress } from './state';
import type { ToiletFixtureKind, ToiletState, ToiletVariant, ToiletVerb } from './types';

export type ToiletLampMode = 'dead' | 'flicker' | 'dim' | 'steady';

/** What each progress state looks like: fixture channels and the lamp. */
interface StatePose {
  readonly fixtures: Readonly<Record<ToiletFixtureKind, number>>;
  readonly lamp: ToiletLampMode;
}

/**
 * The clogged-drain visit as poses: found shut, dirty and flickering; opened up; the
 * water shut off and the plunger in; the water back on and the floor half wiped; shut
 * and flushed under a steady lamp; then left closed and clean.
 */
const STATE_POSES: Readonly<Record<ToiletState, StatePose>> = {
  arrived: { fixtures: { door: 0, lid: 0, flush: 0, valve: 1, plunger: 0, 'floor-dirt': 1 }, lamp: 'flicker' },
  inspected: { fixtures: { door: 1, lid: 1, flush: 0, valve: 1, plunger: 0, 'floor-dirt': 1 }, lamp: 'flicker' },
  repairing: { fixtures: { door: 1, lid: 1, flush: 0, valve: 0, plunger: 1, 'floor-dirt': 1 }, lamp: 'dim' },
  cleaning: { fixtures: { door: 1, lid: 1, flush: 0, valve: 1, plunger: 0, 'floor-dirt': 0.5 }, lamp: 'dim' },
  testing: { fixtures: { door: 1, lid: 0, flush: 0, valve: 1, plunger: 0, 'floor-dirt': 0 }, lamp: 'steady' },
  healthy: { fixtures: { door: 0, lid: 0, flush: 0, valve: 1, plunger: 0, 'floor-dirt': 0 }, lamp: 'steady' },
};

/** Candela of a steady lamp; 'dim' is a share of it. */
const LAMP_INTENSITY = 4;
const LAMP_DIM = 0.35;
/** The lamp lights about one cabin and its doorway. */
const LAMP_REACH = 5;

let lampMaterials: { readonly lit: THREE.MeshStandardMaterial; readonly dark: THREE.MeshStandardMaterial } | null = null;

/**
 * The diffuser's two looks, shared by every cabin. Same type and parameters, so one
 * program: going dark is a material swap, not a recompile.
 */
function diffuserMaterials(): NonNullable<typeof lampMaterials> {
  lampMaterials ??= {
    lit: new THREE.MeshStandardMaterial({ name: 'toilet_lamp_lit', color: 0xfff6e6, emissive: 0xffe2b8, emissiveIntensity: 2.2, roughness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ name: 'toilet_lamp_dark', color: 0xd8d4cc, emissive: 0x000000, emissiveIntensity: 2.2, roughness: 0.5 }),
  };
  return lampMaterials;
}

const DIFFUSER = new THREE.CylinderGeometry(0.1, 0.1, 0.05, 10);

/** A failing tube: mostly on, with dropouts that come in bursts. Deterministic in time. */
function flickerLevel(seconds: number): number {
  const slot = Math.floor(seconds * 14);
  const hash = Math.sin(slot * 12.9898) * 43758.5453;
  const noise = hash - Math.floor(hash);
  const burst = Math.sin(seconds * 0.9) > 0.3;
  return burst && noise < 0.55 ? 0.08 : 1;
}

export class ToiletRig {
  readonly root = new THREE.Group();
  readonly face: ToiletFace | null;
  /** The live mirror's face, hidden until a `ToiletMirror` shows it. */
  readonly mirrorFace: THREE.Mesh;
  readonly light: THREE.PointLight;
  private readonly diffuser: THREE.Mesh;
  private readonly fixtures = new Map<ToiletFixtureKind, ToiletFixture>();
  private lampMode: ToiletLampMode = 'flicker';
  private clock = 0;

  constructor(readonly variant: ToiletVariant) {
    const layout = toiletLayout(variant);
    this.root.name = `toilet-rig-${variant.id}`;
    this.root.userData.toiletVariant = variant.id;

    for (const kind of variant.fixtures) {
      const fixture = new ToiletFixture(kind, variant, layout);
      this.fixtures.set(kind, fixture);
      this.root.add(fixture.node);
    }

    const [lx, ly, lz] = layout.lamp;
    this.diffuser = new THREE.Mesh(DIFFUSER, diffuserMaterials().lit);
    this.diffuser.position.set(lx, ly, lz);
    this.diffuser.castShadow = false;
    this.diffuser.receiveShadow = false;
    this.root.add(this.diffuser);
    this.light = new THREE.PointLight(0xffe2b8, LAMP_INTENSITY, LAMP_REACH, 2);
    this.light.position.set(lx, ly - 0.08, lz);
    this.light.castShadow = false;
    this.root.add(this.light);

    // A centimetre in front of the static glass, so the two never share a depth.
    const { x, y, glassZ, half } = layout.mirror;
    this.mirrorFace = new THREE.Mesh(
      mirrorFaceGeometry(new THREE.Matrix4().makeTranslation(x, y, glassZ - 0.01), half, 0),
      toiletMirrorMaterial(),
    );
    this.mirrorFace.name = 'toilet-mirror-face';
    this.mirrorFace.visible = false;
    this.mirrorFace.castShadow = false;
    this.mirrorFace.receiveShadow = false;
    this.root.add(this.mirrorFace);

    if (variant.face) {
      this.face = new ToiletFace(variant.face, variant.shell.palette.walls[0]);
      this.face.group.position.set(layout.face[0], layout.face[1], layout.face[2]);
      this.root.add(this.face.group);
    } else {
      this.face = null;
    }
  }

  get lamp(): ToiletLampMode {
    return this.lampMode;
  }

  /** Each fixture's channel now, 0..1. */
  fixtureValues(): Record<string, number> {
    const values: Record<string, number> = {};
    for (const [kind, fixture] of this.fixtures) values[kind] = fixture.current;
    return values;
  }

  fixture(kind: ToiletFixtureKind): ToiletFixture | null {
    return this.fixtures.get(kind) ?? null;
  }

  /** Poses fixtures, lamp and face for `progress`. Fixture channels ease there in `update`. */
  pose(progress: ToiletProgress): void {
    const pose = STATE_POSES[progress.state];
    for (const [kind, fixture] of this.fixtures) fixture.setTarget(pose.fixtures[kind]);
    this.lampMode = pose.lamp;
    if (this.face && this.variant.face) {
      this.face.setEmotion(emotionForState(progress.state, this.variant.face.arrival, progress.completion !== null));
    }
  }

  /** One verb on one fixture (the toggle with none); false if it does not apply. */
  activate(kind: ToiletFixtureKind, verb?: ToiletVerb): boolean {
    return this.fixtures.get(kind)?.activate(verb) ?? false;
  }

  /**
   * Advances fixtures, lamp and face; `snap` lands everything on its target at once.
   * True while a fixture moves (its shadow is stale).
   */
  update(dt: number, snap = false): boolean {
    this.clock += dt;
    let moved = false;
    for (const fixture of this.fixtures.values()) moved = fixture.update(dt, snap) || moved;
    const level = this.lampMode === 'dead' ? 0 : this.lampMode === 'dim' ? LAMP_DIM : this.lampMode === 'flicker' ? flickerLevel(this.clock) : 1;
    this.light.intensity = LAMP_INTENSITY * level;
    const materials = diffuserMaterials();
    this.diffuser.material = level > 0.15 ? materials.lit : materials.dark;
    this.face?.update(dt, snap);
    return moved;
  }

  /** Frees what is this rig's own: the mirror face's quad and the light. */
  dispose(): void {
    this.mirrorFace.geometry.dispose();
    this.light.dispose();
    this.root.removeFromParent();
  }
}
