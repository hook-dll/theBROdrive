/**
 * tools/resume.ts
 *
 * The auto-resume policy: which reload comes back to the car, and which is handed the
 * title screen.
 *
 * This is the one piece of the feature that can strand a player, because resuming
 * deliberately SKIPS the only screen with a way out. So the properties below are not
 * about convenience — they are the bound. A reload that resumes into a world that
 * immediately reloads again would loop forever, and the loop is what the attempt budget
 * exists to break.
 *
 * Each scenario below starts from an EMPTY marker and is written as one sequence, rather
 * than sharing one long stream of claims. Sharing it made an earlier check spend budget
 * an assertion further down depended on, which reads as a policy bug and is not one.
 *
 * The real `installVehicleAutosave` books the resumable slot rather than the marker being
 * called directly, because "the marker names the slot the autosave writes" is itself a
 * property — the two drifting apart is how a resume would load the wrong drive.
 *
 *   npx tsx tools/resume.ts
 *
 * Nothing here is part of the game bundle.
 */

import { GameWorld, newWorldState, type WorldState } from '../src/game/state';
import { installVehicleAutosave } from '../src/save/save';
import {
  claimResumeSlot,
  clearResumeSlot,
  confirmResumeHealthy,
  markResumeTarget,
  RESUME_ATTEMPT_LIMIT,
} from '../src/save/resume';

/**
 * A session storage double, installed before the first call: the module reads its storage
 * per call rather than at load, so this is enough. The policy under test is what the
 * marker MEANS, not what a browser does with the bytes.
 */
const store = new Map<string, string>();
const sessionStorageDouble = {
  getItem: (key: string): string | null => store.get(key) ?? null,
  setItem: (key: string, value: string): void => {
    store.set(key, value);
  },
  removeItem: (key: string): void => {
    store.delete(key);
  },
};
(globalThis as unknown as { window: unknown }).window = { sessionStorage: sessionStorageDouble };

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`);
}

const written: string[] = [];
const backend = {
  async save(id: string): Promise<void> {
    written.push(id);
  },
};
const world = new GameWorld(newWorldState(1337));
const stateForSave = (): WorldState => world.state;
installVehicleAutosave(
  backend,
  world,
  stateForSave,
  () => 'drive',
  (error) => {
    throw error;
  },
  markResumeTarget,
);

/** One autosave, through the real trigger, drained to its microtask. */
async function autosave(): Promise<void> {
  world.apply({ t: 'enter_car', carId: 'car:none' });
  await Promise.resolve();
}

/** Every scenario starts from a session that has forgotten everything. */
function forget(): void {
  store.clear();
}

console.log('resume marker');

forget();
check('an empty session resumes nothing', claimResumeSlot() === null, 'null');

forget();
await autosave();
check(
  'an autosave books a resume for the slot it wrote',
  claimResumeSlot() === 'slot-1337',
  `slot-1337 against a write of ${written[written.length - 1] ?? 'nothing'}`,
);

// The bound itself: consecutive resumes are limited, and the limit is what makes a
// reload loop escapable.
forget();
await autosave();
let allowed = 0;
for (let i = 0; i < RESUME_ATTEMPT_LIMIT; i++) {
  if (claimResumeSlot() !== null) allowed++;
}
check(
  `${RESUME_ATTEMPT_LIMIT} consecutive resumes are allowed`,
  allowed === RESUME_ATTEMPT_LIMIT,
  `${allowed} of ${RESUME_ATTEMPT_LIMIT}`,
);
check(
  'the budget is then spent, so the third reload gets the menu',
  claimResumeSlot() === null,
  'null — the title screen is reachable again',
);
check(
  'and a spent budget leaves no marker to retry',
  claimResumeSlot() === null,
  'still null',
);

// A session that survives long enough has proved it works, and hands the whole budget
// back — otherwise a phone picked up twice in a row would be handed a menu the second
// time, which is the case the feature exists for.
forget();
await autosave();
for (let i = 0; i < RESUME_ATTEMPT_LIMIT; i++) claimResumeSlot();
confirmResumeHealthy();
let afterConfirm = 0;
for (let i = 0; i < RESUME_ATTEMPT_LIMIT; i++) {
  if (claimResumeSlot() !== null) afterConfirm++;
}
check(
  'a healthy session hands the budget back',
  afterConfirm === RESUME_ATTEMPT_LIMIT,
  `${afterConfirm} of ${RESUME_ATTEMPT_LIMIT} allowed after confirming`,
);

// Death and quit are endings, not interruptions: both reload deliberately.
forget();
await autosave();
claimResumeSlot();
clearResumeSlot();
check('a cleared marker resumes nothing', claimResumeSlot() === null, 'null');

// The subtle one. A reload that happens seconds after each autosave would loop forever if
// booking a save also refilled the budget, so `attempts` is carried across bookings and
// only a healthy session resets it.
forget();
await autosave();
for (let i = 0; i < RESUME_ATTEMPT_LIMIT; i++) claimResumeSlot();
await autosave();
check(
  'a later autosave does not hand the budget back',
  claimResumeSlot() === null,
  'still spent',
);

// Storage that throws is not fatal: the worst case is the title screen the player would
// have seen before this module existed.
(globalThis as unknown as { window: unknown }).window = {
  get sessionStorage(): never {
    throw new Error('storage disabled');
  },
};
check('unavailable storage resumes nothing', claimResumeSlot() === null, 'null');
markResumeTarget('slot-1337');
clearResumeSlot();
confirmResumeHealthy();
check('unavailable storage never throws', true, 'all four entry points survived');

console.log(failures === 0 ? 'all resume checks passed' : `${failures} RESUME CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
