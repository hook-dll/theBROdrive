import * as THREE from 'three';
import { SHELL_KINDS } from '../economy/shells';
import { applyComicShading } from '../render/comic';
import { makeFlatMaterial } from '../render/materials';
import { shellSprite } from '../ui/shellsprites';
import { drawPictogram } from '../world/haulsign';
import { paintSign, SIGN_PLANE } from '../world/market';
import { GANTRY_LAMPS, GANTRY_LENS_RADIUS_M, gantryLampPoint } from '../world/racetrack/mesh';
import { TRACK_LIFT_M } from '../world/racetrack/mesh';
import type { RaceTrack, TrackPose } from '../world/racetrack/track';
import type { FieldPlan } from './rival';
import { RACE_PRIZES, RACE_STAKE } from './stake';

/**
 * WHAT A RACE PUTS UP AT ITS TRACK while its field waits there (race/director.ts): the
 * "RACE ME!" board beside the player's grid box, and the start lights' lenses on the
 * gantry's housings (world/racetrack/mesh.ts draws the housings with the chunk).
 *
 * THE BOARD is for a boy who can barely read: pictures first, few words. "RACE ME!" across
 * the top; three shells, an arrow and nine shells (the stake, and what the winner takes);
 * the field's level as one, two or three chevrons in green, orange or red with its word
 * under them; and the haul sign's car-and-trailer pictogram when this round is a trailer
 * race. It stands on a post outside the asphalt beside the player's box, a little ahead
 * of it, its face turned back down the lap to the cars coming onto the grid. ONE board,
 * built with the visuals and repainted on its own canvas for each field (a new round is
 * a new field): a repaint is a texture upload, never a new material or program.
 *
 * THE LIGHTS are three discs over the housings, each one of three shared materials — off,
 * red, green — built exactly as `makeFlatMaterial` builds its own (the comic
 * `MeshStandardMaterial`), so they draw with the program the flat kit boxes already link:
 * the lit ones only carry an emissive colour, which is a uniform. `setLights` swaps a
 * disc's material when the count changes. The discs, the post and the board are the
 * variants `marketProgramAnchor` holds (world/market.ts), and the group is in the scene
 * from boot, hidden, so nothing links mid-drive.
 *
 * Everything here is origin-relative and placed again from ABSOLUTE metres every frame
 * (`sync`): four meshes, no allocation.
 */

const POST_W = 0.08;
const BOARD_W = 1.15;
const BOARD_H = 0.9;
const BOARD_Y = 1.55;
const POST_TOP = BOARD_Y + BOARD_H / 2;
/** Where the board stands: this far out past the asphalt's edge, this far ahead of the slot, metres. */
const SIGN_OUT_M = 1.8;
const SIGN_AHEAD_M = 3;
const CANVAS_W = 512;
const CANVAS_H = Math.round((CANVAS_W * BOARD_H) / BOARD_W);
const BOARD_BG = '#fff3d6';
const BOARD_FG = '#7a1f1f';
const LEVEL_COLOURS = { steady: '#2f8a3c', fast: '#d9831f', wild: '#c42a22' } as const;
const LEVEL_CHEVRONS = { steady: 1, fast: 2, wild: 3 } as const;
const LEVEL_WORDS = { steady: 'EASY', fast: 'FAST', wild: 'WILD' } as const;

/** Lens colours: dark glass, and the two lit ones with their glow. */
const LENS_OFF = 0x1a1414;
const LENS_RED = 0xff2a1a;
const LENS_GREEN = 0x2aff4a;
const LENS_GLOW = 2.4;

let lensMaterials: readonly [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] | null = null;
let lensGeometry: THREE.CircleGeometry | null = null;

/** The three lens materials, made once: off, red, green. */
function lenses(): readonly [THREE.MeshStandardMaterial, THREE.MeshStandardMaterial, THREE.MeshStandardMaterial] {
  if (lensMaterials) return lensMaterials;
  // Exactly `makeFlatMaterial`'s construction, so the program is the one it already linked.
  const make = (color: number, emissive: number): THREE.MeshStandardMaterial =>
    applyComicShading(
      new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0, emissive, emissiveIntensity: emissive === 0 ? 0 : LENS_GLOW }),
      { contourStrength: 0, stippleStrength: 0 },
    );
  lensMaterials = [make(LENS_OFF, 0), make(LENS_RED, LENS_RED), make(LENS_GREEN, LENS_GREEN)];
  return lensMaterials;
}

export class RaceVisuals {
  private readonly root = new THREE.Group();
  private readonly lamps: THREE.Mesh[] = [];
  private readonly lampAt: { x: number; y: number; z: number }[] = [];
  private readonly sign = new THREE.Group();
  /** The one board's material, repainted per field; see THE BOARD. */
  private readonly board: THREE.MeshStandardMaterial;
  private readonly signAt = { x: 0, y: 0, z: 0 };
  private track: RaceTrack | null = null;
  private lit = -1;

  constructor(scene: THREE.Scene) {
    this.root.name = 'race';
    this.root.visible = false;
    lensGeometry ??= new THREE.CircleGeometry(GANTRY_LENS_RADIUS_M, 16);
    const off = lenses()[0];
    for (let k = 0; k < GANTRY_LAMPS; k++) {
      const lamp = new THREE.Mesh(lensGeometry, off);
      // The kit box's variant (world/market.ts `marketProgramAnchor`): casting and receiving.
      lamp.castShadow = true;
      lamp.receiveShadow = true;
      this.lamps.push(lamp);
      this.lampAt.push({ x: 0, y: 0, z: 0 });
      this.root.add(lamp);
    }
    const post = new THREE.Mesh(new THREE.BoxGeometry(POST_W, POST_TOP, POST_W), makeFlatMaterial(0x3a3d42));
    this.board = paintSign([], BOARD_BG, BOARD_FG, CANVAS_W, CANVAS_H);
    const board = new THREE.Mesh(SIGN_PLANE, this.board);
    board.scale.set(BOARD_W, BOARD_H, 1);
    board.position.set(0, BOARD_Y, POST_W / 2 + 0.01);
    this.sign.add(board);
    post.position.y = POST_TOP / 2;
    post.castShadow = true;
    post.receiveShadow = true;
    this.sign.add(post);
    this.root.add(this.sign);
    scene.add(this.root);
  }

  /** Put up at `track` for `plan`'s field, the board beside grid box `slot`, or taken down (null). */
  show(track: RaceTrack | null, plan: FieldPlan | null, slot: TrackPose | null): void {
    this.track = track;
    this.root.visible = track !== null;
    this.setLights(0);
    if (!track || !plan || !slot) return;
    const yaw = slot.heading + Math.PI;
    for (let k = 0; k < GANTRY_LAMPS; k++) {
      gantryLampPoint(track, k, this.lampAt[k]!);
      this.lamps[k]!.rotation.set(0, yaw, 0);
    }
    const lateral = Math.sign(slot.lateral) * (track.halfWidth + SIGN_OUT_M);
    track.offsetPoint(slot.s + SIGN_AHEAD_M, lateral, this.signAt);
    this.signAt.y = track.surfaceY(slot.s + SIGN_AHEAD_M, lateral) + TRACK_LIFT_M;
    this.sign.rotation.set(0, yaw, 0);
    paintBoard(this.board, plan);
  }

  /** Lights shown: 0 none, 1-3 that many red, 4 all green. */
  setLights(count: number): void {
    if (count === this.lit) return;
    this.lit = count;
    const [off, red, green] = lenses();
    for (let k = 0; k < GANTRY_LAMPS; k++) {
      this.lamps[k]!.material = count > GANTRY_LAMPS ? green : k < count ? red : off;
    }
  }

  /** Placed for this frame's origin. */
  sync(originX: number, originZ: number): void {
    if (!this.track) return;
    for (let k = 0; k < GANTRY_LAMPS; k++) {
      const at = this.lampAt[k]!;
      this.lamps[k]!.position.set(at.x - originX, at.y, at.z - originZ);
    }
    this.sign.position.set(this.signAt.x - originX, this.signAt.y, this.signAt.z - originZ);
  }

  dispose(): void {
    this.board.map?.dispose();
    this.board.dispose();
    this.root.removeFromParent();
  }
}

/** Paints the board for `plan` on the canvas `paintSign` made. Headless, nothing to paint. */
function paintBoard(material: THREE.MeshStandardMaterial, plan: FieldPlan): void {
  const texture = material.map;
  const canvas = texture?.image as HTMLCanvasElement | undefined;
  if (typeof document === 'undefined' || !texture || !(canvas instanceof HTMLCanvasElement)) return;
  const g = canvas.getContext('2d');
  if (!g) return;
  const w = canvas.width;
  const h = canvas.height;
  g.fillStyle = BOARD_BG;
  g.fillRect(0, 0, w, h);
  const border = Math.round(h * 0.035);
  g.strokeStyle = BOARD_FG;
  g.lineWidth = border;
  g.strokeRect(border, border, w - border * 2, h - border * 2);
  g.fillStyle = BOARD_FG;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = `bold ${Math.round(h * 0.17)}px sans-serif`;
  g.fillText('RACE ME!', w * 0.5, h * 0.15, w - border * 6);

  // The stake and the prize: three shells → six shells.
  const shell = h * 0.11;
  const row = h * 0.38;
  for (let i = 0; i < RACE_STAKE; i++) {
    g.drawImage(shellSprite(SHELL_KINDS[i % SHELL_KINDS.length]!), w * 0.08 + i * shell * 0.9, row - shell / 2, shell, shell);
  }
  g.font = `bold ${Math.round(h * 0.14)}px sans-serif`;
  g.fillText('→', w * 0.42, row);
  // The winner's prize, in rows of three.
  for (let i = 0; i < RACE_PRIZES[0]!; i++) {
    const col = i % 3;
    const line = Math.floor(i / 3);
    g.drawImage(shellSprite(SHELL_KINDS[i % SHELL_KINDS.length]!), w * 0.55 + col * shell * 0.95, row - shell * 1.4 + line * shell * 0.95, shell, shell);
  }
  g.font = `bold ${Math.round(h * 0.075)}px sans-serif`;
  g.fillText('WIN!', w * 0.9, row);

  // The level: chevrons in its colour, its word under them.
  const colour = LEVEL_COLOURS[plan.level];
  const chevrons = LEVEL_CHEVRONS[plan.level];
  const cy = h * 0.66;
  const size = h * 0.09;
  const cx = plan.trailer ? w * 0.27 : w * 0.5;
  g.strokeStyle = colour;
  g.lineWidth = size * 0.45;
  g.lineCap = 'round';
  g.lineJoin = 'round';
  for (let i = 0; i < chevrons; i++) {
    const x = cx + (i - (chevrons - 1) / 2) * size * 1.3;
    g.beginPath();
    g.moveTo(x - size * 0.4, cy - size);
    g.lineTo(x + size * 0.4, cy);
    g.lineTo(x - size * 0.4, cy + size);
    g.stroke();
  }
  g.fillStyle = colour;
  g.font = `bold ${Math.round(h * 0.1)}px sans-serif`;
  g.fillText(LEVEL_WORDS[plan.level], cx, h * 0.86);

  // A trailer race: the car with its loaded trailer.
  if (plan.trailer) drawPictogram(g, 'trailer', w * 0.72, h * 0.7, h * 0.2);
  texture.needsUpdate = true;
}
