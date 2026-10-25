/**
 * DEV LOOK VARIANTS: which of the trial designs the post's furniture is built in, so the
 * owner can walk round each and pick one (2026-10-26). Read once at module load from
 * localStorage; the dev menu (ui/menu.ts) writes the next one and reloads, since the
 * stops are built when their chunk streams in. Production builds and headless tools
 * read the defaults.
 *
 *  - `machine`: the card machines' cabinet (world/cardmachine.ts): `soda` a Soviet soda
 *    fountain, `arcade` an arcade cabinet, `safe` a riveted post-office safe.
 *  - `stand`: the toy box's stand (world/toystand.ts): `dome` a model under a bell of
 *    brass hoops on a pedestal, `carousel` a fairground carousel drum, `podium` a
 *    showroom podium.
 */

export const MACHINE_STYLES = ['soda', 'arcade', 'safe'] as const;
export type MachineStyle = (typeof MACHINE_STYLES)[number];
export const TOY_STANDS = ['dome', 'carousel', 'podium'] as const;
export type ToyStand = (typeof TOY_STANDS)[number];

const KEY = 'bro.devLook';

interface DevLook {
  readonly machine: MachineStyle;
  readonly stand: ToyStand;
}

function read(): DevLook {
  const fallback: DevLook = { machine: 'soda', stand: 'dome' };
  if (!import.meta.env?.DEV || typeof localStorage === 'undefined') return fallback;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Record<keyof DevLook, string>>;
    return {
      machine: (MACHINE_STYLES as readonly string[]).includes(raw.machine ?? '') ? (raw.machine as MachineStyle) : fallback.machine,
      stand: (TOY_STANDS as readonly string[]).includes(raw.stand ?? '') ? (raw.stand as ToyStand) : fallback.stand,
    };
  } catch {
    return fallback;
  }
}

/** The variants this session builds with. */
export const devLook: DevLook = read();

/** Writes the next variant of `which` for the next load; the caller reloads. Returns it. */
export function cycleDevLook(which: keyof DevLook): string {
  const list: readonly string[] = which === 'machine' ? MACHINE_STYLES : TOY_STANDS;
  const next = list[(list.indexOf(devLook[which]) + 1) % list.length]!;
  localStorage.setItem(KEY, JSON.stringify({ ...devLook, [which]: next }));
  return next;
}
