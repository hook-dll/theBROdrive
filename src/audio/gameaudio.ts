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
import { AudioMixer } from './mixer';
import { VehicleAudio } from './vehicleaudio';
import { Foley, type BubbleGumAudioPhase, type FoleyContinuous, type FoleyEvent } from './foley';
import { Radio, type RadioSpatialState } from './radio';
export type { RadioSpatialState } from './radio';

export class GameAudio {
  private readonly mixer = new AudioMixer();
  private readonly vehicle = new VehicleAudio(this.mixer);
  private readonly foleyVoices = new Foley(this.mixer);
  private readonly radios = new Map<string, Radio>();
  private activeRadioId: string | null = null;
  private radioVolume = 1;
  /** Last pose written to the context listener; NaN so the first frame always writes. */
  private listenerX = Number.NaN;
  private listenerY = Number.NaN;
  private listenerZ = Number.NaN;
  private listenerQx = Number.NaN;
  private listenerQy = Number.NaN;
  private listenerQz = Number.NaN;
  private listenerQw = Number.NaN;

  applySettings(settings: Settings): void {
    this.mixer.setVolume(settings.masterVolume);
    this.radioVolume = settings.radioVolume;
    for (const radio of this.radios.values()) radio.setVolume(this.radioVolume);
  }

  setPaused(paused: boolean): void {
    this.mixer.setPaused(paused);
    for (const radio of this.radios.values()) radio.setPaused(paused);
  }

  /**
   * Per-frame car audio. Every entered car owns its own radio stream; inactive
   * radios remain spatial sources while the listener walks around the world.
   */
  updateDriving(
    state: VehicleAudioState | null,
    radioSpatial: RadioSpatialState,
    radioCarId: string | null,
  ): void {
    this.vehicle.setActive(state !== null);
    if (state) this.vehicle.update(state);
    this.activeRadioId = radioCarId;
    // One AudioListener exists per context, so its pose belongs here rather than in
    // each radio: writing it per radio meant every entered car in the session paid
    // ten AudioParam writes a frame to set the same nine values.
    this.writeListener(radioSpatial);

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

  /**
   * Pose of the single AudioListener, skipped entirely while the camera is still.
   * A parked player with the radio on is the common case, and an unchanged
   * AudioParam write still crosses into the audio thread's parameter timeline.
   */
  private writeListener(spatial: RadioSpatialState): void {
    if (this.radios.size === 0) return;
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

    const listener = this.mixer.ctx.listener;
    listener.positionX.value = spatial.listenerX;
    listener.positionY.value = spatial.listenerY;
    listener.positionZ.value = spatial.listenerZ;
    // Camera local forward is -Z and local up is +Y.
    listener.forwardX.value = -2 * (x * z + y * w);
    listener.forwardY.value = 2 * (x * w - y * z);
    listener.forwardZ.value = -1 + 2 * (x * x + y * y);
    listener.upX.value = 2 * (x * y - z * w);
    listener.upY.value = 1 - 2 * (x * x + z * z);
    listener.upZ.value = 2 * (y * z + x * w);
  }

  private radioFor(carId: string): Radio {
    let radio = this.radios.get(carId);
    if (!radio) {
      radio = new Radio(this.mixer);
      radio.setVolume(this.radioVolume);
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

  gunshot(): void {
    this.foleyVoices.gunshot();
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
    for (const radio of this.radios.values()) radio.dispose();
    this.radios.clear();
    this.mixer.dispose();
  }
}
