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
import { AudioMixer, setListenerPose } from './mixer';
import { VehicleAudio, type CarPose } from './vehicleaudio';
import { TrafficAudio } from './trafficaudio';
import { Ambience, type AmbienceFrame } from './ambience';
import { Foley, type BubbleGumAudioPhase, type FoleyContinuous, type FoleyEvent } from './foley';
import { Radio, type RadioSpatialState } from './radio';
export type { RadioSpatialState } from './radio';
export type { CarPose } from './vehicleaudio';
export type { AmbienceFrame } from './ambience';

/** Traffic cars given a voice at once: the nearest few are all anyone can pick out. */
const TRAFFIC_VOICES = 6;
/** Beyond this a traffic car is not voiced at all, metres. */
const TRAFFIC_HEAR_M = 380;

interface TrafficCandidate {
  id: string;
  state: VehicleAudioState;
  x: number;
  y: number;
  z: number;
  d2: number;
}

export class GameAudio {
  private readonly mixer = new AudioMixer();
  private readonly vehicle = new VehicleAudio(this.mixer);
  private readonly foleyVoices = new Foley(this.mixer);
  private readonly ambience = new Ambience(this.mixer);
  private readonly radios = new Map<string, Radio>();
  private readonly trafficVoices = new Map<string, TrafficAudio>();
  private readonly trafficCandidates: TrafficCandidate[] = [];
  private trafficCandidateCount = 0;
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

  applySettings(settings: Settings): void {
    this.mixer.setVolume(settings.masterVolume);
    this.mixer.setBusVolumes(settings.carVolume, settings.worldVolume, settings.radioVolume);
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
   * `pose` places the car's sound sources; `cabin` is the bonnet-seat view.
   */
  updateDriving(
    state: VehicleAudioState | null,
    radioSpatial: RadioSpatialState,
    radioCarId: string | null,
    pose: CarPose | null,
    cabin: boolean,
    dt: number,
  ): void {
    // The listener first: the car's panners are placed against it this frame.
    this.writeListener(radioSpatial);
    this.vehicle.setActive(state !== null && pose !== null);
    this.vehicle.setPerspective(cabin ? 'cabin' : 'outside');
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
    const keep = new Set<string>();
    for (let i = 0; i < Math.min(count, TRAFFIC_VOICES); i++) {
      const c = list[i]!;
      if (c.d2 > hearD2) break;
      keep.add(c.id);
      let voice = this.trafficVoices.get(c.id);
      if (!voice) {
        voice = new TrafficAudio(this.mixer);
        this.trafficVoices.set(c.id, voice);
      }
      voice.update(c.state, c.x, c.y, c.z, this.listenerX, this.listenerY, this.listenerZ, dt);
    }
    for (const [id, voice] of this.trafficVoices) {
      if (!keep.has(id)) {
        voice.release();
        this.trafficVoices.delete(id);
      }
    }
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

  /** Toggles the radio in the specified car; returns the line to toast. */
  toggleRadio(carId: string): string {
    const radio = this.radioFor(carId);
    return radio.toggle() ? `radio on — ${radio.station.label}` : 'radio off';
  }

  /** Next station in the specified car; returns the line to toast. */
  nextStation(carId: string): string {
    const radio = this.radioFor(carId);
    return `radio — ${radio.next().label}`;
  }

  /** HUD line for the active car's radio, or null outside a car. */
  get radioReadout(): string | null {
    return this.activeRadioId ? (this.radios.get(this.activeRadioId)?.readout ?? null) : null;
  }

  dispose(): void {
    this.vehicle.dispose();
    this.foleyVoices.dispose();
    this.ambience.dispose();
    for (const radio of this.radios.values()) radio.dispose();
    this.radios.clear();
    for (const voice of this.trafficVoices.values()) voice.dispose();
    this.trafficVoices.clear();
    this.mixer.dispose();
  }
}
