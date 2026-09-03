/**
 * The car radio: two live NTS streams, audible from the car in the world.
 *
 * The stream is routed through WebAudio so the car can be a real spatial source.
 * The station endpoints provide anonymous media CORS on every redirect, which
 * allows a panner and an exterior low-pass branch. The interior branch stays
 * direct and full-range, so sitting in the car remains the same radio signal.
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

/** Delay before retrying a dropped stream, seconds. */
const RETRY_DELAY_MS = 4000;
const SPATIAL_RAMP_SECONDS = 0.06;
const EXTERIOR_CUTOFF_HZ = 3200;

export class Radio {
  private readonly element: HTMLAudioElement;
  private readonly mediaSource: MediaElementAudioSourceNode;
  private readonly interiorGain: GainNode;
  private readonly exteriorGain: GainNode;
  private readonly exteriorMono: GainNode;
  private readonly exteriorFilter: BiquadFilterNode;
  private readonly panner: PannerNode;
  private stationIndex = 0;
  private on = false;
  private inCar = false;
  private interior = true;
  private sourceReady = false;
  private paused = false;
  private volume = 1;
  private status: Status = 'offline';
  private retryTimer = 0;
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
    this.interiorGain = ctx.createGain();
    this.interiorGain.gain.value = 1;
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
    this.mediaSource.connect(this.interiorGain).connect(ctx.destination);
    this.mediaSource.connect(this.exteriorMono).connect(this.exteriorFilter).connect(this.panner).connect(this.exteriorGain).connect(ctx.destination);

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

  /** Updates dashboard state; leaving the car does not stop its radio. */
  setInCar(inCar: boolean): void {
    if (this.inCar === inCar) return;
    this.inCar = inCar;
    if (inCar) this.sourceReady = true;
    this.sync();
  }

  /** Crossfades the untouched cabin branch and muffled exterior branch. */
  setInterior(interior: boolean): void {
    if (this.interior === interior) return;
    this.interior = interior;
    const now = this.mixer.now;
    ramp(this.interiorGain.gain, interior ? 1 : 0, now, SPATIAL_RAMP_SECONDS);
    ramp(this.exteriorGain.gain, interior ? 0 : 1, now, SPATIAL_RAMP_SECONDS);
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
      if (this.on && this.sourceReady && !this.paused) this.sync();
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
    this.element.pause();
    this.element.removeAttribute('src');
  }
}

type Status = 'connecting' | 'live' | 'offline';
