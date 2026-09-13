/**
 * The light switches standing in the world, and the switches that turn them off.
 *
 * A POI building is streamed scenery: it arrives with a chunk, it leaves with one, and
 * its switches belong to it. So this is a registry with the same lifecycle as
 * `WreckTrunkField` and `CourierField` — the provider registers what it built and forgets
 * it when the chunk goes — and for the same reason: interaction must be able to answer
 * "what am I aiming at" from a flat list it can iterate, not by walking the scene graph
 * for objects that look like switches.
 *
 * The registry stores an ORIENTED box per switch rather than a physics collider. That is
 * deliberate: a switch is a fitting on a wall, and giving every one of them a rigid body
 * would put a hundred tiny colliders in the physics world to answer a question that
 * `Interaction` already answers geometrically for car boots and wreck trunks. The
 * buildings themselves are already solid — the switch is not there to be bumped into, it
 * is there to be aimed at.
 */

/**
 * One light switch, as the world sees it.
 *
 * `toggle` and `isOn` are the catalogue's own closures, which is what keeps the meaning of
 * "this room's lights" inside the building that defines it. The world never learns which
 * lights a switch controls, and never has to: it offers the player the switch and reports
 * what the switch says.
 */
export interface PoiLightSwitch {
  readonly id: string;
  /** Absolute world position of the switchplate's centre, metres. */
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** Absolute orientation of the plate, so the box below is not an approximation. */
  readonly qx: number;
  readonly qy: number;
  readonly qz: number;
  readonly qw: number;
  /** Half extents of the whole switch, handle included. */
  readonly halfExtents: readonly [number, number, number];
  /** Flips this switch's lights; returns the state it moved TO. */
  readonly toggle: () => boolean;
  /** The state before any press, so a prompt can say what pressing will do. */
  readonly isOn: () => boolean;
}

/** Live switches follow the POI chunks; nothing about them is saved. */
export class PoiSwitchField {
  private readonly switches = new Map<string, PoiLightSwitch>();

  register(entry: PoiLightSwitch): void {
    this.switches.set(entry.id, entry);
  }

  forget(ids: readonly string[]): void {
    for (const id of ids) this.switches.delete(id);
  }

  get(id: string): PoiLightSwitch | null {
    return this.switches.get(id) ?? null;
  }

  values(): IterableIterator<PoiLightSwitch> {
    return this.switches.values();
  }

  dispose(): void {
    this.switches.clear();
  }
}
