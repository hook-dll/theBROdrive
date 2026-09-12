import * as THREE from 'three';
import { hash01 } from '../core/rng';
import type { WorldOrigin } from '../world/origin';
import type { Road } from '../world/road';
import type { Terrain } from '../world/terrain';

/**
 * A seeded impossible vessel that exists only in the middle distance.
 *
 * It is deliberately not world content: there is no collider, reward, marker, or
 * close model. The player can see it for roughly half a minute, but it dissolves
 * before the road can bring them near enough to inspect it. One seeded encounter is
 * placed early enough to make the experiment testable; later candidates are sparse.
 *
 * WHAT IT SHOWS, AND WHY IT IS ONLY POTTERY.
 *
 * Two earlier attempts failed the same test in different ways. The first built four
 * construction grammars — a gate, arches, a colonnade, a sign — out of one box: a
 * grammar of boxes reads as scaffolding, because there is nothing for the eye to land
 * on. The second built six assembled objects — a cube, a book, a chair, a watch, a
 * whale, and one amphora. Only the amphora worked, and the reason is not that it was
 * detailed: it was the ONE form whose whole identity is a single silhouette curve.
 * Everything assembled from parts has proportions to get wrong, and at a kilometre a
 * chair with the wrong members is a ladder and a ribcage is a fence.
 *
 * So the family is vessels, and nothing else. Each one is a hand-placed profile turned
 * on a lathe: sixteen pairs of numbers that cannot be out of proportion with each other
 * because there are no parts, only an outline. A new vessel costs one array.
 *
 * The night sky is inviolable. Vessels are suppressed outside daylight rather than
 * becoming silhouettes across the stars, and this system never reads or changes Sky,
 * the radio, or either audio bus.
 */

const SLOT_SPACING = 12_000;
const SLOT_CHANCE = 0.28;
const FIRST_ENCOUNTER_S = 2_600;

/** Longitudinal visibility window ahead of the player, in road metres. */
const APPEAR_AHEAD = 1_500;
const FULLY_VISIBLE_AHEAD = 1_150;
const DISSOLVE_START_AHEAD = 700;
const GONE_AHEAD = 500;

/** Far enough off-road to remain unreachable before it disappears. */
const LATERAL_MIN = 420;
const LATERAL_RANGE = 180;

/** Handles, lids and feet. Four is the most any vessel here asks for. */
const MAX_RINGS = 4;

const SALT_CHANCE = 0x4d17;
const SALT_POSITION = 0x6a21;
const SALT_SIDE = 0x83c9;
const SALT_LATERAL = 0xa14f;
const SALT_FORM = 0xc237;
const SALT_SHAPE = 0xd46b;

/**
 * A handle, in profile space: the same units the outline is drawn in, so a handle
 * cannot drift off the shoulder it belongs to when the vessel is rescaled.
 *
 * IT HAS NO OFFSET, ON PURPOSE. Hand-placed, a loop either floats a metre off the
 * jar — which reads as a mistake at any distance — or buries half of itself in the
 * wall. The distance from the axis is therefore DERIVED: the wall radius at the
 * handle's own height, plus the loop, less a bite of the strap, so the loop leans on
 * the surface and touches it without passing through.
 */
interface Handle {
  /** Height up the vessel, 0 at the foot and 1 at the rim. */
  readonly y: number;
  /** Radius of the loop. */
  readonly radius: number;
  /** Thickness of the strap. */
  readonly tube: number;
  /** One handle, on the left, or a matched pair. */
  readonly pair: boolean;
}

interface Vessel {
  readonly name: DistantMirageFamily;
  /** Outline from foot to rim, as (radius, height) with the height normalised to 1. */
  readonly profile: readonly (readonly [number, number])[];
  /** Height in metres at the nominal size. */
  readonly height: number;
  /** Width of the profile relative to that height. */
  readonly girth: number;
  readonly handles: readonly Handle[];
  /** Fired clay, glaze, bronze — the one thing a silhouette cannot say by itself. */
  readonly colour: number;
}

const CLAY = 0xb9683f;
const PALE_CLAY = 0xcf9a63;
const DARK_CLAY = 0x8c4a2f;
const GLAZE = 0x3f6d76;
const BRONZE = 0x7d7a52;
const CHALK = 0xd8cbb0;

/**
 * The vessels. Every profile is authored one unit tall, starting and ending on the
 * axis so the foot and the mouth are both closed: an open rim would show the inside of
 * the far wall through it, and nothing about this is worth a second material side.
 *
 * These are ten shapes rather than ten sizes of one shape. A seed varies a vessel's
 * height and its stoutness, and that is all it is allowed: it cannot invent a curve,
 * and the curve is the whole object.
 */
const VESSELS: readonly Vessel[] = [
  {
    // The original, unchanged: a two-handled storage amphora with a pointed foot.
    name: 'amphora',
    profile: [
      [0.0, 0.0], [0.11, 0.0], [0.13, 0.03], [0.09, 0.07],
      [0.16, 0.14], [0.27, 0.26], [0.33, 0.4], [0.33, 0.52],
      [0.28, 0.64], [0.2, 0.74], [0.14, 0.82], [0.13, 0.89],
      [0.17, 0.94], [0.19, 0.97], [0.16, 1.0], [0.0, 1.0],
    ],
    height: 62,
    girth: 0.46,
    handles: [{ y: 0.86, radius: 0.11, tube: 0.035, pair: true }],
    colour: CLAY,
  },
  {
    // Pithos: a grain jar, all belly and almost no neck.
    //
    // Almost is the whole job. Drawn as a pure ovoid it was a boulder: a vessel needs
    // one horizontal break the eye can call a mouth, so the shoulder turns in to a
    // short collar and out again to an everted rim.
    name: 'pithos',
    profile: [
      [0.0, 0.0], [0.2, 0.0], [0.23, 0.03], [0.2, 0.06],
      [0.3, 0.14], [0.38, 0.3], [0.41, 0.46], [0.38, 0.62],
      [0.32, 0.74], [0.26, 0.82], [0.23, 0.88], [0.24, 0.92],
      [0.32, 0.95], [0.33, 0.98], [0.28, 1.0], [0.0, 1.0],
    ],
    height: 44,
    girth: 0.62,
    handles: [],
    colour: PALE_CLAY,
  },
  {
    // Oinochoe: a wine jug, one handle from rim to shoulder, mouth pulled forward.
    name: 'jug',
    profile: [
      [0.0, 0.0], [0.15, 0.0], [0.17, 0.04], [0.14, 0.09],
      [0.24, 0.2], [0.31, 0.35], [0.3, 0.5], [0.24, 0.62],
      [0.15, 0.72], [0.11, 0.8], [0.11, 0.9], [0.15, 0.96],
      [0.19, 1.0], [0.0, 1.0],
    ],
    height: 50,
    girth: 0.52,
    handles: [{ y: 0.78, radius: 0.16, tube: 0.035, pair: false }],
    colour: DARK_CLAY,
  },
  {
    // Lekythos: oil flask, small body under a long narrow neck and a flat cap.
    name: 'flask',
    profile: [
      [0.0, 0.0], [0.14, 0.0], [0.16, 0.03], [0.19, 0.1],
      [0.21, 0.22], [0.2, 0.34], [0.16, 0.44], [0.08, 0.52],
      [0.06, 0.62], [0.06, 0.8], [0.07, 0.88], [0.14, 0.93],
      [0.16, 0.97], [0.13, 1.0], [0.0, 1.0],
    ],
    height: 58,
    girth: 0.44,
    handles: [{ y: 0.7, radius: 0.13, tube: 0.028, pair: false }],
    colour: CHALK,
  },
  {
    // Krater: a mixing bowl, wide flaring mouth on a short stem and a spread foot.
    name: 'krater',
    profile: [
      [0.0, 0.0], [0.26, 0.0], [0.28, 0.04], [0.22, 0.09],
      [0.14, 0.16], [0.13, 0.24], [0.22, 0.34], [0.33, 0.5],
      [0.4, 0.68], [0.44, 0.84], [0.47, 0.95], [0.45, 1.0],
      [0.0, 1.0],
    ],
    height: 40,
    girth: 0.66,
    handles: [{ y: 0.86, radius: 0.12, tube: 0.04, pair: true }],
    colour: GLAZE,
  },
  {
    // Hydria: a water jar — round shoulder, short neck, and a rim made to be poured from.
    name: 'hydria',
    profile: [
      [0.0, 0.0], [0.14, 0.0], [0.16, 0.04], [0.13, 0.08],
      [0.24, 0.18], [0.33, 0.34], [0.36, 0.5], [0.32, 0.64],
      [0.22, 0.74], [0.15, 0.8], [0.14, 0.9], [0.18, 0.95],
      [0.22, 0.98], [0.18, 1.0], [0.0, 1.0],
    ],
    height: 52,
    girth: 0.5,
    handles: [{ y: 0.72, radius: 0.13, tube: 0.035, pair: true }],
    colour: CLAY,
  },
  {
    // Kylix: a drinking cup, a shallow dish on a tall stem. Almost all air.
    name: 'kylix',
    profile: [
      [0.0, 0.0], [0.3, 0.0], [0.31, 0.04], [0.2, 0.1],
      [0.07, 0.2], [0.06, 0.44], [0.1, 0.56], [0.24, 0.68],
      [0.38, 0.82], [0.44, 0.94], [0.45, 1.0], [0.0, 1.0],
    ],
    height: 34,
    girth: 0.78,
    handles: [{ y: 0.9, radius: 0.13, tube: 0.03, pair: true }],
    colour: BRONZE,
  },
  {
    // Decanter: a glass sphere drawn out into a neck longer than the body is tall.
    name: 'decanter',
    profile: [
      [0.0, 0.0], [0.16, 0.0], [0.22, 0.05], [0.26, 0.13],
      [0.26, 0.22], [0.21, 0.3], [0.12, 0.36], [0.07, 0.44],
      [0.06, 0.62], [0.06, 0.82], [0.08, 0.92], [0.14, 0.97],
      [0.12, 1.0], [0.0, 1.0],
    ],
    height: 60,
    girth: 0.42,
    handles: [],
    colour: GLAZE,
  },
  {
    // Funerary urn: a lidded jar, and the lid is the silhouette's whole signature.
    //
    // The first draft ran the body straight into the dome and read as a lump. A lid is
    // a lid because it OVERHANGS: the body narrows to a mouth, the lid steps back out
    // wider than that mouth, and only then does the dome start.
    name: 'urn',
    profile: [
      [0.0, 0.0], [0.18, 0.0], [0.21, 0.04], [0.17, 0.09],
      [0.27, 0.2], [0.35, 0.36], [0.36, 0.5], [0.29, 0.6],
      [0.2, 0.67], [0.2, 0.7], [0.34, 0.72], [0.33, 0.76],
      [0.28, 0.81], [0.2, 0.88], [0.11, 0.93], [0.05, 0.95],
      [0.07, 0.97], [0.05, 1.0], [0.0, 1.0],
    ],
    height: 54,
    girth: 0.48,
    handles: [{ y: 0.52, radius: 0.11, tube: 0.038, pair: true }],
    // Bronze, not chalk. Pale against a bright sky the whole profile washed out and
    // the lid step went with it; the silhouette needs to be darker than the sky it
    // stands in, which is the same reason the deep water is darker than the sand.
    colour: BRONZE,
  },
  {
    // A bottle: bulb, long neck, flared mouth.
    //
    // It replaced an unguentarium, which was drawn honestly and read as a pole. A
    // silhouette needs a change of width somewhere, and a scent phial's whole charm is
    // that it has almost none — which is charm you can only see in your hand.
    name: 'bottle',
    profile: [
      [0.0, 0.0], [0.2, 0.0], [0.26, 0.04], [0.3, 0.12],
      [0.31, 0.22], [0.27, 0.32], [0.18, 0.4], [0.1, 0.48],
      [0.08, 0.6], [0.08, 0.78], [0.1, 0.87], [0.16, 0.93],
      [0.19, 0.97], [0.15, 1.0], [0.0, 1.0],
    ],
    height: 58,
    girth: 0.5,
    handles: [],
    colour: PALE_CLAY,
  },
];

/** The lab's selector and any save-facing name come from here, in author order. */
export const DISTANT_MIRAGE_FAMILIES = [
  'amphora',
  'pithos',
  'jug',
  'flask',
  'krater',
  'hydria',
  'kylix',
  'decanter',
  'urn',
  'bottle',
] as const;
export type DistantMirageFamily = (typeof DISTANT_MIRAGE_FAMILIES)[number];

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

/**
 * Bakes a vessel's colour and its vertical brightness ramp into vertex colours.
 *
 * A vessel is unlit (see the material note below), so nothing else separates its foot
 * from its shoulder. A base a third darker than the rim restores the relief a
 * silhouette against the sky actually shows, and costs no shading.
 *
 * The colour is baked rather than carried on the material because there is ONE
 * material for the whole system and a vessel and its handles must agree: tinting the
 * shared material would tint the handles twice and the next vessel once.
 */
function shaded(geometry: THREE.BufferGeometry, colour: number): THREE.BufferGeometry {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const low = box.min.y;
  const span = Math.max(1e-4, box.max.y - low);
  // Authored in display space like the material: these are numbers that reach the
  // screen, not albedo.
  const tint = new THREE.Color().setHex(colour, THREE.LinearSRGBColorSpace);
  const position = geometry.getAttribute('position');
  const shades = new Float32Array(position.count * 3);
  for (let i = 0; i < position.count; i++) {
    const shade = 0.72 + ((position.getY(i) - low) / span) * 0.36;
    shades[i * 3] = tint.r * shade;
    shades[i * 3 + 1] = tint.g * shade;
    shades[i * 3 + 2] = tint.b * shade;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(shades, 3));
  return geometry;
}

/**
 * One lathe per profile. Eighteen segments around: the horizon silhouette of a
 * vessel this far away is a few dozen pixels wide, and the segment count that shows
 * there is the one on the OUTLINE, where eighteen is already smooth.
 */
function vesselGeometry(vessel: Vessel): THREE.BufferGeometry {
  return shaded(
    new THREE.LatheGeometry(
      vessel.profile.map(([r, y]) => new THREE.Vector2(r, y)),
      18,
    ),
    vessel.colour,
  );
}

/**
 * The vessel's own radius at a height, read straight off the profile it is turned
 * from. This is what lets a handle sit on the wall instead of near it: the outline is
 * the single source of where the clay is, so a reshaped jar carries its handles with
 * it and neither floats them nor swallows them.
 */
function wallRadiusAt(vessel: Vessel, y: number): number {
  const profile = vessel.profile;
  for (let i = 1; i < profile.length; i++) {
    const [r0, y0] = profile[i - 1]!;
    const [r1, y1] = profile[i]!;
    if (y > y1) continue;
    if (y1 <= y0) return Math.max(r0, r1);
    const t = Math.min(1, Math.max(0, (y - y0) / (y1 - y0)));
    return r0 + (r1 - r0) * t;
  }
  return profile[profile.length - 1]![0];
}

/** A unit ring: every handle in the set. Its clay arrives per instance. */
function ringGeometry(): THREE.BufferGeometry {
  return shaded(new THREE.TorusGeometry(0.42, 0.08, 6, 22), 0xffffff);
}

/**
 * Ten vessels, each one seen impossibly large.
 *
 * One geometry per profile, one ring geometry for the handles, one material for all of
 * them. A candidate rewrites a single vessel transform and at most two handles; the
 * per-frame path changes only a transform and an opacity, allocates nothing, and
 * performs no terrain work.
 */
export class DistantMirage {
  private readonly material: THREE.MeshBasicMaterial;
  private readonly root = new THREE.Group();
  private readonly vessels: THREE.Mesh[] = [];
  private readonly rings: THREE.InstancedMesh;

  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly colour = new THREE.Color();
  private ringCount = 0;

  private activeSlot = Number.MIN_SAFE_INTEGER;
  private eventS = -Infinity;
  private eventX = 0;
  private eventY = 0;
  private eventZ = 0;

  private previewActive = false;
  private previewOpacity = 0;

  constructor(
    scene: THREE.Scene,
    private readonly road: Road,
    private readonly terrain: Terrain,
    private readonly seed: number,
    private readonly origin: WorldOrigin,
  ) {
    // UNLIT, AND AUTHORED IN DISPLAY SPACE.
    //
    // A shaded standard material turned every structure into a black paper cut-out.
    // Pass 2 in core/renderer.ts copies the linear scene target to the canvas
    // untouched, so a colour reaches the screen at its own numeric value: a 0.24
    // lightness stone is 60/255 at best, and the sun stands behind the silhouette
    // as often as in front of it, which took the lit face down to single digits.
    //
    // A mirage is refracted light rather than a surface. It carries its own
    // brightness, takes no shading, and keeps its colour whatever the sun does.
    this.material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      color: 0xffffff,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      fog: true,
    });

    for (const vessel of VESSELS) {
      const mesh = new THREE.Mesh(vesselGeometry(vessel), this.material);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      this.vessels.push(mesh);
      this.root.add(mesh);
    }

    this.rings = new THREE.InstancedMesh(ringGeometry(), this.material, MAX_RINGS);
    this.rings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.rings.count = 0;
    this.rings.frustumCulled = false;
    this.rings.castShadow = false;
    this.rings.receiveShadow = false;
    this.root.add(this.rings);

    this.root.visible = false;
    scene.add(this.root);
  }

  /** Updates presentation only. `dayFactor` comes from Sky but is never fed back into it. */
  update(playerS: number, dayFactor: number): void {
    const slot = this.findVisibleSlot(playerS);
    if (slot === null || dayFactor <= 0.12) {
      this.root.visible = false;
      return;
    }
    if (slot !== this.activeSlot) this.place(slot);

    const ahead = this.eventS - playerS;
    const arrivalFade = smoothstep(GONE_AHEAD, DISSOLVE_START_AHEAD, ahead);
    const distanceFade = 1 - smoothstep(FULLY_VISIBLE_AHEAD, APPEAR_AHEAD, ahead);
    const daylightFade = smoothstep(0.12, 0.42, dayFactor);
    const opacity = arrivalFade * distanceFade * daylightFade;
    if (opacity <= 0.002) {
      this.root.visible = false;
      return;
    }

    this.root.visible = true;
    this.material.opacity = opacity * 0.82;
    // Scene objects are origin-relative. Recompute from the retained f64 absolute
    // position so a rebase cannot move the mirage or perturb its terrain sample.
    this.root.position.set(this.eventX - this.origin.x, this.eventY, this.eventZ - this.origin.z);
  }

  /** Direct, deterministic presentation path used by the isolated mirage laboratory. */
  showPreview(
    family: DistantMirageFamily,
    eventS: number,
    lateral: number,
    opacity: number,
    scale: number,
    variation: number,
  ): void {
    this.previewActive = true;
    this.activeSlot = Number.MIN_SAFE_INTEGER;
    this.eventS = eventS;
    const point = this.road.offsetPoint(eventS, lateral);
    this.eventX = point.x;
    this.eventZ = point.z;
    this.eventY = this.terrain.heightAt(point.x, point.z, eventS);
    const approach = this.road.sampleAt(eventS - FULLY_VISIBLE_AHEAD);
    this.root.rotation.y = Math.atan2(approach.x - point.x, approach.z - point.z);
    this.root.scale.setScalar(Math.max(0.05, scale));
    this.build(Math.round(variation), VESSELS.findIndex((vessel) => vessel.name === family));
    this.previewOpacity = Math.min(1, Math.max(0, opacity));
    this.root.position.set(
      this.eventX - this.origin.x,
      this.eventY,
      this.eventZ - this.origin.z,
    );
    this.setPreviewDayFactor(1);
  }

  setPreviewDayFactor(dayFactor: number): void {
    const alpha = this.previewOpacity * smoothstep(0.12, 0.42, dayFactor);
    this.material.opacity = alpha;
    this.root.visible = this.previewActive && alpha > 0.002;
  }

  hide(): void {
    this.previewActive = false;
    this.root.visible = false;
  }

  private findVisibleSlot(playerS: number): number | null {
    // At most two slots can overlap the 1.5 km visibility window at a 12 km cadence.
    // Check the current slot and the next one because the seeded offset may put either
    // candidate ahead of the player.
    const base = Math.max(0, Math.floor(playerS / SLOT_SPACING));
    for (let slot = base; slot <= base + 1; slot++) {
      if (!this.slotExists(slot)) continue;
      const s = this.slotS(slot);
      const ahead = s - playerS;
      if (ahead >= GONE_AHEAD && ahead <= APPEAR_AHEAD) return slot;
    }
    return null;
  }

  private slotExists(slot: number): boolean {
    return slot === 0 || hash01(this.seed, slot, SALT_CHANCE) < SLOT_CHANCE;
  }

  private slotS(slot: number): number {
    if (slot === 0) return FIRST_ENCOUNTER_S;
    const inset = 2_000 + hash01(this.seed, slot, SALT_POSITION) * (SLOT_SPACING - 4_000);
    return slot * SLOT_SPACING + inset;
  }

  private place(slot: number): void {
    this.activeSlot = slot;
    this.eventS = this.slotS(slot);
    const side = hash01(this.seed, slot, SALT_SIDE) < 0.5 ? -1 : 1;
    const lateral = side * (LATERAL_MIN + hash01(this.seed, slot, SALT_LATERAL) * LATERAL_RANGE);
    const point = this.road.offsetPoint(this.eventS, lateral);
    this.eventX = point.x;
    this.eventZ = point.z;
    this.eventY = this.terrain.heightAt(point.x, point.z, this.eventS);

    // Face the place from which the vessel becomes clear, not the road beside it: a
    // pair of handles is only a pair from one bearing.
    const approach = this.road.sampleAt(this.eventS - FULLY_VISIBLE_AHEAD);
    this.root.rotation.y = Math.atan2(approach.x - point.x, approach.z - point.z);
    this.root.scale.setScalar(1);
    this.build(slot);
  }

  /**
   * Shows one vessel and hangs its handles.
   *
   * The seed picks the shape and then varies its height and its stoutness. It is
   * deliberately allowed no more than that: a profile squashed or stretched past about
   * a fifth stops being the vessel it was drawn as, and one recognisable jar is worth
   * more than twenty ambiguous ones.
   */
  private build(slot: number, formOverride?: number): void {
    const index =
      formOverride !== undefined && formOverride >= 0
        ? formOverride
        : Math.floor(hash01(this.seed, slot, SALT_FORM) * VESSELS.length);
    const vessel = VESSELS[Math.min(VESSELS.length - 1, index)]!;

    const height = vessel.height * (0.82 + this.shapeRandom(slot, 0) * 0.42);
    const girth = height * vessel.girth * (0.92 + this.shapeRandom(slot, 1) * 0.16);

    for (let i = 0; i < this.vessels.length; i++) {
      const mesh = this.vessels[i]!;
      mesh.visible = i === index;
      if (!mesh.visible) continue;
      mesh.position.set(0, 0, 0);
      mesh.scale.set(girth, height, girth);
    }

    this.ringCount = 0;
    for (const handle of vessel.handles) {
      // Where the wall actually is at this height. The loop's outer edge is one loop
      // radius from its centre, so pushing the centre out by that much would leave it
      // exactly tangent; a bite of the strap back in makes it lean on the clay.
      const wall = wallRadiusAt(vessel, handle.y);
      const offset = wall + handle.radius - handle.tube * 1.4;
      const sides = handle.pair ? [-1, 1] : [-1];
      for (const side of sides) {
        // Handle numbers are profile-space, so they ride the same scale the outline
        // does and cannot slide off the shoulder when the seed restretches the jar.
        this.ring(
          side * offset * girth,
          handle.y * height,
          handle.radius * girth * 2,
          handle.tube * girth,
          vessel.colour,
        );
      }
    }
    this.rings.count = this.ringCount;
    this.rings.instanceMatrix.needsUpdate = true;
    if (this.rings.instanceColor) this.rings.instanceColor.needsUpdate = true;
  }

  /**
   * Places one handle loop.
   *
   * THE LOOP'S PLANE CONTAINS THE VESSEL'S AXIS. A handle is a strap that leaves the
   * wall, arcs OUT and comes back — the arc lies in the plane through the axis and
   * the point it grows from, which is exactly the torus's own XY plane, so it wants
   * no rotation at all. Yawed a quarter turn, as it was, the loop stood across the
   * body and a viewer on the approach saw it edge-on: a blade floating beside the jar.
   */
  private ring(x: number, y: number, diameter: number, tube: number, colour: number): void {
    if (this.ringCount >= MAX_RINGS) return;
    const index = this.ringCount++;
    this.position.set(x, y, 0);
    this.euler.set(0, 0, 0);
    this.quaternion.setFromEuler(this.euler);
    this.scale.set(diameter, diameter, tube);
    this.matrix.compose(this.position, this.quaternion, this.scale);
    this.rings.setMatrixAt(index, this.matrix);
    this.colour.setHex(colour, THREE.LinearSRGBColorSpace);
    this.rings.setColorAt(index, this.colour);
  }

  private shapeRandom(slot: number, index: number): number {
    return hash01(this.seed, slot, SALT_SHAPE + index * 0x9e37);
  }
}
