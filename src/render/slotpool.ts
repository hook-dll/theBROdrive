/**
 * A fixed number of slots shared by lamps that come and go, handed over so that no
 * lamp's light ever STEPS on or off while it is still worth seeing.
 *
 * The vehicle spotlights and the road's headlamp streaks are both fixed pools: their
 * size is compiled into shaders (render/vehiclelights.ts, render/cloudshadow.ts). They
 * used to be refilled from scratch every frame, nearest lamp first, so whenever the
 * order changed — an oncoming car passing a nearer one, a car falling behind — one lamp
 * lost its slot and another took it in the same frame, at full strength. Measured on a
 * night drive with standard traffic, other cars' pools of light switched on and off at
 * 20-120 m and their streaks on the road at 70-170 m, and the driven car's own tail
 * glow, offered after every other car's headlamps, never got a slot at all.
 *
 * Here a slot is HELD, not reassigned. Each frame the caller requests groups in
 * priority order; the pool works out which of them deserve a slot, fades the ones that
 * no longer do out over `fadeSeconds` while they keep their slot, and only then fades
 * the newcomers in. A handover therefore costs up to two fade times and is never seen
 * as a switch.
 *
 * PINNED groups (the driven car's own lamps) are not faded: they take their slots the
 * frame they ask, evicting the lowest held groups if the pool is full. That is the one
 * remaining step, and it only happens when the player himself switches a lamp on.
 *
 * A group that is not requested at all in a frame is forgotten at once. Callers only
 * stop requesting a lamp whose light has already gone to nothing (it was switched
 * off, it fell past the range fade, or it turned to point away), so nothing is lost.
 */

interface PoolEntry {
  /** 0..1, linear; `share` eases it. */
  fade: number;
  need: number;
  pinned: boolean;
  /** Frame this entry was last requested in. */
  frame: number;
  /** Whether it deserves a slot this frame. */
  desired: boolean;
}

export class FadingSlotPool {
  readonly capacity: number;
  private readonly fadeSeconds: number;
  private readonly entries = new Map<object, PoolEntry[]>();
  /** This frame's requests, in priority order. */
  private readonly requested: PoolEntry[] = [];
  private frame = 0;
  /** Drops groups nobody asked for this frame, and owners left with none. */
  private readonly prune = (groups: PoolEntry[], owner: object): void => {
    let live = false;
    for (let i = 0; i < groups.length; i++) {
      const entry = groups[i];
      if (!entry) continue;
      if (entry.frame === this.frame) live = true;
      else entry.fade = 0;
    }
    if (!live) this.entries.delete(owner);
  };

  constructor(capacity: number, fadeSeconds: number) {
    this.capacity = capacity;
    this.fadeSeconds = fadeSeconds;
  }

  /** Starts a frame's requests. */
  begin(): void {
    this.frame++;
    this.requested.length = 0;
  }

  /**
   * Asks for `need` slots for one of `owner`'s lamp groups. Call in priority order,
   * pinned groups first; a need of zero is no request.
   */
  request(owner: object, group: number, need: number, pinned: boolean): void {
    if (!(need > 0)) return;
    let groups = this.entries.get(owner);
    if (!groups) {
      groups = [];
      this.entries.set(owner, groups);
    }
    let entry = groups[group];
    if (!entry) {
      entry = { fade: 0, need, pinned, frame: 0, desired: false };
      groups[group] = entry;
    }
    if (entry.frame === this.frame) return;
    entry.frame = this.frame;
    entry.need = need;
    entry.pinned = pinned;
    this.requested.push(entry);
  }

  /** Settles who holds a slot this frame and advances every fade by `dt` seconds. */
  resolve(dt: number): void {
    this.entries.forEach(this.prune);
    const requested = this.requested;
    // Who deserves a slot: the pinned first, then the rest in the caller's order.
    let room = this.capacity;
    for (const entry of requested) {
      entry.desired = entry.pinned && entry.need <= room;
      if (entry.desired) room -= entry.need;
    }
    for (const entry of requested) {
      if (entry.pinned) continue;
      entry.desired = entry.need <= room;
      if (entry.desired) room -= entry.need;
    }

    // Who occupies one. Pinned at full, then every group already holding a slot —
    // fading up if it still deserves it, down if not — and newcomers last, into
    // whatever that leaves.
    const step = this.fadeSeconds > 0 ? Math.max(0, dt) / this.fadeSeconds : 1;
    room = this.capacity;
    for (const entry of requested) {
      if (!entry.pinned) continue;
      entry.fade = entry.desired ? 1 : 0;
      if (entry.desired) room -= entry.need;
    }
    for (const entry of requested) {
      if (entry.pinned || entry.fade <= 0) continue;
      if (entry.need > room) {
        entry.fade = 0;
        continue;
      }
      entry.fade = entry.desired ? Math.min(1, entry.fade + step) : Math.max(0, entry.fade - step);
      if (entry.fade > 0) room -= entry.need;
    }
    for (const entry of requested) {
      if (entry.pinned || entry.fade > 0 || !entry.desired || entry.need > room) continue;
      entry.fade = Math.min(1, step);
      room -= entry.need;
    }
  }

  /**
   * The share of its light a group may show this frame, 0..1, eased at both ends.
   * Zero means it holds no slot and must offer nothing.
   */
  share(owner: object, group: number): number {
    const entry = this.entries.get(owner)?.[group];
    if (!entry || entry.frame !== this.frame) return 0;
    const t = entry.fade;
    return t * t * (3 - 2 * t);
  }

  /** Forgets every holder. */
  clear(): void {
    this.entries.clear();
    this.requested.length = 0;
  }
}
