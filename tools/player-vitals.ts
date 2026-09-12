import {
  PASSIVE_HEALTH_CEILING,
  PASSIVE_REGEN_PER_SECOND,
  PlayerVitals,
  collisionDamage,
} from '../src/player/vitals.ts';

let failures = 0;

function check(label: string, condition: boolean, detail: string): void {
  if (!condition) failures++;
  console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${label.padEnd(46)} ${detail}`);
}

function close(actual: number, expected: number, epsilon = 1e-9): boolean {
  return Math.abs(actual - expected) <= epsilon;
}

console.log('\ncollision bands');
check('walking below 15 km/h is harmless', collisionDamage(14.99, 'foot') === 0, `${collisionDamage(14.99, 'foot')}`);
check('walking 15 km/h starts mild trauma', close(collisionDamage(15, 'foot'), 0.05), `${collisionDamage(15, 'foot')}`);
check('walking 35 km/h starts serious trauma', close(collisionDamage(35, 'foot'), 0.25), `${collisionDamage(35, 'foot')}`);
check('walking 70 km/h is lethal', collisionDamage(70, 'foot') === 1, `${collisionDamage(70, 'foot')}`);
check('driving below 50 km/h is harmless', collisionDamage(49.99, 'car') === 0, `${collisionDamage(49.99, 'car')}`);
check('driving 50 km/h starts mild trauma', close(collisionDamage(50, 'car'), 0.05), `${collisionDamage(50, 'car')}`);
check('driving 90 km/h starts serious trauma', close(collisionDamage(90, 'car'), 0.25), `${collisionDamage(90, 'car')}`);
check('driving 140 km/h is lethal', collisionDamage(140, 'car') === 1, `${collisionDamage(140, 'car')}`);

console.log('\ncontact debounce and strongest impact');
{
  let persisted = 1;
  const vitals = new PlayerVitals(1, (health) => { persisted = health; });
  vitals.beginCollisionFrame('foot');
  vitals.recordContact(7, 20);
  vitals.recordContact(8, 40);
  const first = vitals.endCollisionFrame();
  const afterFirst = vitals.health;
  vitals.beginCollisionFrame('foot');
  vitals.recordContact(7, 70);
  vitals.recordContact(8, 70);
  const held = vitals.endCollisionFrame();
  vitals.beginCollisionFrame('foot');
  vitals.endCollisionFrame();
  vitals.beginCollisionFrame('foot');
  vitals.recordContact(7, 20);
  const second = vitals.endCollisionFrame();

  check('one solver step applies only strongest contact', close(first, collisionDamage(40, 'foot')), `${first.toFixed(3)} health lost`);
  check('resting contacts cannot repeat damage', held === 0 && close(vitals.health, afterFirst - second), `${held.toFixed(3)} repeated`);
  check('separation arms a later collision', second > 0, `${second.toFixed(3)} health lost`);
  check('damage is persisted immediately', close(persisted, vitals.health), `${persisted.toFixed(3)} persisted`);
}

console.log('\ndamage presentation');
{
  const mild = new PlayerVitals(1, () => {});
  mild.beginCollisionFrame('foot');
  mild.recordContact(1, 15);
  mild.endCollisionFrame();
  const mildPulse = mild.damageEffect;

  const serious = new PlayerVitals(1, () => {});
  serious.beginCollisionFrame('foot');
  serious.recordContact(1, 50);
  serious.endCollisionFrame();
  const seriousPulse = serious.damageEffect;

  mild.update(1);
  check(
    'smallest injury produces a visible pulse',
    mildPulse >= 0.35,
    `${mildPulse.toFixed(3)} intensity`,
  );
  check(
    'more damage produces stronger edge darkness',
    seriousPulse > mildPulse,
    `${mildPulse.toFixed(3)} mild, ${seriousPulse.toFixed(3)} serious`,
  );
  check(
    'mild pulse remains visible after one second',
    mild.damageEffect > 0.15 && mild.damageEffect < mildPulse,
    `${mild.damageEffect.toFixed(3)} intensity`,
  );
}

console.log('\npassive regeneration and medicine');
{
  let persisted = 0.2;
  const vitals = new PlayerVitals(0.2, (health) => { persisted = health; });
  const secondsToCeiling = (PASSIVE_HEALTH_CEILING - 0.2) / PASSIVE_REGEN_PER_SECOND;
  vitals.update(secondsToCeiling);
  check('linear regeneration reaches 80% on schedule', close(vitals.health, 0.8), `${vitals.health.toFixed(6)} after ${secondsToCeiling.toFixed(1)} s`);
  vitals.update(600);
  check('passive regeneration cannot exceed 80%', close(vitals.health, 0.8), `${vitals.health.toFixed(6)}`);
  check('regeneration reaches persisted state', close(persisted, 0.8), `${persisted.toFixed(6)}`);
  vitals.restoreFully();
  check('medicine restores full health', close(vitals.health, 1) && close(persisted, 1), `${vitals.health.toFixed(6)}`);
}

console.log(failures === 0 ? '\nall player-vitals checks passed' : `\n${failures} PLAYER-VITALS CHECK(S) FAILED`);
process.exitCode = failures === 0 ? 0 : 1;
