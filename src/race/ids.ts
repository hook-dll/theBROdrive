/**
 * The names of a race's own things in world state: the rival car waiting at a track's
 * grid, and the two loaded trailers of a trailer race (race/director.ts).
 *
 * They live in `WorldState.cars` and `WorldState.trailers` like any other car or trailer,
 * so the streaming, the drawing, the couplings and the collisions are the world's own;
 * these prefixes are what sets them apart. A race is never saved: a save written mid-race
 * still holds them, and loading it drops every one (save/save.ts `migrateState`), while
 * the stake comes back through `WorldState.raceStake` (race/stake.ts). None of them is the
 * player's to sit in, tow, hitch or unhitch (contracts/world.ts `haulLoadLock`).
 */

const RIVAL_PREFIX = 'race-rival:';
const TRAILER_PREFIX = 'race-trailer:';

/** The rival car waiting at the grid of post `postIndex`'s track. */
export function raceRivalId(postIndex: number): string {
  return `${RIVAL_PREFIX}${postIndex}`;
}

/** The loaded trailer a trailer race at post `postIndex` hitches to the rival or the player. */
export function raceTrailerId(postIndex: number, who: 'rival' | 'player'): string {
  return `${TRAILER_PREFIX}${postIndex}:${who}`;
}

/** Any car or trailer a race put into the world. */
export function isRaceId(id: string): boolean {
  return id.startsWith(RIVAL_PREFIX) || id.startsWith(TRAILER_PREFIX);
}

/** What a hand put on a race's car or trailer is told. */
export const RACE_LOCK_TEXT = 'the racer’s — race it at the start line';
