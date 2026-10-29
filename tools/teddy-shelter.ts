/**
 * Teddy shelter rules (contracts/shelters.ts, contracts/offers.ts `shelterTeddies`): each
 * teddy on a bench is its own contract with its own town, mostly the next one or the one
 * after; put on a bench it gets off at its destination (delivered, paid, the round moves on
 * with its last teddy), goes back at its source, and stays anywhere else; one left lying
 * `ABANDON_M` from the player is fined and gone; a save keeps a teddy's destination.
 *
 *   bun tools/teddy-shelter.ts            # seeds drawn at random, printed
 *   bun tools/teddy-shelter.ts 123 456    # those seeds
 */
import { GameWorld, newWorldState } from '../src/game/state';
import { migrateState } from '../src/save/save';
import { activeContracts } from '../src/contracts/registry';
import { offerDestinationIndex, shelterTeddies } from '../src/contracts/offers';
import { shelterBench, teddyGetOff } from '../src/contracts/shelters';
import { contractPay, FINE_SHELLS } from '../src/economy/economy';
import { ABANDON_M } from '../src/contracts/types';
import { LoosePartField } from '../src/parts/loose';
import { FixtureField } from '../src/world/fixturefield';
import { settleBenchTeddies, type TeddyNews } from '../src/world/shelter';

let failures = 0;
function check(label: string, ok: boolean, detail: string): void {
  if (!ok) failures++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${label.padEnd(58)} ${detail}`);
}

const args = process.argv.slice(2).map((arg) => Number(arg) >>> 0);
const seeds = args.length > 0 ? args : Array.from({ length: 3 }, () => Math.floor(Math.random() * 0x100000000) >>> 0);

for (const seed of seeds) {
  console.log(`seed ${seed}`);

  // The draw over many rounds: own contracts, own towns, mostly one or two posts on.
  const hops = [0, 0, 0, 0];
  let teddies = 0;
  let mixedBench = 0;
  let benches = 0;
  for (let post = 0; post < 40; post++) {
    for (let round = 0; round < 10; round++) {
      const bench = shelterTeddies(seed, post, round);
      benches++;
      teddies += bench.length;
      const towns = new Set(bench.map((teddy) => teddy.destination));
      if (towns.size > 1) mixedBench++;
      for (const teddy of bench) hops[offerDestinationIndex(teddy) - post]!++;
    }
  }
  check('1-3 teddies a round', teddies >= benches && teddies <= 3 * benches, `${teddies} teddies on ${benches} benches`);
  check('mostly the next town or the one after', (hops[1]! + hops[2]!) / teddies > 0.8 && hops[1]! > hops[2]! && hops[2]! > hops[3]!, `hop 1/2/3: ${hops.slice(1).join('/')}`);
  check('one bench can send its teddies to different towns', mixedBench > 0, `${mixedBench} of ${benches} benches`);

  // One shelter, step by step.
  const state = newWorldState(seed);
  const world = new GameWorld(state);
  let post = 1;
  while (shelterTeddies(seed, post, 0).length < 2) post++;
  const bench = shelterBench(state, seed, post);
  const [first, second] = bench.teddies;
  check('every teddy of a new round waits', bench.waiting.every(Boolean), bench.waiting.join(' '));
  check('each teddy is its own contract', first!.id !== second!.id && first!.destination !== undefined, `${first!.id} → ${first!.destination}, ${second!.id} → ${second!.destination}`);

  state.player.carried.push(first!);
  check('a taken teddy is one active contract', activeContracts(state).all.size === 1 && !shelterBench(state, seed, post).waiting[0], `${activeContracts(state).all.size}`);

  const dest = offerDestinationIndex(first!);
  const wrong = dest + 1;
  check('on its own bench it goes back', teddyGetOff(state, seed, first!, post).mode === 'return', teddyGetOff(state, seed, first!, post).mode);
  check('on a wrong bench it stays', teddyGetOff(state, seed, first!, wrong).mode === 'stay', `post ${wrong}: ${teddyGetOff(state, seed, first!, wrong).mode}`);
  if (dest > post + 1) {
    check('on the bench before its town it stays', teddyGetOff(state, seed, first!, post + 1).mode === 'stay', teddyGetOff(state, seed, first!, post + 1).mode);
  }
  const off = teddyGetOff(state, seed, first!, dest);
  check('at its destination it gets off', off.mode === 'deliver' && !off.roundDone, JSON.stringify(off));
  if (off.mode === 'deliver') {
    const shells = state.player.shells;
    const pay = contractPay(seed, first!);
    world.apply({ t: 'teddy_seat', teddyId: first!.id, sourcePost: off.sourcePost, round: off.round, roundDone: off.roundDone });
    check('got off: closed, out of the hands, counted', state.completedContractIds.includes(first!.id) && state.player.carried.length === 0 && state.deliveriesByKind.teddy_passengers === 1, `pay ${pay}, shells ${shells}`);
    check('the bench keeps its round while a teddy waits', (state.shelterRounds[String(post)] ?? 0) === 0 && shelterBench(state, seed, post).waiting.slice(1).every(Boolean), `round ${state.shelterRounds[String(post)] ?? 0}`);
    check('a delivered teddy cannot get off twice', teddyGetOff(state, seed, first!, dest).mode === 'stay', teddyGetOff(state, seed, first!, dest).mode);
  }

  // Every other teddy of the round gets off: the last moves the bench on.
  const rest = bench.teddies.slice(1);
  rest.forEach((teddy, k) => {
    const done = teddyGetOff(state, seed, teddy, offerDestinationIndex(teddy));
    if (done.mode !== 'deliver') return;
    check(`teddy ${k + 2} of ${bench.teddies.length}: roundDone only for the last`, done.roundDone === (k === rest.length - 1), String(done.roundDone));
    world.apply({ t: 'teddy_seat', teddyId: teddy.id, sourcePost: done.sourcePost, round: done.round, roundDone: done.roundDone });
  });
  const next = shelterBench(state, seed, post);
  check('the last off moves the bench to the next round', next.round === 1 && next.waiting.every(Boolean), `round ${next.round}, ${next.teddies.length} waiting`);

  // Left behind: a teddy lying on the ground ABANDON_M from the player closes undelivered,
  // fined, and is gone; the round moves on with it when it was the last open. Run through
  // the game's own step (world/shelter.ts `settleBenchTeddies`), headless: no live bodies.
  {
    const lone = newWorldState(seed);
    const w = new GameWorld(lone);
    lone.player.shells = 10;
    let p = 1;
    while (shelterTeddies(seed, p, 0).length < 2) p++;
    const [a, b] = shelterTeddies(seed, p, 0);
    const loose = new LoosePartField(null as never, w, null as never, { register: () => () => {} } as never);
    const fixtures = new FixtureField();
    const at = { x: 1000, z: 2000 };
    w.apply({ t: 'item_drop', item: a!, x: at.x, y: 50, z: at.z });
    w.apply({ t: 'item_drop', item: b!, x: at.x + 5, y: 50, z: at.z });
    const step = (px: number): TeddyNews | null => settleBenchTeddies(fixtures, loose, w, px, at.z, 1);
    const near = step(at.x + ABANDON_M - 1);
    check(`${ABANDON_M - 1} m away: both still lying, open`, near === null && Object.keys(lone.looseItems).length === 2 && activeContracts(lone).all.size === 2, `${Object.keys(lone.looseItems).length} lying`);
    const left = step(at.x + ABANDON_M);
    check(`${ABANDON_M} m from one: it is left behind, fined, gone`, lone.completedContractIds.includes(a!.id) && !lone.looseItems[a!.id] && lone.player.shells === 10 - FINE_SHELLS && left?.coin === false, `${left?.text} · shells ${lone.player.shells}`);
    check('the other, 5 m nearer, still lies there open', !!lone.looseItems[b!.id] && !lone.completedContractIds.includes(b!.id) && (lone.shelterRounds[String(p)] ?? 0) === 0, `round ${lone.shelterRounds[String(p)] ?? 0}`);
    check('a left-behind teddy is no active contract nor delivery', !activeContracts(lone).all.has(a!.id) && (lone.deliveriesByKind.teddy_passengers ?? 0) === 0, '');
    const rest = shelterTeddies(seed, p, 0).slice(2);
    for (const teddy of rest) w.apply({ t: 'teddy_seat', teddyId: teddy.id, sourcePost: p, round: 0, roundDone: false });
    step(at.x + 10 + ABANDON_M);
    check('the last one left behind moves the bench on', lone.completedContractIds.includes(b!.id) && lone.shelterRounds[String(p)] === 1 && lone.player.shells === 10 - 2 * FINE_SHELLS, `round ${lone.shelterRounds[String(p)]}, shells ${lone.player.shells}`);
    step(at.x + 10 + ABANDON_M);
    check('never fined twice', lone.player.shells === 10 - 2 * FINE_SHELLS, `shells ${lone.player.shells}`);
  }

  // A save keeps a far teddy's destination; an old party teddy is bound for the next post.
  let far = 0;
  let farTeddy = shelterTeddies(seed, 0, 0)[0]!;
  for (let p = 0; p < 40 && far === 0; p++) {
    for (const teddy of shelterTeddies(seed, p, 3)) {
      if (offerDestinationIndex(teddy) > p + 1) {
        far = offerDestinationIndex(teddy) - p;
        farTeddy = teddy;
        break;
      }
    }
  }
  const saved = structuredClone(newWorldState(seed));
  saved.player.carried = [farTeddy, { ...shelterTeddies(seed, 2, 0)[0]!, destinationIndex: undefined, party: { id: 'shelter:2:0', size: 2 } } as never];
  const loaded = migrateState(saved).player.carried;
  check('a save keeps a far teddy bound for its town', far > 1 && loaded[0]?.type === 'contract_cargo' && offerDestinationIndex(loaded[0]) === offerDestinationIndex(farTeddy), `${far} posts on`);
  check("an old party's teddy loads bound for the next post", loaded[1]?.type === 'contract_cargo' && offerDestinationIndex(loaded[1]) === 3 && !('party' in loaded[1]), loaded[1]?.id ?? '-');
}

console.log(failures === 0 ? 'all checks passed' : `${failures} CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
