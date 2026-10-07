# Controls, the gamepad and the camera

## Keyboard and mouse

Every keyboard action is remappable in **Pause → Settings → Controls**; the defaults
are `BINDABLE_ACTIONS` in `src/core/input.ts` and the authoritative list is that
array plus `Settings.keyBindings` in `src/game/settings.ts`. Fixed, non-remappable
controls: `Escape`/`` ` `` pause, `+` fullscreen, `-` the cinema viewport.

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
| Y | hood / chase camera (`C`) | camera mode |
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

Strong motor: suspension bumps (`bumpMps`), landings (`landingImpactMps`) and
collisions (`impactMps`) — read from the vehicle's audio telemetry *before* the audio
layer consumes it, since those three are zeroed on read. Weak motor: road texture
(surface roughness × contact × speed), tyre slide past the peak of the curve, lock-up
and side slip, plus the steering going **light**: the front tyres past the peak of
their aligning moment (`Vehicle.steeringLightness`), the cue a real wheel gives before
the nose washes wide. Pads that advertise `trigger-rumble` also get the front tyres'
own slip per side.

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
