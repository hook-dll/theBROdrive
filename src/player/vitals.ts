export type CollisionExposure = 'foot' | 'car';

export const PASSIVE_HEALTH_CEILING = 0.8;
export const PASSIVE_REGEN_SECONDS_FROM_ZERO = 5 * 60;
export const PASSIVE_REGEN_PER_SECOND =
  PASSIVE_HEALTH_CEILING / PASSIVE_REGEN_SECONDS_FROM_ZERO;

const HEALTH_SYNC_SECONDS = 0.25;
const IMPACT_PULSE_FADE_PER_SECOND = 0.16;
const MILD_DAMAGE_AT_THRESHOLD = 0.05;
const SERIOUS_DAMAGE_AT_THRESHOLD = 0.25;
const DAMAGE_BELOW_LETHAL = 0.95;
/** Even the smallest harmful collision must remain visible long enough to register. */
const IMPACT_PULSE_MIN = 0.34;
const IMPACT_PULSE_MAX = 0.98;

interface CollisionBand {
  readonly harmlessBelowKmh: number;
  readonly seriousFromKmh: number;
  readonly lethalFromKmh: number;
}

const COLLISION_BANDS: Readonly<Record<CollisionExposure, CollisionBand>> = {
  foot: {
    harmlessBelowKmh: 15,
    seriousFromKmh: 35,
    lethalFromKmh: 70,
  },
  car: {
    harmlessBelowKmh: 50,
    seriousFromKmh: 90,
    lethalFromKmh: 140,
  },
};

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Maps relative closing speed to one collision's health loss. The discontinuity at
 * the first harmful kilometre is intentional: below it contact is harmless, while
 * crossing it is a small but real injury. Damage then rises continuously through
 * the mild and serious bands; the lethal boundary is an unconditional one-hit kill.
 */
export function collisionDamage(relativeKmh: number, exposure: CollisionExposure): number {
  const speed = Math.max(0, relativeKmh);
  const band = COLLISION_BANDS[exposure];
  if (speed < band.harmlessBelowKmh) return 0;
  if (speed >= band.lethalFromKmh) return 1;
  if (speed < band.seriousFromKmh) {
    return lerp(
      MILD_DAMAGE_AT_THRESHOLD,
      SERIOUS_DAMAGE_AT_THRESHOLD,
      (speed - band.harmlessBelowKmh) / (band.seriousFromKmh - band.harmlessBelowKmh),
    );
  }
  return lerp(
    SERIOUS_DAMAGE_AT_THRESHOLD,
    DAMAGE_BELOW_LETHAL,
    (speed - band.seriousFromKmh) / (band.lethalFromKmh - band.seriousFromKmh),
  );
}

/**
 * Runtime authority for hidden player health and collision-contact debouncing.
 *
 * Rapier reports a resting contact every step. `beginCollisionFrame` / `recordContact`
 * / `endCollisionFrame` turn that stream into one injury per physical impact: a pair
 * must separate before it can hurt again. If several colliders meet on one solver
 * step, only the strongest new impact is applied rather than multiplying one crash.
 */
export class PlayerVitals {
  private healthValue: number;
  private impactPulseValue = 0;
  private collisionExposure: CollisionExposure | null = null;
  private activeContacts = new Set<number>();
  private nextContacts = new Set<number>();
  private strongestNewImpactKmh = 0;
  private regenSyncElapsed = 0;
  private regenDirty = false;

  private readonly onHealthChanged: (health: number) => void;

  constructor(
    initialHealth: number,
    onHealthChanged: (health: number) => void,
  ) {
    this.healthValue = clamp01(initialHealth);
    this.onHealthChanged = onHealthChanged;
  }
  get health(): number {
    return this.healthValue;
  }

  get dead(): boolean {
    return this.healthValue <= 0;
  }

  /** Short-lived, recent-impact intensity; current health itself is never displayed. */
  get damageEffect(): number {
    return this.impactPulseValue;
  }

  update(dt: number): void {
    this.impactPulseValue = Math.max(
      0,
      this.impactPulseValue - Math.max(0, dt) * IMPACT_PULSE_FADE_PER_SECOND,
    );
    if (this.dead || this.healthValue >= PASSIVE_HEALTH_CEILING || dt <= 0) return;

    this.healthValue = Math.min(
      PASSIVE_HEALTH_CEILING,
      this.healthValue + dt * PASSIVE_REGEN_PER_SECOND,
    );
    this.regenDirty = true;
    this.regenSyncElapsed += dt;
    if (
      this.regenSyncElapsed >= HEALTH_SYNC_SECONDS
      || this.healthValue >= PASSIVE_HEALTH_CEILING
    ) {
      this.flush();
    }
  }

  beginCollisionFrame(exposure: CollisionExposure): void {
    if (this.collisionExposure !== exposure) {
      this.activeContacts.clear();
      this.collisionExposure = exposure;
    }
    this.nextContacts.clear();
    this.strongestNewImpactKmh = 0;
  }

  recordContact(colliderHandle: number, relativeClosingKmh: number): void {
    this.nextContacts.add(colliderHandle);
    if (this.activeContacts.has(colliderHandle)) return;
    this.strongestNewImpactKmh = Math.max(
      this.strongestNewImpactKmh,
      Math.max(0, relativeClosingKmh),
    );
  }

  endCollisionFrame(): number {
    const previousContacts = this.activeContacts;
    this.activeContacts = this.nextContacts;
    this.nextContacts = previousContacts;

    const exposure = this.collisionExposure;
    if (exposure === null || this.strongestNewImpactKmh <= 0) return 0;
    return this.applyDamage(collisionDamage(this.strongestNewImpactKmh, exposure));
  }

  restoreFully(): void {
    if (this.healthValue >= 1) return;
    this.healthValue = 1;
    this.impactPulseValue = 0;
    this.syncImmediately();
  }

  /** Flushes sub-second passive regeneration before a save snapshot. */
  flush(): void {
    if (!this.regenDirty) return;
    this.syncImmediately();
  }

  private applyDamage(amount: number): number {
    if (amount <= 0 || this.dead) return 0;
    const applied = Math.min(this.healthValue, amount);
    this.healthValue -= applied;
    const visiblePulse =
      IMPACT_PULSE_MIN + clamp01(amount) * (IMPACT_PULSE_MAX - IMPACT_PULSE_MIN);
    this.impactPulseValue = Math.max(this.impactPulseValue, visiblePulse);
    this.syncImmediately();
    return applied;
  }

  private syncImmediately(): void {
    this.regenDirty = false;
    this.regenSyncElapsed = 0;
    this.onHealthChanged(this.healthValue);
  }
}
