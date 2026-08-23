/**
 * The car radio: two live NTS streams, audible only from the driver's seat.
 *
 * This is the one sound in the game that is not synthesised, and it deliberately
 * stays out of the WebAudio graph. Routing a cross-origin stream through a
 * MediaElementAudioSourceNode requires the server to opt in with CORS headers; a
 * stream that does not send them is silently muted forever. A bare
 * HTMLAudioElement has no such requirement, plays the same bytes, and gives us the
 * one control we actually need (volume). So the radio is its own output path, and
 * the mixer's master volume does not apply to it — it has its own setting.
 *
 * Off the seat it is not merely muted but paused: this is a live stream, and
 * keeping it connected while the player walks around a homestead is bandwidth
 * spent on audio nobody can hear. Re-entering the car reconnects, which is what a
 * live stream does anyway — there is no position to resume.
 */

export interface RadioStation {
  readonly label: string;
  readonly url: string;
}

export const RADIO_STATIONS: readonly RadioStation[] = [
  { label: 'NTS 1', url: 'https://stream-relay-geo.ntslive.net/stream' },
  { label: 'NTS 2', url: 'https://stream-relay-geo.ntslive.net/stream2' },
];

/** Delay before retrying a dropped stream, seconds. */
const RETRY_DELAY_MS = 4000;

type Status = 'connecting' | 'live' | 'offline';

export class Radio {
  private readonly element: HTMLAudioElement;
  private stationIndex = 0;
  private on = false;
  private inCar = false;
  private paused = false;
  private volume = 1;
  private status: Status = 'offline';
  private retryTimer = 0;
  private disposed = false;

  constructor() {
    this.element = new Audio();
    this.element.preload = 'none';
    // A live stream has no duration to seek in and no reason to loop.
    this.element.loop = false;
    this.element.addEventListener('playing', this.onPlaying);
    this.element.addEventListener('waiting', this.onWaiting);
    this.element.addEventListener('error', this.onError);
    this.element.addEventListener('stalled', this.onError);
    this.element.addEventListener('ended', this.onError);
  }

  /** True when the radio is switched on, regardless of whether it can be heard. */
  get enabled(): boolean {
    return this.on;
  }

  get station(): RadioStation {
    return RADIO_STATIONS[this.stationIndex]!;
  }

  /**
   * HUD line, or null when there is nothing to say: the radio is a car fitting, so
   * on foot it is not merely off — it is not there.
   */
  get readout(): string | null {
    if (!this.inCar) return null;
    if (!this.on) return 'RADIO OFF';
    const suffix = this.status === 'live' ? '' : this.status === 'connecting' ? ' · tuning' : ' · no signal';
    return `RADIO ${this.station.label}${suffix}`;
  }

  /** Switches the radio on or off. Returns the new on/off state. */
  toggle(): boolean {
    this.on = !this.on;
    this.sync();
    return this.on;
  }

  /** Next station, switching the radio on if it was off. Returns the station. */
  next(): RadioStation {
    if (this.on) this.stationIndex = (this.stationIndex + 1) % RADIO_STATIONS.length;
    else this.on = true;
    // A station change is a new source, so the current one must be dropped.
    this.element.pause();
    this.element.removeAttribute('src');
    this.sync();
    return this.station;
  }

  /** Driving or not. The only gate on whether the radio can be heard at all. */
  setInCar(inCar: boolean): void {
    if (this.inCar === inCar) return;
    this.inCar = inCar;
    this.sync();
  }

  setVolume(volume: number): void {
    this.volume = Math.min(1, Math.max(0, volume));
    this.element.volume = this.volume;
  }

  /** Pause menu: silence the radio without forgetting that it was on. */
  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.sync();
  }

  /**
   * Brings the element in line with the desired state. Everything above changes a
   * flag and calls this, so there is exactly one place that decides whether the
   * stream should be connected.
   */
  private sync(): void {
    if (this.disposed) return;
    const shouldPlay = this.on && this.inCar && !this.paused;

    if (!shouldPlay) {
      this.clearRetry();
      this.element.pause();
      // Dropping the source is what actually closes the connection; pausing a live
      // stream leaves it buffering in the background.
      this.element.removeAttribute('src');
      this.status = 'offline';
      return;
    }

    const url = this.station.url;
    if (this.element.getAttribute('src') !== url) {
      this.element.src = url;
      this.element.load();
    }
    this.element.volume = this.volume;
    this.status = 'connecting';
    void this.element.play().catch(() => {
      // Autoplay refusal (no gesture yet) or a dead relay: both are retried, and
      // both leave the radio switched on so the next attempt is automatic.
      this.status = 'offline';
      this.scheduleRetry();
    });
  }

  private scheduleRetry(): void {
    if (this.retryTimer !== 0 || this.disposed) return;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = 0;
      if (this.on && this.inCar && !this.paused) this.sync();
    }, RETRY_DELAY_MS);
  }

  private clearRetry(): void {
    if (this.retryTimer === 0) return;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = 0;
  }

  private onPlaying = (): void => {
    this.status = 'live';
    this.clearRetry();
  };

  private onWaiting = (): void => {
    if (this.status === 'live') this.status = 'connecting';
  };

  private onError = (): void => {
    if (!this.on || !this.inCar || this.paused) return;
    this.status = 'offline';
    this.scheduleRetry();
  };

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clearRetry();
    this.element.removeEventListener('playing', this.onPlaying);
    this.element.removeEventListener('waiting', this.onWaiting);
    this.element.removeEventListener('error', this.onError);
    this.element.removeEventListener('stalled', this.onError);
    this.element.removeEventListener('ended', this.onError);
    this.element.pause();
    this.element.removeAttribute('src');
  }
}
