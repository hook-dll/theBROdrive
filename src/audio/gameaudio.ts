/**
 * The single audio surface the game talks to.
 *
 * main.ts owns one of these and calls it with what already happened this frame;
 * nothing below it reads game state, and nothing above it knows what an
 * AudioContext is. The split matters because audio is the one subsystem that must
 * survive being switched off entirely (no gesture yet, muted setting, paused menu)
 * without every caller learning to check first.
 */

import type { Settings } from '../game/settings';
import type { VehicleAudioState } from '../vehicle/vehicle';
import { AudioMixer } from './mixer';
import { VehicleAudio } from './vehicleaudio';
import { Foley, type FoleyContinuous, type FoleyEvent } from './foley';
import { Radio } from './radio';

export class GameAudio {
  private readonly mixer = new AudioMixer();
  private readonly vehicle = new VehicleAudio(this.mixer);
  private readonly foleyVoices = new Foley(this.mixer);
  private readonly radioDevice = new Radio();

  applySettings(settings: Settings): void {
    this.mixer.setVolume(settings.masterVolume);
    this.radioDevice.setVolume(settings.radioVolume);
  }

  setPaused(paused: boolean): void {
    this.mixer.setPaused(paused);
    this.radioDevice.setPaused(paused);
  }

  /**
   * Per-frame car audio. `state` is null when the player is not driving, which
   * fades the car voices out and switches the radio off the air — it is a car
   * radio, and the seat is the only place it exists.
   */
  updateDriving(state: VehicleAudioState | null, interior: boolean): void {
    this.vehicle.setActive(state !== null);
    if (state) this.vehicle.update(state, interior);
    this.radioDevice.setInCar(state !== null);
  }

  /** Per-frame on-foot audio. Silent while seated (speed 0, grounded). */
  updateFoot(dt: number, speedMps: number, grounded: boolean): void {
    this.foleyVoices.updateWalk(dt, speedMps, grounded);
  }

  foley(event: FoleyEvent): void {
    this.foleyVoices.event(event);
  }

  setContinuous(action: FoleyContinuous): void {
    this.foleyVoices.setContinuous(action);
  }

  gunshot(): void {
    this.foleyVoices.gunshot();
  }

  dryFire(): void {
    this.foleyVoices.dryFire();
  }

  reload(): void {
    this.foleyVoices.reload();
  }

  /** Toggles the radio; returns the line to toast. */
  toggleRadio(): string {
    return this.radioDevice.toggle() ? `radio on — ${this.radioDevice.station.label}` : 'radio off';
  }

  /** Next station; returns the line to toast. */
  nextStation(): string {
    return `radio — ${this.radioDevice.next().label}`;
  }

  /** HUD line for the radio, or null when there is nothing to show. */
  get radioReadout(): string | null {
    return this.radioDevice.readout;
  }

  dispose(): void {
    this.vehicle.dispose();
    this.foleyVoices.dispose();
    this.radioDevice.dispose();
    this.mixer.dispose();
  }
}
