import { DREAMS, type DreamRun, type TripSummary } from './dream';

/**
 * What a dream puts on screen: one line about the goal, the waking veil, and the card
 * that ends it. Plain DOM over the canvas; the veil is a CSS blur on the canvas and a
 * pale layer above it, so waking costs a compositor pass and no shader.
 */
export class DreamView {
  private readonly line: HTMLElement;
  private readonly veil: HTMLElement;
  private lastText = '';
  private lastWake = -1;

  constructor(
    private readonly root: HTMLElement,
    private readonly canvas: HTMLCanvasElement,
  ) {
    this.line = document.createElement('div');
    this.line.style.cssText =
      'position:absolute;top:14px;left:50%;transform:translateX(-50%);padding:6px 14px;' +
      'font:600 15px/1.3 system-ui,sans-serif;color:#f4ead6;background:rgba(20,16,10,0.55);' +
      'border-radius:6px;pointer-events:none;z-index:30;white-space:nowrap';
    this.veil = document.createElement('div');
    this.veil.style.cssText =
      'position:absolute;inset:0;background:#f6efe2;opacity:0;pointer-events:none;z-index:29';
    root.append(this.veil, this.line);
  }

  /** Called every fixed step; touches the DOM only when something visible changed. */
  update(run: DreamRun): void {
    const metres = Math.abs(run.toGo);
    const distance = metres < 1000 ? `${Math.round(metres / 10) * 10} m` : `${(metres / 1000).toFixed(1)} km`;
    const cargo = run.def.cargoName;
    const goal = run.route.goalName;
    let text: string;
    if (run.outside) text = 'You are drifting out of the dream — turn back to the road';
    else if (cargo !== null && run.cargo === 'window') text = `Take the ${cargo} from the terminal in front of the car`;
    else if (cargo !== null && run.cargo === 'away') {
      text = run.departed
        ? `The ${cargo} is not with you — go back for it`
        : run.def.cargoShape === 'carpet'
          ? `Lay the ${cargo} across the back seat`
          : `Put the ${cargo} in the boot or on a seat`;
    } else if (!run.departed) text = `${goal} · drive out of the marked bay to set off`;
    else if (run.parked && cargo !== null) text = `${goal} · take the ${cargo} to the terminal`;
    else if (run.atGoal) text = `${goal} · park in the marked bay`;
    else text = run.toGo > 0 ? `${goal} · ${distance} ahead` : `${goal} · you passed it, ${distance} back`;
    // Before the start bay the line says how long there will be; from it on, how long is left.
    if (run.def.deadline && !run.outside) text += clockText(run);
    if (text !== this.lastText) {
      this.lastText = text;
      this.line.textContent = text;
    }
    // Quantised so a slow fade is a few dozen style writes, not one per step.
    const wake = Math.round(run.wake * 40) / 40;
    if (wake !== this.lastWake) {
      this.lastWake = wake;
      this.veil.style.opacity = String(wake * wake * 0.95);
      this.canvas.style.filter = wake > 0 ? `blur(${(wake * 10).toFixed(1)}px)` : '';
    }
  }

  /**
   * The closing card. On arrival it says what the drive left behind, in words: the
   * time, the parcel, the ride and the car (`TripSummary`). `onWake` runs once, from
   * the button.
   */
  finish(run: DreamRun, trip: TripSummary, onWake: () => void): void {
    this.line.remove();
    this.veil.style.opacity = '0.95';
    const card = document.createElement('div');
    card.style.cssText =
      'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;' +
      'justify-content:center;gap:14px;z-index:31;color:#2a2218;font:16px/1.4 system-ui,sans-serif;' +
      // The game's UI layer passes the pointer through to the canvas; this card takes it.
      'pointer-events:auto';
    const title = document.createElement('div');
    title.style.cssText = 'font:700 28px/1.2 system-ui,sans-serif';
    const detail = document.createElement('div');
    detail.style.cssText = 'display:flex;flex-direction:column;align-items:center;gap:4px';
    const line = (text: string): void => {
      const row = document.createElement('div');
      row.textContent = text;
      detail.appendChild(row);
    };
    if (run.phase === 'arrived') {
      title.textContent = `${run.def.title} — delivered`;
      line(
        `${run.route.startName} to ${run.route.goalName}: ${(trip.metres / 1000).toFixed(1)} km in ` +
          `${clock(trip.seconds)}, ${trip.fuelLitres.toFixed(1)} L of petrol`,
      );
      if (run.def.deadline) {
        const spare = run.limitSeconds - trip.seconds;
        line(spare >= 0 ? `On time, ${clock(spare)} to spare` : `Late by ${clock(-spare)}`);
      }
      if (run.def.cargoName !== null) {
        const parcel = Math.round(trip.parcel * 100);
        line(parcel >= 98 ? `The ${run.def.cargoName}: arrived intact` : `The ${run.def.cargoName}: ${parcel}% — it took some knocks`);
        if (trip.falls > 0) line(`It came off the seat ${trip.falls === 1 ? 'once' : trip.falls === 2 ? 'twice' : `${trip.falls} times`}`);
      }
      const ride = trip.comfort >= 0.9 ? 'smooth' : trip.comfort >= 0.6 ? 'a little rough' : 'rough';
      const moments = trip.harshMoments === 0 ? '' : ` · ${trip.harshMoments} harsh moment${trip.harshMoments === 1 ? '' : 's'}`;
      line(`The ride: ${ride}${moments}`);
      line(trip.carDamage < 0.005 ? 'The car: not a scratch' : trip.carDamage < 0.1 ? 'The car: a few scratches' : 'The car: knocked about');
      const next = DREAMS[DREAMS.findIndex((dream) => dream.id === run.def.id) + 1];
      if (next) line(`Tonight you may dream «${next.title}».`);
    } else if (run.phase === 'late') {
      title.textContent = 'Too late';
      line(`${run.route.goalName} could not wait any longer. It will be there again tonight.`);
    } else {
      title.textContent = 'The dream slipped away';
      line('You drove out of it. It will be there again tonight.');
    }
    const wake = document.createElement('button');
    wake.textContent = 'Wake up';
    wake.style.cssText =
      'margin-top:8px;padding:10px 28px;font:600 16px system-ui,sans-serif;border:0;border-radius:6px;' +
      'background:#2a2218;color:#f6efe2;cursor:pointer';
    wake.addEventListener('click', onWake, { once: true });
    card.append(title, detail, wake);
    this.root.appendChild(card);
    wake.focus();
  }
}

/** Minutes and seconds, `m:ss`. */
function clock(seconds: number): string {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
}

/** The goal line's tail for a run with a deadline: time left, or how late it already is. */
function clockText(run: DreamRun): string {
  if (!run.departed) return ` · ${clock(run.limitSeconds)} to get there`;
  const left = run.secondsLeft;
  return left >= 0 ? ` · ${clock(left)} left` : ` · ${clock(-left)} late`;
}
