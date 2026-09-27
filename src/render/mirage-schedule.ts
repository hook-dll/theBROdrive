import { hashUnit3 } from '../core/rng';
import { DISTANT_MIRAGE_FAMILIES, type DistantMirageFamily } from './mirage';
import { MIRAGE_TABLEAU_KINDS, type MirageKind } from './mirage-tableau';

/**
 * ONE ROAD OF APPARITIONS: which mirage the player meets next, and where.
 *
 * There are two mirage systems — the lone vessel standing half a kilometre off the
 * road (`render/mirage.ts`) and the tableau lining both verges (`render/mirage-
 * tableau.ts`) — and each used to keep a private cadence: a tableau every 3–8 km, a
 * vessel in one 12 km slot of every three. Two private cadences meant the vessels,
 * ten forms of them, came round once in ~36 km and could land in the middle of a
 * fleet, and nothing decided what followed what.
 *
 * So both read this one schedule. All thirty-five apparitions — ten vessels and
 * twenty-five tableaus — are dealt from one deck, shuffled per round by the seed, so a
 * round of thirty-five encounters shows every one of them once, in an order nobody
 * can learn, and the same apparition never comes twice running across a round's seam.
 * Encounters are 3–8 km apart start to start, and each system keeps its own visible
 * window inside that spacing (a tableau from 900 m before its start to 260 m past its
 * end, at most 1.9 km; a vessel for the first 1 km), so two apparitions never share
 * the screen.
 *
 * A pure function of the seed and the road: nothing is streamed, nothing is saved, and
 * both systems get the same answer from the same arclength.
 */

const MIN_GAP_M = 3_000;
const GAP_RANGE_M = 5_000;

const SALT_GAP = 0x31a7;
const SALT_LENGTH = 0x42b9;
const SALT_DEAL = 0x53cb;

export type MirageApparition =
  | { readonly system: 'distant'; readonly family: DistantMirageFamily }
  | { readonly system: 'tableau'; readonly kind: MirageKind };

export interface MirageEncounter {
  /** Position in the schedule; the systems key their own hashes on it. */
  readonly index: number;
  /** Where the apparition arrives, road metres. */
  readonly startS: number;
  /** Road metres a tableau's field runs past `startS`. A vessel ignores it. */
  readonly length: number;
  readonly apparition: MirageApparition;
}

const DECK: readonly MirageApparition[] = [
  ...DISTANT_MIRAGE_FAMILIES.map((family) => ({ system: 'distant' as const, family })),
  ...MIRAGE_TABLEAU_KINDS.map((kind) => ({ system: 'tableau' as const, kind })),
];

function sameApparition(a: MirageApparition, b: MirageApparition): boolean {
  if (a.system === 'distant') return b.system === 'distant' && a.family === b.family;
  return b.system === 'tableau' && a.kind === b.kind;
}

export class MirageSchedule {
  readonly encounters: readonly MirageEncounter[];

  constructor(seed: number, roadLength: number) {
    const encounters: MirageEncounter[] = [];
    let startS = MIN_GAP_M + hashUnit3(seed, -1, SALT_GAP) * GAP_RANGE_M;
    let round: MirageApparition[] = [];
    let previous: MirageApparition | null = null;
    for (let index = 0; startS < roadLength; index++) {
      if (index % DECK.length === 0) {
        round = [...DECK];
        const block = index / DECK.length;
        for (let i = round.length - 1; i > 0; i--) {
          const j = Math.floor(hashUnit3(seed, block * 64 + i, SALT_DEAL) * (i + 1));
          [round[i], round[j]] = [round[j]!, round[i]!];
        }
        // A round is a fresh shuffle, so its first card can be the last one shown.
        if (previous && sameApparition(round[0]!, previous)) [round[0], round[1]] = [round[1]!, round[0]!];
      }
      const apparition = round[index % DECK.length]!;
      encounters.push({
        index,
        startS,
        // A fleet is the one tableau read as a LANDSCAPE rather than as a verge: it
        // needs to arrive, surround and leave, and 700 m of it goes by in half a
        // minute. It also has to spread its hulls out, and the length is the only
        // axis with room to do that, because their distance from the road is fixed.
        length:
          apparition.system === 'tableau' && apparition.kind === 'ships'
            ? 1_400 + hashUnit3(seed, index, SALT_LENGTH) * 260
            : 680 + hashUnit3(seed, index, SALT_LENGTH) * 520,
        apparition,
      });
      previous = apparition;
      startS += MIN_GAP_M + hashUnit3(seed, index, SALT_GAP) * GAP_RANGE_M;
    }
    this.encounters = encounters;
  }

  /** Index of the last encounter starting at or before `s`, or -1 before the first. */
  lastStartingBy(s: number): number {
    let lo = 0;
    let hi = this.encounters.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.encounters[mid]!.startS <= s) lo = mid + 1;
      else hi = mid;
    }
    return lo - 1;
  }
}
