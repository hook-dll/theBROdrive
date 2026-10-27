/**
 * The single audio surface the game talks to.
 *
 * main.ts owns one of these and calls it with what already happened this frame;
 * nothing below it reads game state, and nothing above it knows what an
 * AudioContext is. The split matters because audio is the one subsystem that must
 * survive being switched off entirely (no gesture yet, muted setting, paused menu)
 * without every caller learning to check first.
 */

import type { SurfaceType } from '../core/surfaces';
import type { Settings } from '../game/settings';
import type { VehicleAudioState } from '../vehicle/vehicle';
import { AudioMixer, setListenerPose, setPannerPosition, sliderGain } from './mixer';
import { playCrash, VehicleAudio, type CarPose } from './vehicleaudio';
import { TRAFFIC_RELEASE_S, TrafficAudio } from './trafficaudio';
import type { SampleName } from './samples';
import { Ambience, type AmbienceFrame } from './ambience';
import type { CabinOpenness } from './cabinopenness';
import { Foley, type BubbleGumAudioPhase, type FoleyContinuous, type FoleyEvent } from './foley';
import { Radio, type RadioSpatialState } from './radio';
import { createPropellerVoice, createSurfVoice, type PropellerVoice, type SurfVoice } from './storyaudio';
export type { RadioSpatialState } from './radio';
export type { CarPose } from './vehicleaudio';
export type { AmbienceFrame } from './ambience';
export type { PropellerVoice, SurfVoice } from './storyaudio';

/** Traffic cars given a voice at once: the nearest few are all anyone can pick out. */
const TRAFFIC_VOICES = 6;
/** Beyond this a traffic car is not given a voice, metres. */
const TRAFFIC_HEAR_M = 380;
/** A voiced car keeps its voice out to this distance, metres. */
const TRAFFIC_KEEP_M = 400;
/**
 * VOICE HYSTERESIS. A car among the nearest few takes a voice from one that has dropped
 * out of them only when it is this much nearer (a ratio of distances). Without it two
 * cars at about the same distance either side of the sixth place traded a voice back
 * and forth, each trade a fade out and a fade in.
 */
const TRAFFIC_STEAL_RATIO = 1.25;
/** Released voices kept parked for the next car that needs one (trafficaudio.ts). */
const TRAFFIC_POOL = 3;
/**
 * A traffic car's impact, m/s of unexplained velocity change (the `Vehicle` impact
 * detector), heard as a crash. Higher than the driven car's 0.3: a nudge in a jam is
 * felt through the seat, but from another car it would be noise.
 */
const TRAFFIC_CRASH_MIN_MPS = 1.2;
/** One crash per hit and car: the detector reports every step of a scrape. */
const TRAFFIC_CRASH_REPEAT_S = 0.35;
/** How long a crash's own panner lives: the longest take (crash-2, 4.4 s) and a margin. */
const TRAFFIC_CRASH_LIFE_MS = 5000;

interface TrafficCandidate {
  id: string;
  state: VehicleAudioState;
  x: number;
  y: number;
  z: number;
  d2: number;
}

/** A traffic voice and whom it belongs to. */
interface TrafficVoice {
  readonly audio: TrafficAudio;
  id: string;
  /** Its car's offer this frame, null if the car was not offered. */
  candidate: TrafficCandidate | null;
  /** Mixer time a released voice's fade is over. */
  parkAt: number;
}

export class GameAudio {
  private readonly mixer = new AudioMixer();
  private readonly vehicle = new VehicleAudio(this.mixer);
  private readonly foleyVoices = new Foley(this.mixer);
  private readonly ambience = new Ambience(this.mixer);
  private readonly radios = new Map<string, Radio>();
  /** Voiced cars by id, and the same voices as a list (at most TRAFFIC_VOICES). */
  private readonly trafficVoices = new Map<string, TrafficVoice>();
  private readonly trafficActive: TrafficVoice[] = [];
  /** Released voices fading out, then parked ones waiting for another car. */
  private readonly trafficReleasing: TrafficVoice[] = [];
  private readonly trafficPool: TrafficVoice[] = [];
  private readonly trafficCandidates: TrafficCandidate[] = [];
  private trafficCandidateCount = 0;
  /** Per traffic car, when its last crash was heard; pruned to the cars still offered. */
  private readonly trafficCrashAt = new Map<string, number>();
  private lastTrafficCrash: SampleName | null = null;
  private radioStationUrls: readonly string[] = ['https://streams.radiomast.io/nts1', 'https://streams.radiomast.io/nts2'];
  private activeRadioId: string | null = null;
  /** Last pose written to the context listener; NaN so the first frame always writes. */
  private listenerX = Number.NaN;
  private listenerY = Number.NaN;
  private listenerZ = Number.NaN;
  private listenerQx = Number.NaN;
  private listenerQy = Number.NaN;
  private listenerQz = Number.NaN;
  private listenerQw = Number.NaN;
  /** Listener's horizontal right vector, for panning world directions (thunder). */
  private listenerRightX = 1;
  private listenerRightZ = 0;
  /** Cutscene voices (the propeller and the surf), made on demand and stopped with them. */
  private readonly storyVoices: { dispose(): void }[] = [];
  /** The World slider's position, so a duck can be released back onto it. */
  private worldVolume = 1;

  applySettings(settings: Settings): void {
    this.worldVolume = settings.worldVolume;
    this.mixer.setVolume(settings.masterVolume);
    this.mixer.setBusVolumes(settings.carVolume, settings.worldVolume, settings.radioVolume);
    this.radioStationUrls = [settings.radioStation1Url, settings.radioStation2Url];
    for (const radio of this.radios.values()) {
      radio.setStationUrls(this.radioStationUrls);
    }
  }

  /**
   * The story's own voices (audio/storyaudio.ts). They are synthesised, and they sit
   * under the master but OUTSIDE the world bus, so `setWorldLevel` ducking the world
   * while the plane is the subject does not duck the plane itself.
   */
  createPropellerVoice(): PropellerVoice {
    const voice = createPropellerVoice(this.mixer);
    this.storyVoices.push(voice);
    return voice;
  }

  createSurfVoice(): SurfVoice {
    const voice = createSurfVoice(this.mixer);
    this.storyVoices.push(voice);
    return voice;
  }

  /**
   * Ducks everything on the World bus — ambience, weather, animals and the other
   * traffic — to `level` of the player's own World volume, over `tau` seconds. Used
   * while a cutscene owns the scene; the recording voices themselves keep their
   * levels, so releasing the duck restores exactly what was there.
   */
  setWorldLevel(level: number, tau = 0.5): void {
    const clamped = level < 0 ? 0 : level > 1 ? 1 : level;
    this.mixer.world.gain.setTargetAtTime(
      sliderGain(this.worldVolume) * clamped,
      this.mixer.now,
      Math.max(0.01, tau),
    );
  }

  /**
   * Dev: a thunderclap `distance` metres away on the given bearing, as a real stroke
   * would be heard (`__bro.audio.thunder(1200)`), for judging the takes by ear.
   */
  thunder(distance = 1500, azimuth = 0): void {
    this.ambience.testThunder(distance, azimuth, this.listenerRightX, this.listenerRightZ);
  }

  /** Dev: every bus's loudness and peak right now (see AudioMixer.meter). */
  meter(): ReturnType<AudioMixer['meter']> {
    return this.mixer.meter();
  }

  setPaused(paused: boolean): void {
    this.mixer.setPaused(paused);
    for (const radio of this.radios.values()) radio.setPaused(paused);
  }

  /**
   * Per-frame car audio. Every entered car owns its own radio stream; inactive
   * radios remain spatial sources while the listener walks around the world.
   * `pose` places the car's sound sources; `cabin` is how open the cabin round the
   * listener is to each ear, null outside it (on foot, the chase view).
   */
  updateDriving(
    state: VehicleAudioState | null,
    radioSpatial: RadioSpatialState,
    radioCarId: string | null,
    pose: CarPose | null,
    cabin: CabinOpenness | null,
    dt: number,
  ): void {
    // The listener first: the car's panners are placed against it this frame.
    this.writeListener(radioSpatial);
    this.vehicle.setActive(state !== null && pose !== null);
    this.vehicle.setPerspective(cabin ? 'cabin' : 'outside', cabin ? (cabin.left + cabin.right) / 2 : 0);
    this.mixer.setCabinShell(cabin?.left ?? null, cabin?.right ?? null);
    if (state && pose) this.vehicle.update(state, pose, dt);
    this.activeRadioId = radioCarId;

    for (const [id, radio] of this.radios) {
      if (id === radioCarId) {
        if (
          radioSpatial.sourceX !== null &&
          radioSpatial.sourceY !== null &&
          radioSpatial.sourceZ !== null
        ) {
          radio.setSourcePosition(radioSpatial.sourceX, radioSpatial.sourceY, radioSpatial.sourceZ);
        }
        // The radio is a fitting of the car being driven, so audio remains in the
        // cabin regardless of a camera distance selected purely for the view.
        radio.setSeated(true);
        radio.setInCar(true);
      } else {
        radio.setSeated(false);
        radio.setInCar(false);
      }
    }
  }

  /** Per-frame world ambience: air, weather, thunder, animals. */
  updateAmbience(frame: AmbienceFrame, dt: number): void {
    this.ambience.update(frame, dt, this.listenerRightX, this.listenerRightZ);
  }

  /** A flock taking off at a (relative) world position. */
  flockTakeoff(x: number, y: number, z: number, count: number, large: boolean): void {
    this.ambience.flockTakeoff(x, y, z, count, large);
  }

  /** One bird calling at a (relative) world position; `species` as agents/birds.ts names it. */
  birdCall(species: string, x: number, y: number, z: number): void {
    const distance = Math.hypot(x - this.listenerX, y - this.listenerY, z - this.listenerZ);
    this.ambience.birdCall(species, x, y, z, Number.isFinite(distance) ? distance : 50);
  }

  beginTrafficFrame(): void {
    this.trafficCandidateCount = 0;
  }

  /** Offers one traffic car for a voice this frame; the nearest few get one. */
  updateTrafficVehicle(
    id: string,
    state: VehicleAudioState,
    x: number,
    y: number,
    z: number,
  ): void {
    const dx = x - this.listenerX;
    const dy = y - this.listenerY;
    const dz = z - this.listenerZ;
    const d2 = dx * dx + dy * dy + dz * dz;
    let c = this.trafficCandidates[this.trafficCandidateCount];
    if (!c) {
      c = { id, state, x, y, z, d2 };
      this.trafficCandidates.push(c);
    } else {
      c.id = id;
      c.state = state;
      c.x = x;
      c.y = y;
      c.z = z;
      c.d2 = d2;
    }
    this.trafficCandidateCount++;
  }

  endTrafficFrame(dt: number): void {
    const list = this.trafficCandidates;
    const count = this.trafficCandidateCount;
    // Partial selection of the nearest TRAFFIC_VOICES; the list is a dozen long.
    for (let i = 0; i < Math.min(count, TRAFFIC_VOICES); i++) {
      let best = i;
      for (let j = i + 1; j < count; j++) if (list[j]!.d2 < list[best]!.d2) best = j;
      if (best !== i) {
        const tmp = list[i]!;
        list[i] = list[best]!;
        list[best] = tmp;
      }
    }
    const hearD2 = TRAFFIC_HEAR_M * TRAFFIC_HEAR_M;
    // Crashes first, for EVERY car offered, not only the voiced few: a car hitting a
    // pole beside the road is rarely among the nearest six, and its impact would
    // otherwise wait in its state until it next got a voice, which drops it.
    for (let i = 0; i < count; i++) {
      const c = list[i]!;
      const impact = c.state.impactMps;
      c.state.impactMps = 0;
      if (impact > TRAFFIC_CRASH_MIN_MPS && c.d2 <= hearD2) this.trafficCrash(c, impact);
    }
    if (this.trafficCrashAt.size > 0) this.trafficCrashAt.forEach(this.pruneTrafficCrash);

    // Each voice finds its car's offer; a car gone or out of earshot gives its voice up.
    const active = this.trafficActive;
    for (let v = 0; v < active.length; v++) active[v]!.candidate = null;
    for (let i = 0; i < count; i++) {
      const voice = this.trafficVoices.get(list[i]!.id);
      if (voice) voice.candidate = list[i]!;
    }
    const keepD2 = TRAFFIC_KEEP_M * TRAFFIC_KEEP_M;
    for (let v = active.length - 1; v >= 0; v--) {
      const candidate = active[v]!.candidate;
      if (!candidate || candidate.d2 > keepD2) this.releaseTrafficVoice(v);
    }
    // The nearest few take a voice: a free one, or one from a car that has fallen out of
    // them, if this car is clearly the nearer (TRAFFIC_STEAL_RATIO).
    const stealD2 = TRAFFIC_STEAL_RATIO * TRAFFIC_STEAL_RATIO;
    for (let i = 0; i < Math.min(count, TRAFFIC_VOICES); i++) {
      const c = list[i]!;
      if (c.d2 > hearD2) break;
      if (this.trafficVoices.has(c.id)) continue;
      if (active.length >= TRAFFIC_VOICES) {
        let farthest = 0;
        for (let v = 1; v < active.length; v++) {
          if (active[v]!.candidate!.d2 > active[farthest]!.candidate!.d2) farthest = v;
        }
        if (c.d2 * stealD2 >= active[farthest]!.candidate!.d2) continue;
        this.releaseTrafficVoice(farthest);
      }
      this.acquireTrafficVoice(c);
    }
    for (let v = 0; v < active.length; v++) {
      const voice = active[v]!;
      const c = voice.candidate!;
      voice.audio.update(c.state, c.x, c.y, c.z, this.listenerX, this.listenerY, this.listenerZ, dt);
    }

    // Faded voices are parked for the next car, or let go past the pool's size. A
    // context that is not running (no gesture yet) plays nothing, so nothing to wait for.
    const now = this.mixer.now;
    const running = this.mixer.ctx.state === 'running';
    const releasing = this.trafficReleasing;
    for (let r = releasing.length - 1; r >= 0; r--) {
      const voice = releasing[r]!;
      if (running && now < voice.parkAt) continue;
      releasing[r] = releasing[releasing.length - 1]!;
      releasing.pop();
      if (this.trafficPool.length < TRAFFIC_POOL) {
        voice.audio.park();
        this.trafficPool.push(voice);
      } else {
        voice.audio.dispose();
      }
    }
  }

  /** Drops a crash timestamp whose car is no longer offered (a `Map.forEach` callback). */
  private readonly pruneTrafficCrash = (_at: number, id: string): void => {
    const list = this.trafficCandidates;
    for (let i = 0; i < this.trafficCandidateCount; i++) if (list[i]!.id === id) return;
    this.trafficCrashAt.delete(id);
  };

  /** A parked voice, or a new one, for car `c`. */
  private acquireTrafficVoice(c: TrafficCandidate): void {
    let voice = this.trafficPool.pop();
    if (voice) voice.audio.reuse();
    else voice = { audio: new TrafficAudio(this.mixer), id: '', candidate: null, parkAt: 0 };
    voice.id = c.id;
    voice.candidate = c;
    this.trafficVoices.set(c.id, voice);
    this.trafficActive.push(voice);
  }

  /** Fades out the voice at `index` of the active list, to be parked when it is silent. */
  private releaseTrafficVoice(index: number): void {
    const active = this.trafficActive;
    const voice = active[index]!;
    active[index] = active[active.length - 1]!;
    active.pop();
    this.trafficVoices.delete(voice.id);
    voice.audio.release();
    voice.parkAt = this.mixer.now + TRAFFIC_RELEASE_S;
    voice.candidate = null;
    this.trafficReleasing.push(voice);
  }

  /**
   * Another car's crash, where it happened: a panner of its own for the one take, on
   * the world bus rather than the traffic bus, because a crash is no quieter for being
   * someone else's — only further away. The panner's inverse law is the spreading
   * (-26 dB at 200 m), and air takes the top off with distance, as it does off a traffic
   * car's engine (trafficaudio.ts).
   *
   * DRY, NO WORLD REVERB. `playCrash`'s send taps the take before this panner, so it
   * reached the 2.6 s world reverb at full strength whatever the distance: at 200 m
   * the wet return (0.15 x 0.55) stood ~4 dB OVER the direct sound (0.05), unfiltered
   * by the air, and a crash down the road in open desert sounded like one in a hall
   * (owner, 2026-10-26). Open ground has nothing to ring; what is left is the direct
   * sound, quieter and duller with distance.
   */
  private trafficCrash(c: TrafficCandidate, impactMps: number): void {
    if (!this.mixer.running) return;
    const now = this.mixer.now;
    if (now - (this.trafficCrashAt.get(c.id) ?? -Infinity) < TRAFFIC_CRASH_REPEAT_S) return;
    this.trafficCrashAt.set(c.id, now);
    const ctx = this.mixer.ctx;
    const panner = new PannerNode(ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 10,
      rolloffFactor: 1,
      maxDistance: TRAFFIC_HEAR_M,
    });
    setPannerPosition(panner, c.x, c.y, c.z, now, 0.001);
    const air = ctx.createBiquadFilter();
    air.type = 'lowpass';
    air.frequency.value = Math.max(1800, 14000 / (1 + Math.sqrt(c.d2) / 70));
    air.Q.value = 0.6;
    air.connect(panner).connect(this.mixer.world);
    this.lastTrafficCrash = playCrash(this.mixer, air, impactMps, this.lastTrafficCrash, 0);
    window.setTimeout(() => {
      air.disconnect();
      panner.disconnect();
    }, TRAFFIC_CRASH_LIFE_MS);
  }

  /**
   * Pose of the single AudioListener. Traffic engines need the same listener even
   * before a radio has ever been switched on.
   */
  private writeListener(spatial: RadioSpatialState): void {
    // The listener is shared by radios and traffic engines.
    const { listenerQx: x, listenerQy: y, listenerQz: z, listenerQw: w } = spatial;
    if (
      spatial.listenerX === this.listenerX
      && spatial.listenerY === this.listenerY
      && spatial.listenerZ === this.listenerZ
      && x === this.listenerQx
      && y === this.listenerQy
      && z === this.listenerQz
      && w === this.listenerQw
    ) {
      return;
    }
    this.listenerX = spatial.listenerX;
    this.listenerY = spatial.listenerY;
    this.listenerZ = spatial.listenerZ;
    this.listenerQx = x;
    this.listenerQy = y;
    this.listenerQz = z;
    this.listenerQw = w;

    // Camera local +X, flattened: the ear-to-ear axis for panning world bearings.
    const rightX = 1 - 2 * (y * y + z * z);
    const rightZ = 2 * (x * z - y * w);
    const rightLength = Math.hypot(rightX, rightZ) || 1;
    this.listenerRightX = rightX / rightLength;
    this.listenerRightZ = rightZ / rightLength;

    setListenerPose(
      this.mixer.ctx.listener,
      spatial.listenerX,
      spatial.listenerY,
      spatial.listenerZ,
      // Camera local forward is -Z and local up is +Y.
      -2 * (x * z + y * w),
      2 * (x * w - y * z),
      -1 + 2 * (x * x + y * y),
      2 * (x * y - z * w),
      1 - 2 * (x * x + z * z),
      2 * (y * z + x * w),
    );
  }

  private radioFor(carId: string): Radio {
    let radio = this.radios.get(carId);
    if (!radio) {
      radio = new Radio(this.mixer);
      radio.setStationUrls(this.radioStationUrls);
      this.radios.set(carId, radio);
    }
    return radio;
  }

  /** Per-frame on-foot audio. Silent while seated (speed 0, grounded). */
  updateFoot(dt: number, speedMps: number, grounded: boolean, surface: SurfaceType): void {
    this.foleyVoices.updateWalk(dt, speedMps, grounded, surface);
  }

  foley(event: FoleyEvent): void {
    this.foleyVoices.event(event);
  }

  setContinuous(action: FoleyContinuous): void {
    this.foleyVoices.setContinuous(action);
  }

  updateBubbleGum(dt: number, phase: BubbleGumAudioPhase): void {
    this.foleyVoices.updateBubbleGum(dt, phase);
  }

  bubbleGumPop(): void {
    this.foleyVoices.bubbleGumPop();
  }

  gunshot(weapon: 'rifle' | 'shotgun'): void {
    this.foleyVoices.gunshot(weapon);
  }

  dryFire(): void {
    this.foleyVoices.dryFire();
  }

  cameraShutter(): void {
    this.foleyVoices.cameraShutter();
  }

  reload(): void {
    this.foleyVoices.reload();
  }

  /** Steps the radio in the specified car (off → stations → off); returns the line to toast. */
  cycleRadio(carId: string): string {
    const station = this.radioFor(carId).cycle();
    return station ? `radio — ${station.label}` : 'radio off';
  }

  /** Where the car's radio knob stands: 0 off, 1 and 2 the two presets (carkit `radio`). */
  radioDial(carId: string): number {
    const radio = this.radios.get(carId);
    return radio?.enabled ? radio.stationNumber : 0;
  }

  /** HUD line for the active car's radio, or null outside a car. */
  get radioReadout(): string | null {
    return this.activeRadioId ? (this.radios.get(this.activeRadioId)?.readout ?? null) : null;
  }

  dispose(): void {
    for (const voice of this.storyVoices) voice.dispose();
    this.storyVoices.length = 0;
    this.vehicle.dispose();
    this.foleyVoices.dispose();
    this.ambience.dispose();
    for (const radio of this.radios.values()) radio.dispose();
    this.radios.clear();
    for (const voice of [...this.trafficActive, ...this.trafficReleasing, ...this.trafficPool]) voice.audio.dispose();
    this.trafficVoices.clear();
    this.trafficActive.length = 0;
    this.trafficReleasing.length = 0;
    this.trafficPool.length = 0;
    this.mixer.dispose();
  }
}
