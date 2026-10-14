/**
 * The cabin camera's eye per car model and seat, and the in-game editor that tunes the
 * driver's.
 *
 * THE DRIVER'S EYE, first match wins:
 *  1. this browser's override (`localStorage`, written by J when the config file could
 *     not be written: a build without the dev server, or a failed POST);
 *  2. `config/cabin-cameras.json`, `{ "<modelId>": [x, y, z] }`, written by J in dev;
 *  3. the kit's own seat (`CarModelMeasure.cabinEye`, from the cushion and a seated eye
 *     height, see carkit/interior.ts), or the bonnet mount on a body that has no seat.
 * The front passenger's is the driver's mirrored across the car. The rear seats' come from
 * the bench the same way (`CarModelMeasure.rearEye`, the left one; the right is its
 * mirror), and are not edited.
 * All in chassis-local metres: +X the car's left, +Y up, +Z forward.
 *
 * THE EDITOR, for the driver's eye only. O steps X → Y → Z → off (switching to the cabin
 * view on the way in); while it is open the pedal and steering keys move the eye along
 * that axis and drive nothing
 * (`InputReader.setCabinEditing`). J saves the eye for the model, editor open or not, as
 * long as the cabin view shows.
 */

import cabinCameraConfig from '../../config/cabin-cameras.json';
import type { InputFrame, InputReader } from '../core/input';
import type { PlayerSeat } from '../game/state';
import type { CameraRig } from '../render/cameras';
import { carModelMeasure } from '../render/carmodel';

type Eye = readonly [number, number, number];
export type CabinAxis = 'x' | 'y' | 'z';

const STORAGE_KEY = 'bro.cabinCameras';
const SAVE_URL = '/__dev/cabin-camera';
/** Eye travel while a key is held, m/s; Shift (sprint) multiplies it. */
const EDIT_SPEED = 0.15;
const EDIT_FAST = 4;
const NEXT_AXIS: Readonly<Record<CabinAxis, CabinAxis | null>> = { x: 'y', y: 'z', z: null };

function isEye(value: unknown): value is Eye {
  return Array.isArray(value) && value.length === 3 && value.every((v) => typeof v === 'number' && Number.isFinite(v));
}

/** Only well-formed entries: a hand-edited file or an old store must not put NaN in the view. */
function eyeTable(raw: unknown): Record<string, Eye> {
  const table: Record<string, Eye> = {};
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return table;
  for (const [id, eye] of Object.entries(raw)) if (isEye(eye)) table[id] = [eye[0], eye[1], eye[2]];
  return table;
}

function readStored(): Record<string, Eye> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? {} : eyeTable(JSON.parse(raw));
  } catch {
    return {};
  }
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000;

export class CabinCamera {
  private readonly config = eyeTable(cabinCameraConfig);
  private readonly stored = readStored();
  /** Eyes moved in the editor this session, per model; the view reads these first. */
  private readonly live = new Map<string, [number, number, number]>();
  private axis: CabinAxis | null = null;
  private hudText: string | null = null;
  private readonly seatEye: [number, number, number] = [0, 0, 0];

  constructor(
    private readonly input: InputReader,
    private readonly camera: CameraRig,
    private readonly toast: (text: string) => void,
  ) {}

  /** The eye the cabin view uses for `seat` in `modelId`; see the notes above. */
  eyeFor(modelId: string, seat: PlayerSeat): Eye {
    if (seat === 'driver') return this.driverEye(modelId);
    const from = seat === 'passenger' ? this.driverEye(modelId) : carModelMeasure(modelId).rearEye ?? this.driverEye(modelId);
    // Mirrored for the right-hand seats, into one scratch: the view reads it every frame.
    const mirror = seat === 'passenger' || seat === 'rear-right';
    this.seatEye[0] = mirror ? -from[0] : from[0];
    this.seatEye[1] = from[1];
    this.seatEye[2] = from[2];
    return this.seatEye;
  }

  /** The driver's eye for `modelId`; see the lookup order above. */
  private driverEye(modelId: string): Eye {
    const edited = this.live.get(modelId);
    if (edited) return edited;
    const known = this.stored[modelId] ?? this.config[modelId];
    if (known) return known;
    const measure = carModelMeasure(modelId);
    return measure.cabinEye ?? measure.hoodPoint;
  }

  /** The editor's HUD line, or null while it is closed. */
  get hud(): string | null {
    return this.hudText;
  }

  /**
   * One fixed step: O and J, and the held keys moving the eye. `modelId` is the car's
   * model while the player sits in its driver's seat, else null (which closes the editor).
   */
  step(dt: number, f: InputFrame, modelId: string | null): void {
    if (modelId === null) {
      this.close();
      return;
    }
    if (f.cabinEdit) {
      if (this.axis === null) {
        this.camera.showCabin();
        this.axis = 'x';
      } else {
        this.axis = NEXT_AXIS[this.axis];
      }
    } else if (this.axis !== null && this.camera.mode !== 'cabin') {
      // C away from the cabin view leaves the editor with it.
      this.axis = null;
    }
    this.input.setCabinEditing(this.axis !== null);

    if (this.axis !== null) {
      const rate = EDIT_SPEED * (f.sprint ? EDIT_FAST : 1) * dt;
      // moveX is +1 to the right; the car's +X is its LEFT.
      const along = this.axis === 'x' ? -f.moveX : f.moveZ;
      if (along !== 0) {
        let eye = this.live.get(modelId);
        if (!eye) {
          const from = this.driverEye(modelId);
          eye = [from[0], from[1], from[2]];
          this.live.set(modelId, eye);
        }
        eye[this.axis === 'x' ? 0 : this.axis === 'y' ? 1 : 2] += along * rate;
      }
    }

    if (f.cabinSave && this.camera.mode === 'cabin') this.save(modelId);
    this.hudText = this.axis === null ? null : this.describe(modelId, this.axis);
  }

  private close(): void {
    this.axis = null;
    this.hudText = null;
    this.input.setCabinEditing(false);
  }

  private describe(modelId: string, axis: CabinAxis): string {
    const [x, y, z] = this.driverEye(modelId);
    const keys = axis === 'x' ? 'A/← left · D/→ right' : axis === 'y' ? 'W/↑ up · S/↓ down' : 'W/↑ forward · S/↓ back';
    return (
      `cabin camera · ${modelId} · editing ${axis.toUpperCase()}\n`
      + `x ${x.toFixed(3)}  y ${y.toFixed(3)}  z ${z.toFixed(3)}\n`
      + `${keys} · Shift ×${EDIT_FAST} · O next axis · J save`
    );
  }

  /**
   * J. In dev the file is the target, through the dev server's writer (vite.config.ts);
   * anywhere else, or if that fails, this browser keeps it and says so.
   */
  private save(modelId: string): void {
    const from = this.driverEye(modelId);
    const eye: Eye = [round3(from[0]), round3(from[1]), round3(from[2])];
    const text = `${eye[0].toFixed(3)}, ${eye[1].toFixed(3)}, ${eye[2].toFixed(3)}`;
    if (!import.meta.env.DEV) {
      this.store(modelId, eye);
      this.toast(`cabin camera for ${modelId} saved in this browser [${text}]`);
      return;
    }
    fetch(SAVE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: modelId, eye }),
    })
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        this.config[modelId] = eye;
        // The file is the answer now; an older browser override would shadow it.
        this.forget(modelId);
        this.toast(`cabin camera for ${modelId} saved to config/cabin-cameras.json [${text}]`);
      })
      .catch((error: unknown) => {
        this.store(modelId, eye);
        const reason = error instanceof Error ? error.message : String(error);
        this.toast(`config write failed (${reason}): cabin camera for ${modelId} saved in this browser only`);
      });
  }

  private store(modelId: string, eye: Eye): void {
    this.stored[modelId] = eye;
    this.persist();
  }

  private forget(modelId: string): void {
    if (!(modelId in this.stored)) return;
    delete this.stored[modelId];
    this.persist();
  }

  private persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.stored));
    } catch {
      // Storage disabled or full: the eye still holds for this session (`live`).
    }
  }
}
