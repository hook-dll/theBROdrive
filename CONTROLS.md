# Controls, the gamepad and the camera

## Keyboard and mouse

Every keyboard action is remappable in **Pause → Settings → Controls**; the defaults
are `BINDABLE_ACTIONS` in `src/core/input.ts` and the authoritative list is that
array plus `Settings.keyBindings` in `src/game/settings.ts`. Fixed, non-remappable
controls: `Escape`/`` ` `` pause, `+` fullscreen, `-` the cinema viewport.

## Cars: doors with E, getting in and out with F

The kit cars (`src/carkit`) are worked part by part (`src/player/interaction.ts`,
`aimKit` and the `kit*` methods beside it). Picking is against the car's render mesh with
the car lab's rule: clear glass is looked through unless the pane itself moves.

**A kit car names nothing.** No prompt for its doors, lids, flap or seats, on foot or
seated: the round crosshair lights on whatever E or F works there (`InteractionResult
.actionable`), and, while driving, shows only then. A refusal is the thing not happening
(a door that stays shut answers F with a knock). Only the bonnet and boot cells keep their
line (`[F] take 1.5 inline-four — oil full — 4.0 L`), and a seat the player cannot take
with his load says why.

- **On foot, E works only the panels**: the side doors, the bonnet, the boot lid or
  tailgate and the fuel flap. Windows, vents and everything in the cabin are not reached
  from outside, even through an open door. A sticker envelope in hand keeps E (it mirrors
  the sticker); any other held item gives E up while a panel is in the crosshair.
- **The bonnet and boot grids follow their lids.** Opening the bonnet shows its grid in the
  bay, where the parts stand: the engine's big cell in the middle, the radiator in front,
  the turbine and the air filter beside it, each cell outlined round its top and lit pink
  under the aim (within 1.6 m of the eye). Opening the boot or tailgate shows the boot's
  grid; shutting a lid hides it, and so does walking 3.2 m away. F on a cell takes or
  fits as before. Wrecks and couriers, whose lids do not open, keep aim and F to open.
- **Petrol goes in through the fuel flap.** With a petrol can in hand, open the flap and
  hold the left button on it; the crosshair lights while it takes petrol, and the fuel
  gauge is the level. Oil and water still pour into the engine and radiator cells in the
  open bonnet. The tank is the car's own; it is not a part.
- **F gets in by looking at a seat through an open side door** (front or rear, on the
  player's side; the rear bench through a front door on a two-door car). The first opaque
  thing the eye ray meets must be the seat, not seen through glass, and the ray must
  cross the open door's outline. The player sits in that seat. The cabin carry limits
  still apply.
- **Only the driver's seat drives.** From any other seat the car holds where it stands:
  pedals, steering, gears, lights, indicators and the autopilot do nothing ("only the
  driver can do that"). The cabin view is from that seat (the passenger's is the
  driver's eye mirrored; the rear seats' sit over the bench).
- **Seated, the ray runs from the camera that is drawing.** In the cabin view everything
  within reach works (doors, lids, windows, switches, stalks, visors, the courtesy lamp,
  the horn pad, which only moves: the game has no horn sound); in the chase and hood views
  only the side doors do. Doors, lids and the flap are offered only below the exit speed
  (5 km/h). The light switch, hazards and stalk work the car's own lamps; the wiper stalk
  runs the wipers slow, fast and off.
- **F gets out through the open door on the seat's side** (a rear seat's rear door, or
  the front door on a car without rear doors) below 5 km/h, beside that door,
  ground-checked.
- **The cabin view hides the on-screen cluster**: the car's own instruments read speed,
  revs, fuel, temperature, oil pressure, charge and vacuum, and its warning lamps light.
  The interior and both door mirrors show what is behind, from the seat's eye.

Cars without a kit body keep the old rule: F at the car's body enters, and exits on the
left. The touch overlay's E button is on-foot only, so from the seat parts are worked
with the keyboard or the pad's B.

## Gamepad (Xbox-style, W3C "standard" mapping)

`src/core/gamepad.ts` owns the Gamepad API and hands out a plain snapshot; nothing
else in the game calls `navigator.getGamepads`. A pad must report the `standard`
mapping to be used at all: the whole layout is indices, and a device reporting its
own layout would otherwise drive the car with its triggers as its steering.

| Pad | Driving | On foot |
|---|---|---|
| Left stick X | steering (analog) | walk left/right |
| Left stick Y | — | walk forward/back |
| RT | throttle, 0..1 (analog) | — |
| LT | brake / reverse, 0..1 (analog) | — |
| A | handbrake (toggle) | jump |
| B | use held item (`E`) | use held item (`E`) |
| X | enter/exit car, pick up/mount (`F`) | same |
| Y | camera: chase → hood → cabin (`C`) | camera mode |
| RB / LB | shift up / down (manual or override) | — |
| D-pad ↑ | recentre camera (`V`) | recentre camera |
| D-pad ↓ | radio station (`R`) | drop item (`Q`) |
| D-pad ← / → | left / right indicator | previous / next item |
| Back | autopilot (`P`) | remove worn item (`G`) |
| Start | pause (opens and closes) | same |
| LS press | cycle headlights (`L`) | sprint (hold) |
| RS press | precise steering toggle (`M`) | same |
| Right stick | look / camera orbit | look |

There is no horn: the game has no horn sound or button, so nothing is bound to one.

**Analog values stay analog.** `InputFrame.throttle`/`brake` are 0..1 (the touch
overlay uses the same fields), and the pad's triggers and stick go into them
directly — no keyboard smoothing, because a stick and a trigger are already
positions.

**Keyboard pedals are a quick foot** (`KEY_PEDAL_RAMPS`, `src/core/input.ts`): a held
key moves the pedal at a constant speed, throttle 0→1 in 0.25 s and brake in 0.15 s,
and a released key lifts it faster (0.1 s and 0.08 s for the whole travel). A tap is
a light touch; a hold reaches the floor at a definite moment. `tools/pedal-dose.ts`
checks both pedals.

**One device per axis.** Steering, throttle and brake each latch the device that
last moved them, so a held pad trigger and a key cannot fight: the stick takes the
axis when it deflects, the first key down takes it back, and releasing the stick
hands it back to a held key. `InputReader.resyncPad()` re-reads the pad after an
overlay closes, so the press that resumed the game cannot also fire an action.

Menus (title, pause, settings) are fully drivable on the pad: the D-pad and left
stick move focus geometrically between the controls, A activates, B goes back and
Start closes the pause. `attachPadNavigation` in `src/ui/menu.ts` is switched off
while a key binding is being captured.

### Rumble

Collisions only: the strong motor follows the vehicle's `impactMps` (full at 4 m/s),
read from its audio telemetry *before* the audio layer consumes it, since it is zeroed
on read. Road texture, bumps, landings, slides and the steering going light no longer
rumble — they kept a motor running for the whole drive.

Effects are re-issued every 80 ms while demanded, never per frame; they scale with
**Settings → Controller → Vibration** (default 70%) and stop on pause, exit and blur.
Levels come from `RUMBLE_*` in `src/main.ts`.

## Steering

`InputFrame.steerMode` says what `steer` means (`SteerMode` in `src/core/input.ts`):

- **Keyboard (and the touch wheel).** Settings → Controls → **Keyboard steering
  assist** On (default): a held A/D asks for the
  steering that runs the front tyres at their own peak slip angle (+10%), measured
  from the way the front axle is actually travelling — full lock when parking, a few
  degrees at 100 km/h. The key winds up over ~0.3 s; partial wind-up is a share of
  that slip. If the tail slides past its own peak, the key toward the bend gives way
  until the front wheels simply follow the car's direction; the opposite key is the
  countersteer and reaches past the direction of travel. Off: the key winds toward
  full lock at any speed.
- **Letting go is letting go of the wheel.** A centred stick, and a released key with
  **Steering key release** on Let go (default), means no hand on the wheel at once:
  the tyres' aligning moment (pneumatic trail plus the caster's mechanical trail)
  swings the wheel back toward where the car is going. Mid-corner it unwinds and the
  car straightens; with the tail out it countersteers on its own; parked it stays put.
  On Ease off, a released key first eases the hand off (0.25 s time constant) and lets
  go near the centre, so a tap's correction is not taken back in one physics step.
- **Pad stick / precise mouse wheel: a position.** Settings → Controller →
  **Steering assist** On (default): full stick is the same tyre-peak reach as the
  keyboard, proportional inside it. Off: full stick is full lock at any speed.
- The rack never moves faster than the car's rack speed (60°/s at the road wheel
  for the Soviet cars, quicker for later racks), whatever the device.
- Autopilot, traffic and the tow bar send `direct`: a rack angle as a share of lock,
  held, never reinterpreted (`Vehicle.steeringInputForWheelAngle`).

## Driving views and the cabin camera

`C` cycles the driving view: **chase** (the follow arm) → **hood** (the bonnet mount)
→ **cabin** (the driver's seat) → chase. Entering hood or cabin faces down the car.
The cabin eye is rigid with the chassis and so is its horizon; the mouse turns the
driver's head against the car (to look at a door, say), there is no zoom, no
occlusion pull-in, and neither the speed sway nor the shake kicks reach it.

The eye is per car model, chassis-local metres (+X the car's left, +Y up, +Z
forward), first match wins (`src/vehicle/cabincamera.ts`):

1. this browser's override (`localStorage` `bro.cabinCameras`), written only when J
   could not write the config file;
2. `config/cabin-cameras.json`, `{ "<modelId>": [x, y, z] }`;
3. the kit seat: `CarModelMeasure.cabinEye`, an anchor at the driver's cushion plus a
   seated eye height (`KIT_DRIVER_EYE_NODE`, `src/carkit/interior.ts`) carried through
   the body fit. A body without a kit cabin uses its bonnet mount.

**Editor (driving).** `O` opens it (switching to the cabin view) and steps the axis:
X → Y → Z → closed. While it is open the pedal and steering keys move the eye and
drive nothing (throttle, brake and steering read zero; the handbrake still toggles):

| Axis | A / ← | D / → | W / ↑ | S / ↓ |
|---|---|---|---|---|
| X | car's left | car's right | — | — |
| Y | — | — | up | down |
| Z | — | — | forward | back |

0.15 m/s, Shift ×4. The HUD shows the axis and the eye to the millimetre. Mouse look
stays live. `C` away from the cabin view closes the editor.

**Save (`J`, cabin view, editor open or not).** On the dev server the game POSTs
`/__dev/cabin-camera` and `vite.config.ts` rewrites `config/cabin-cameras.json` (one
line per car, keys sorted); the page does not reload on that file. In any other build, or
if the POST fails, the eye goes to `localStorage` and the toast says so.

## Camera style

**Settings → Drive → Camera style**:

- **Steady** (default) is exactly the camera this game has always had: a world-space
  heading, an arm that lags the car by a speed term, a level horizon.
- **Dynamic** reads the car's own motion (its velocity direction against its heading,
  its measured lateral acceleration, its body roll) and shows it: the chase heading
  follows 40% of the slip angle (slip capped at 26°, so at most ~10°) so oversteer is
  visible; the eye leans out of the corner 5 cm per m/s² of lateral acceleration (cap
  35 cm, on a critically damped spring); the bonnet view's horizon rolls 60% of the
  body's roll (cap ~3.4°); and below 40 km/h the view looks into the corner from the
  steering (up to ~11° at full lock, fading to zero at 40 km/h).

Steady is untouched by the dynamic terms: `CameraRig.setStyle('steady')` clears them
and every use is gated on the style. The camera gets the car's velocity in
`CameraTarget.velocityX/Z`, filled by `main.ts` from the chassis. The lateral
acceleration is the WORLD velocity's change projected on the car's side axis, taken
only across physics steps (a render frame with no new step is no sample), so the
values are the same at any frame rate.

## Controller settings

Settings → Controller: vibration, stick dead-zone (default 8%), steering
sensitivity (how much lock a given stick deflection asks for) and steering assist
(see Steering). They live in `Settings` with the rest and persist through the same
store; older saves load with the defaults.
