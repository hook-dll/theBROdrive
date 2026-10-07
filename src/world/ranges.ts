/**
 * WORLD RANGES: how far from the player each layer of the world exists, in one place.
 *
 * Every figure here is either AUTHORED, with the reason it has the value it has, or
 * DERIVED from the authored ones. The chain that matters:
 *
 *   road chunks (CHUNK_LENGTH x ROAD_PHYSICS_CHUNKS)  ->  ROAD_PHYSICS_REACH_M
 *     the asphalt, the shoulder AND the verge skirt (world/roadmesh.ts) are road-chunk
 *     content, so ground beside the road reaches exactly as far:  VERGE_SOLID_REACH_M
 *   traffic needs both                                 ->  TRAFFIC_REACH_M
 *     spawns, the rear bands and the stream's edge live inside it
 *   what the player can make out at a distance (perception, not supply)
 *     ->  RAILS_WAKE_M / RAILS_SLEEP_M and TRAFFIC_UNSEEN_M
 *
 * The desert tiles are their own supply (DESERT_SOLID_REACH_M): solid ground for the
 * player and for anything that leaves the road's 20 m skirt. Traffic does not depend
 * on them, which is the point: the 480 m tiles and the 800 m road used to be two
 * unrelated numbers that traffic silently relied on agreeing.
 *
 * `checkWorldRanges` states the relations as checks and runs when this module loads:
 * a change that breaks one fails on the first boot or bench, not as a car found
 * standing on end in the sand.
 */

import { DESERT_TILE_SIZE } from './deserttiledata';

/** Metres of arclength per road chunk. Must divide NODE_SPACING for watertight road seams. */
export const CHUNK_LENGTH = 200;

/** Road chunks of scenery kept alive either side of the player. */
export const ROAD_VISUAL_CHUNKS = 6;
/**
 * Road chunks that MUST carry physics colliders either side of the player.
 *
 * Not the chunks that do: while the player is on the road every chunk is built with
 * its colliders from the start, the whole visual window, so steady travel never has
 * to turn a finished visual-only chunk into a physical one. That conversion is a full
 * synchronous rebuild — no provider can add just its colliders — and it cost 35-50 ms
 * of main thread twice per 200 m chunk (one chunk gaining physics ahead, one losing it
 * behind): measured in a browser trace as every stutter of a 60 fps drive. This band
 * is now only the floor that is repaired on the spot when it is ever found without
 * physics — after a return from the open desert, or a teleport.
 *
 * Four, not two: ambient traffic lives inside `ROAD_PHYSICS_REACH_M`, and 400 m of it
 * either side was too short a stretch of road to look down. On the road this costs
 * nothing (every chunk out to ROAD_VISUAL_CHUNKS is physical already); the price is a
 * larger synchronous repair after a teleport or a return from the desert.
 */
export const ROAD_PHYSICS_CHUNKS = 4;
/**
 * Road arclength either side of the player that is GUARANTEED to carry collision.
 *
 * The guaranteed set is `playerChunk ± ROAD_PHYSICS_CHUNKS`, so the supported reach
 * runs from `CHUNK_LENGTH * ROAD_PHYSICS_CHUNKS` (player at a chunk boundary) to one
 * chunk more (player at its far edge). Anything that needs ground under it at a
 * distance must use the guaranteed figure.
 */
export const ROAD_PHYSICS_REACH_M = CHUNK_LENGTH * ROAD_PHYSICS_CHUNKS;
/**
 * Ground beside the road: the verge skirt is built by the road chunk, so it is solid
 * exactly as far as the road is. Written out so the relation traffic depends on is a
 * named figure, not an accident.
 */
export const VERGE_SOLID_REACH_M = ROAD_PHYSICS_REACH_M;

/** Desert tiles drawn around the player's tile, in tiles (a square of 2r+1). */
export const DESERT_VISUAL_TILES = 2;
/**
 * Desert tiles that are solid around the player's tile. Every visual tile is: with one
 * physical ring the ground beside the road ended 360-600 m from the player, and every
 * car that touched the verge further out dropped off the world (measured at 30.6 km).
 * The verge skirt now carries the road's own edge; the tiles are the player's ground.
 */
export const DESERT_PHYSICS_TILES = 2;
/**
 * Nearest the edge of solid desert can be to the player, in any direction: the square
 * of tiles reaches `DESERT_PHYSICS_TILES` whole tiles past the player's own tile, and
 * the player can stand anywhere in that one.
 */
export const DESERT_SOLID_REACH_M = DESERT_TILE_SIZE * DESERT_PHYSICS_TILES;

/** How far from the player along the road a traffic car may live: where it has ground. */
export const TRAFFIC_REACH_M = Math.min(ROAD_PHYSICS_REACH_M, VERGE_SOLID_REACH_M);

/**
 * TRAFFIC ON RAILS: a car past `RAILS_SLEEP_M` of road from the player that is simply
 * cruising in its lane is moved along it by a car-following law, and handed back to its
 * springs and its driver the moment it is nearer than `RAILS_WAKE_M` (traffic.ts).
 *
 * A PERCEPTION figure. At 300 m a car is six pixels wide on a 1080-line screen and its
 * springs move it by a tenth of one, and the widest window a driver reasons about the
 * player in is the 260 m opposing-pass exclusion. The gap to `RAILS_SLEEP_M` is
 * hysteresis: a car pacing the player at the boundary does not change hands every step.
 * Measured on a 28-car stream: the traffic step fell from 1.87 ms to 0.97 ms.
 */
export const RAILS_WAKE_M = 300;
export const RAILS_SLEEP_M = 360;

/**
 * NOTHING APPEARS OR DISAPPEARS WHERE IT CAN BE SEEN: the nearest a traffic car is
 * created ahead, and the nearest one may be taken out by anything but the stream's
 * edge (a density trim, a recycled receding or stuck car).
 *
 * 140 m was "behind a crest or a bend", which on an open desert road is nothing: cars
 * were watched appearing and pulling away a few hundred metres up the road. Removals
 * used to start 90 m (trim) and 200 m (recycle) behind a moving player; a player who
 * looked back watched the cars he had just met blink out of the world.
 */
export const TRAFFIC_UNSEEN_M = 500;
/**
 * THE SPAWN BAND ENDS WHERE THE GROUND DOES. A spawn needs a fixed collider under it
 * (`spawnSiteClear` -> `hasSpawnGround`). The band once ran past the support to 700 m,
 * so two sites in three passed selection, held the single `pending` slot through a
 * model load and were thrown away on arrival — 207 of 300 attempts, a refill rate of
 * 0.38 cars/s against the 2/s the cooldown allows.
 */
export const TRAFFIC_SPAWN_MAX_M = TRAFFIC_REACH_M;
/**
 * TRAFFIC ALSO COMES UP FROM BEHIND. Spawning only ahead makes the mirror a graveyard:
 * the player overtakes nearly everything, and every overtaken car then holds a slot
 * out of sight until the rear despawn. A driver whose cap genuinely beats the player's
 * speed is instead put behind, closes, and arrives in view.
 */
export const TRAFFIC_REAR_SPAWN_MIN_M = TRAFFIC_UNSEEN_M;
export const TRAFFIC_REAR_SPAWN_MAX_M = 720;
/**
 * A frantic driver's rear band, closer than everyone else's. It is the car the player
 * is meant to meet coming up his mirror; started at the far edge of the rear band it
 * sits within a few seconds of the support edge, and any lag on the launch gets it
 * collected before it ever closes.
 */
export const TRAFFIC_FRANTIC_REAR_SPAWN_MIN_M = 450;
export const TRAFFIC_FRANTIC_REAR_SPAWN_MAX_M = 600;

/**
 * The relations the figures above must keep. Each failure names the pair and why it
 * matters. Exported for tools that change a figure and want the verdict as a list.
 */
export function worldRangeFailures(): string[] {
  const failures: string[] = [];
  const need = (ok: boolean, why: string): void => {
    if (!ok) failures.push(why);
  };
  need(
    ROAD_PHYSICS_CHUNKS <= ROAD_VISUAL_CHUNKS,
    `road physics (${ROAD_PHYSICS_CHUNKS} chunks) must lie inside the drawn road (${ROAD_VISUAL_CHUNKS})`,
  );
  need(
    DESERT_PHYSICS_TILES <= DESERT_VISUAL_TILES,
    `solid desert (${DESERT_PHYSICS_TILES} tiles) is built from drawn tiles (${DESERT_VISUAL_TILES})`,
  );
  need(
    TRAFFIC_REACH_M <= VERGE_SOLID_REACH_M && TRAFFIC_REACH_M <= ROAD_PHYSICS_REACH_M,
    `traffic (${TRAFFIC_REACH_M} m) must have road and verge ground under it ` +
      `(${ROAD_PHYSICS_REACH_M} / ${VERGE_SOLID_REACH_M} m)`,
  );
  need(
    RAILS_WAKE_M < RAILS_SLEEP_M,
    `rails need hysteresis: wake ${RAILS_WAKE_M} m must be nearer than sleep ${RAILS_SLEEP_M} m`,
  );
  need(
    RAILS_SLEEP_M <= TRAFFIC_UNSEEN_M,
    `a car spawned at ${TRAFFIC_UNSEEN_M} m must be far enough to ride on rails (${RAILS_SLEEP_M} m)`,
  );
  need(
    TRAFFIC_UNSEEN_M < TRAFFIC_SPAWN_MAX_M,
    `the ahead spawn band ${TRAFFIC_UNSEEN_M}-${TRAFFIC_SPAWN_MAX_M} m is empty`,
  );
  need(
    TRAFFIC_REAR_SPAWN_MIN_M < TRAFFIC_REAR_SPAWN_MAX_M && TRAFFIC_REAR_SPAWN_MAX_M <= TRAFFIC_REACH_M,
    `the rear band ${TRAFFIC_REAR_SPAWN_MIN_M}-${TRAFFIC_REAR_SPAWN_MAX_M} m must be inside traffic's ${TRAFFIC_REACH_M} m`,
  );
  need(
    TRAFFIC_FRANTIC_REAR_SPAWN_MIN_M < TRAFFIC_FRANTIC_REAR_SPAWN_MAX_M &&
      TRAFFIC_FRANTIC_REAR_SPAWN_MAX_M <= TRAFFIC_REACH_M &&
      TRAFFIC_FRANTIC_REAR_SPAWN_MIN_M >= RAILS_SLEEP_M,
    `the frantic rear band ${TRAFFIC_FRANTIC_REAR_SPAWN_MIN_M}-${TRAFFIC_FRANTIC_REAR_SPAWN_MAX_M} m must be ` +
      `inside traffic's ${TRAFFIC_REACH_M} m and past the rails' ${RAILS_SLEEP_M} m`,
  );
  return failures;
}

// Constants only, so this either always passes or always fails: on the first boot or
// bench after a change, never in a player's drive.
{
  const failures = worldRangeFailures();
  if (failures.length > 0) throw new Error(`world ranges disagree:\n  ${failures.join('\n  ')}`);
}
