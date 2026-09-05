/**
 * The car radio: two live NTS streams, audible from the car in the world.
 *
 * The stream is routed through WebAudio so the car can be a real spatial source.
 * The station endpoints provide anonymous media CORS on every redirect, which
 * allows the spatialised low-pass branch.
 */

import { AudioMixer, ramp } from './mixer';

export interface RadioStation {
  readonly label: string;
  readonly url: string;
}

export const RADIO_STATIONS: readonly RadioStation[] = [
  { label: 'NTS 1', url: 'https://streams.radiomast.io/nts1' },
  { label: 'NTS 2', url: 'https://streams.radiomast.io/nts2' },
];

/** Listener and car positions in the renderer's current relative world frame. */
export interface RadioSpatialState {
  sourceX: number | null;
  sourceY: number | null;
  sourceZ: number | null;
  listenerX: number;
  listenerY: number;
  listenerZ: number;
  listenerQx: number;
  listenerQy: number;
  listenerQz: number;
  listenerQw: number;
}

/**
 * Reconnect backoff, milliseconds.
 *
 * A dead relay used to be retried every four seconds forever, and every attempt is
 * a fresh request the BROWSER logs itself — unreachable streams filled the console
 * with network errors no `catch` here can suppress. Doubling up to a minute keeps a
 * temporary drop recovering quickly while a blocked or offline machine settles into
 * one attempt a minute.
 */
const RETRY_BASE_MS = 4000;
const RETRY_MAX_MS = 60000;
const SPATIAL_RAMP_SECONDS = 0.06;
const EXTERIOR_CUTOFF_HZ = 3200;

export class Radio {
  private readonly element: HTMLAudioElement;
  private readonly mediaSource: MediaElementAudioSourceNode;
  private readonly cabinGain: GainNode;
  private readonly exteriorGain: GainNode;
  private readonly exteriorMono: GainNode;
  private readonly exteriorFilter: BiquadFilterNode;
  private readonly panner: PannerNode;
  private stationIndex = 0;
  private on = false;
  private seated = true;
  private inCar = false;
  private sourceReady = false;
  private paused = false;
  private volume = 1;
  private status: Status = 'offline';
  private retryTimer = 0;
  /** Grows with each consecutive failure; reset the moment audio actually plays. */
  private retryDelayMs = RETRY_BASE_MS;
  private disposed = false;

  constructor(private readonly mixer: AudioMixer) {
    const ctx = mixer.ctx;
    this.element = new Audio();
    // This must be set before a source URL is assigned. The station endpoints opt into it.
    this.element.crossOrigin = 'anonymous';
    this.element.preload = 'none';
    // A live stream has no duration to seek in and no reason to loop.
    this.element.loop = false;

    this.mediaSource = ctx.createMediaElementSource(this.element);
    this.cabinGain = ctx.createGain();
    this.cabinGain.gain.value = 1;
    this.exteriorGain = ctx.createGain();
    this.exteriorGain.gain.value = 0;
    // A car is a single exterior source: collapse stereo before spatializing it.
    // The speakers interpretation averages left and right into the mono channel.
    this.exteriorMono = ctx.createGain();
    this.exteriorMono.channelCount = 1;
    this.exteriorMono.channelCountMode = 'explicit';
    this.exteriorFilter = ctx.createBiquadFilter();
    this.exteriorFilter.type = 'lowpass';
    this.exteriorFilter.frequency.value = EXTERIOR_CUTOFF_HZ;
    this.exteriorFilter.Q.value = 0.5;
    this.panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 3,
      rolloffFactor: 0.7,
      maxDistance: 180,
    });
    this.mediaSource.connect(this.cabinGain).connect(ctx.destination);
    this.mediaSource.connect(this.exteriorMono).connect(this.exteriorFilter).connect(this.panner).connect(this.exteriorGain).connect(ctx.destination);

    this.element.addEventListener('playing', this.onPlaying);
    this.element.addEventListener('waiting', this.onWaiting);
    this.element.addEventListener('error', this.onError);
    this.element.addEventListener('stalled', this.onError);
    this.element.addEventListener('ended', this.onError);
    window.addEventListener('online', this.onOnline);
  }

  /** True when the radio is switched on, regardless of whether it can be heard. */
  get enabled(): boolean {
    return this.on;
  }

  get station(): RadioStation {
    return RADIO_STATIONS[this.stationIndex]!;
  }

  /** HUD line, or null when the radio has no dashboard to report on. */
  get readout(): string | null {
    if (!this.inCar) return null;
    if (!this.on) return 'RADIO OFF';
    const suffix = this.status === 'live' ? '' : this.status === 'connecting' ? ' · tuning' : ' · no signal';
    return `RADIO ${this.station.label}${suffix}`;
  }

  /** Switches the radio on or off. Returns the new on/off state. */
  toggle(): boolean {
    this.on = !this.on;
    this.resetBackoff();
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
    this.resetBackoff();
    this.sync();
    return this.station;
  }

  /** Updates dashboard state; leaving the car does not stop its radio. */
  setInCar(inCar: boolean): void {
    if (this.inCar === inCar) return;
    this.inCar = inCar;
    if (inCar) this.sourceReady = true;
    this.sync();
  }

  /** Crossfades between the cabin and spatialised branches when occupancy changes. */
  setSeated(seated: boolean): void {
    if (this.seated === seated) return;
    this.seated = seated;
    const now = this.mixer.now;
    ramp(this.cabinGain.gain, seated ? 1 : 0, now, SPATIAL_RAMP_SECONDS);
    ramp(this.exteriorGain.gain, seated ? 0 : 1, now, SPATIAL_RAMP_SECONDS);
  }

  /** Updates the listener pose without allocating per frame. */
  setListener(spatial: RadioSpatialState): void {
    const listener = this.mixer.ctx.listener;
    listener.positionX.value = spatial.listenerX;
    listener.positionY.value = spatial.listenerY;
    listener.positionZ.value = spatial.listenerZ;

    const { listenerQx: x, listenerQy: y, listenerQz: z, listenerQw: w } = spatial;
    // Camera local forward is -Z and local up is +Y.
    listener.forwardX.value = -2 * (x * z + y * w);
    listener.forwardY.value = 2 * (x * w - y * z);
    listener.forwardZ.value = -1 + 2 * (x * x + y * y);
    listener.upX.value = 2 * (x * y - z * w);
    listener.upY.value = 1 - 2 * (x * x + z * z);
    listener.upZ.value = 2 * (y * z + x * w);
  }

  /** Updates this car's source position when it is the driven car. */
  setSourcePosition(x: number, y: number, z: number): void {
    const now = this.mixer.now;
    // The car is intentionally not snapped to the listener: PannerNode supplies
    // both distance attenuation and left/right localization from this pose.
    this.panner.positionX.setTargetAtTime(x, now, SPATIAL_RAMP_SECONDS);
    this.panner.positionY.setTargetAtTime(y, now, SPATIAL_RAMP_SECONDS);
    this.panner.positionZ.setTargetAtTime(z, now, SPATIAL_RAMP_SECONDS);
  }

  /** Updates the listener and, when supplied, this car's source pose. */
  setSpatial(spatial: RadioSpatialState): void {
    this.setListener(spatial);
    if (spatial.sourceX !== null && spatial.sourceY !== null && spatial.sourceZ !== null) {
      this.setSourcePosition(spatial.sourceX, spatial.sourceY, spatial.sourceZ);
    }
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

  /** Brings the stream in line with its desired state. */
  private sync(): void {
    if (this.disposed) return;
    // sourceReady survives exit: the last car remains the radio's sound source while
    // the player walks away. Only switching off, pausing, or never having entered a
    // car tears down the live connection.
    const shouldPlay = this.on && this.sourceReady && !this.paused;

    if (!shouldPlay) {
      this.clearRetry();
      this.element.pause();
      // Dropping the source actually closes the live connection.
      this.element.removeAttribute('src');
      this.status = 'offline';
      return;
    }

    // A machine that knows it has no network cannot reach a relay, so do not ask:
    // the attempt would only add another logged failure. The browser's `online`
    // event resumes tuning the moment connectivity returns.
    if (navigator.onLine === false) {
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
    const delay = this.retryDelayMs;
    this.retryDelayMs = Math.min(RETRY_MAX_MS, this.retryDelayMs * 2);
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = 0;
      if (this.on && this.sourceReady && !this.paused) this.sync();
    }, delay);
  }

  private clearRetry(): void {
    if (this.retryTimer === 0) return;
    window.clearTimeout(this.retryTimer);
    this.retryTimer = 0;
  }

  /**
   * A deliberate act — switching on, or changing station — is the player asking for
   * this NOW, so it starts the backoff over instead of inheriting a minute-long wait
   * accumulated while the machine was offline.
   */
  private resetBackoff(): void {
    this.retryDelayMs = RETRY_BASE_MS;
    this.clearRetry();
  }

  private onPlaying = (): void => {
    this.status = 'live';
    this.retryDelayMs = RETRY_BASE_MS;
    this.clearRetry();
  };

  private onWaiting = (): void => {
    if (this.status === 'live') this.status = 'connecting';
  };

  private onOnline = (): void => {
    if (this.on && this.sourceReady && !this.paused) {
      this.resetBackoff();
      this.sync();
    }
  };

  private onError = (): void => {
    if (!this.on || !this.sourceReady || this.paused) return;
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
    window.removeEventListener('online', this.onOnline);
    this.element.pause();
    this.element.removeAttribute('src');
  }
}

type Status = 'connecting' | 'live' | 'offline';
