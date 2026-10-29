# Controls, the gamepad and the camera

## Keyboard and mouse

Every keyboard action is remappable in **Pause → Settings → Controls**; the defaults
are `BINDABLE_ACTIONS` in `src/core/input.ts` and the authoritative list is that
array plus `Settings.keyBindings` in `src/game/settings.ts`. Fixed, non-remappable
controls: `Escape`/`` ` `` pause, `+` fullscreen, `-` the cinema viewport.

## On foot: crouching with C

`C` (the pad's Y, the touch overlay's C on foot) toggles a crouch (`Player`,
`src/player/player.ts`). The eye comes down from 1.62 m to 0.95 m over a quarter of a
second, the capsule shortens from 1.9 m to 1.1 m at once with the feet left where they
are, and the player crouch-walks at 1.5 m/s whatever Shift says. The interaction ray
starts at the camera's eye, so aim and reach follow the lowered head. `C` again, or
Space, stands up, but only with headroom: under something lower than a standing head
the player stays down and rises by himself once he has walked out from under it. A
crouch ends on getting into a car and on a rescue. In a car `C` is still the camera; the
two actions share the key by default and can be split in Settings → Controls.

## One interaction key: F

`F` (the bindable "Interact", the pad's X, the touch overlay's F) is every interaction
there is; `I` is the engine's switch (below). One press means one thing, decided by the aim
(`Interaction.fixedUpdate`, `src/player/interaction.ts`).

**On foot** the press belongs to the aim when the aim shows something: a named world
target (the tow bar between two cars, a machine, a pump, a key box, a loose part or
item, a trailer, a compartment's cell), a prompt, a lit crosshair, or a kit car's body
within reach (3.5 m), even where nothing on it answers. Then, first match wins:

1. a sticker figurine in hand aimed at a car: F (or a click) sticks its sticker on and uses it up;
2. the world target's action (pick up, open, take, stow, hitch, press), unless an
   unnamed kit part shares the ray and nothing is prompted;
3. the kit seat got into through an open side door, when F can do something there (sit,
   take what lies on it, lay the load on it): the seat looked at, or, looking through the
   open doorway within 2.6 m at anything in the cabin that is not a seat (the dash, the
   far door, the far window), the seat that doorway serves. This wins over an open door in
   the same ray, the near one's edge or the far one across the cabin;
4. the kit car's part in the aim (a side door, the bonnet, the boot lid, the fuel flap): a
   shut door opens, from its panel or its window; an open one shuts only when no seat is
   got into past it;
5. boarding the parked plane;
6. getting in otherwise (a car's body); a seat that refuses, or a kit car's bare body
   beside a door, knocks.

An aim that shows nothing gives the press to the held item
(`InteractionResult.useHeld`, `src/main.ts`): binoculars and the torch toggle, the camera
raises its viewfinder and then takes a photo, the medicine is taken, the pocket watch winds
four hours on, sun shades go on. A held item is never used from a seat.

**Seated**, first match wins: the kit car's part in the aim (a door, a switch, a stalk,
the hazard button, the radio knob, a mirror), another seat in the aim (cabin view only),
out of the car.

Held down, F fills a can in the hands at a pump and turns the inside or a door mirror with
the mouse. F with empty hands at a pump takes its nozzle; held, the left button pours it
into an open fuel flap, an engine or radiator under an open bonnet, or a can on the
ground, paid by the litre. F on the pump, the drop key, getting into a car or walking out
of the hose's 4 m hangs it back.
A sticker being tried on is mirrored with the middle mouse button (the pad's B, the touch
strip's MIRROR); the wheel turns it, Shift+wheel sizes it, the right button resets it.

A machine worked up close (the toy box, a key box, the claw machine) is framed by the
first F on it, and the cursor is the hand until Escape, the right button or a step away
lets go (`src/player/machinefocus.ts`). The CLAW machine keeps the movement keys: WASD or
the arrows move the claw (so does its joystick, dragged with the mouse), Space or a click
on DROP drops it for a try; only Escape and the right button let go. Its prize door is
emptied with F where the player stands, without framing (`src/world/claw.ts`).

## Cars: doors, getting in and out

The kit cars (`src/carkit`) are worked part by part (`src/player/interaction.ts`,
`aimKit` and the `kit*` methods beside it). Picking is against the car's render mesh with
the car lab's rule: clear glass is looked through unless the pane itself moves.

**A kit car names nothing.** No prompt for its doors, lids, flap or seats, on foot or
seated: the round crosshair lights on whatever F works there (`InteractionResult
.actionable`), and, while driving, shows only then. A refusal is the thing not happening
(a door that stays shut when the player tries to get out). Only the bonnet and boot cells
keep their line (`[F] take 1.5 inline-four — oil full — 4.0 L`), and a seat the player
cannot take with his load says why.

- **On foot, F works only the panels**: the side doors, the bonnet, the boot lid or
  tailgate and the fuel flap. A side door's window is that door: the hand stops at the
  shut glass. Nothing is worked through glass on foot, so a panel seen through a window
  (the far door) does not answer. Windows, vents and everything in the cabin are not
  reached from outside, even through an open door. A sticker figurine in hand makes the
  car a surface to stick on, not a set of panels. A door, the bonnet and the boot each
  sound their latch as they open and their slam as they land shut; getting in and out is
  silent.
- **The bonnet and boot grids follow their lids.** Opening the bonnet shows its grid in the
  bay, where the parts stand: the engine's big cell in the middle, the radiator in front,
  the turbine and the air filter beside it, each cell outlined round its top and lit pink
  under the aim (within 1.6 m of the eye). Opening the boot or tailgate shows the boot's
  grid; shutting a lid hides it, and so does walking 3.2 m away. F on a cell takes or
  fits as before. Wrecks and couriers, whose lids do not open, keep aim and F to open.
- **Petrol goes in through the fuel flap.** Open the flap and aim at it: the line shows the
  tank's level (`petrol 12.3/39.0 L`); with a petrol can in hand, hold the left button to
  pour and the line shows the pour. Shut, the flap shows nothing and takes nothing. Oil
  and water still pour into the engine and radiator cells in the open bonnet. The tank is
  the car's own; it is not a part.
- **F gets in through an open side door** (front or rear, on the player's side; the rear
  bench through a front door on a two-door car), the ray crossing the open door's outline
  within reach. Looking at a seat (the first opaque thing met, not seen through glass)
  sits in that seat; looking through the doorway at anything else in the cabin sits in
  the seat that door serves (front left the driver's, front right the passenger's, rear
  the bench's side). To shut an open door from outside, aim at it from where the ray
  does not pass through its opening. The cabin carry limits still apply. The seats
  themselves are not worked: no sliding, reclining or headrests.
- **Only the driver's seat drives.** From any other seat the car holds where it stands:
  pedals, steering, gears, lights, indicators and the autopilot do nothing ("only the
  driver can do that"). The cabin view is from that seat (the passenger's is the
  driver's eye mirrored; the rear seats' sit over the bench).
- **Seated, the ray runs from the camera that is drawing.** In the cabin view everything
  within reach works (doors, lids, windows, switches, stalks, visors, the courtesy lamp,
  the horn pad, which only moves: the game has no horn sound); in the chase view only the
  side doors do. Doors, lids and the flap are offered only below the exit speed
  (5 km/h). The light switch, hazards and stalk work the car's own lamps; the wiper stalk
  runs the wipers slow, fast and off.
- **F gets out through the open door on the seat's side** (a rear seat's rear door, or
  the front door on a car without rear doors) below 5 km/h, beside that door,
  ground-checked, when the aim is on no part and no other seat. A door opened from the
  seat is still in the aim: look off it (at the road) before F again, or F shuts it.
- **Getting in from foot switches to the cabin view**, facing down the car; `C` goes
  back to the chase. Moving between seats keeps the view as it was.
- **The cabin view hides the on-screen cluster**: the car's own instruments read speed,
  revs, fuel, temperature, oil pressure, charge and vacuum, and its warning lamps light.
  The interior and both door mirrors show what is behind, from the seat's eye.

Cars without a kit body keep the old rule: F at the car's body enters, and exits on the
left.

## The engine: I

`I` (the bindable "Start / stop engine") starts and stops the engine of the car the
player drives, from the driver's seat only; from another seat it toasts "only the driver
can do that". There is no key item and no ignition to find: every car starts on `I`
(`Vehicle.toggleEngine`, `src/vehicle/vehicle.ts`). It was `E` until 2026-10-29.

- **Stop:** the engine stops at once and spins down; the throttle does nothing, the
  display reads `ENGINE OFF - I START`, and the kit dash goes dark (needles on their pins,
  warning lamps out, volts 0).
- **Start:** the starter turns for 0.55-0.9 s, no torque meanwhile, and at its end the
  engine catches and idles if it can run (fuel, the engine and its air filter fitted, not
  boiled). If it cannot, the starter turns and nothing fires: a failed start, and the
  engine stays stopped. `I` while cranking lets go of the key.
- **In gear, a stopped engine only drags.** Nothing fires and nothing idles it, so it
  never moves the car; the crank turns only as the wheels turn it, and its compression
  holds the car back (`Drivetrain.update`): pushed at 3 m/s in first it is down to
  0.6 m/s after 3 s (neutral: 1.4 m/s), and on a 6% slope in first it crawls at
  0.1 m/s where in neutral it rolls away.
- **Stalls stay stopped.** An engine that runs dry, loses a part or boils over is stopped
  as if switched off; after refuelling, refitting or cooling, `I` starts it again.
- **I stops the autopilot too.** Stopping the engine while the autopilot drives switches
  the autopilot off, as `P` does ("autopilot off"); starting the engine engages nothing.
  An engaged autopilot that finds the engine stopped (a stall) starts it itself, once it
  can run.
- Getting out leaves the engine as it is: a running car idles on. The switch is saved
  with the car (`CarState.engineStopped`). Traffic and every car nobody has switched off
  run as before.

## The races at the tracks: F, Backspace, T

A race is offered at a track's grid (`src/race/director.ts`): stopped in the back grid
box, behind the waiting field, in the driver's seat, `F` takes the stake and starts the
lights. While a race is on, and only then, two more keys (both bindable in Settings →
Controls; neither is used by anything else):

- **`Backspace`** ("Race: restart from the grid / race again"): the whole field and the
  player back in their grid boxes and the lights from red. Mid-race the stake already
  out stays out; nothing is taken or paid twice. With the results up, `Backspace` (or
  `F`) races the same field again for a new stake.
- **`T`** ("Race: back to the track", the pad's right stick press): the player's car put
  back on the centre of the lap at his last checkpoint (the line after a lap, his grid
  box before the first crossing), standing, and for three seconds a ghost to the other
  racers so it never lands in one. The laps and checkpoints already taken stand.

Driving 300 m from the grid closes the results. The pad has no button for the restart.

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
| B | — | mirror the sticker being tried on |
| X | everything `F` does | same |
| Y | camera: chase ↔ cabin (`C`) | crouch / stand up (`C`) |
| RB / LB | shift up / down (manual or override) | — |
| D-pad ↑ | recentre camera (`V`) | recentre camera |
| D-pad ↓ | radio station (`R`) | drop item (`Q`) |
| D-pad ← / → | left / right indicator | previous / next item |
| Back | autopilot (`P`) | remove worn item (`G`) |
| Start | pause (opens and closes) | same |
| LS press | cycle headlights (`L`) | sprint (hold) |
| RS press | back to the track in a race (`T`) | — |
| Right stick | look / camera orbit | look |

There is no horn: the game has no horn sound or button, so nothing is bound to one.

**Analog values stay analog.** `InputFrame.throttle`/`brake` are 0..1 (the touch
overlay uses the same fields), and the pad's triggers and stick go into them
directly — no keyboard smoothing, because a stick and a trigger are already
positions.

**Keyboard pedals are a quick foot in two stages** (`KEY_PEDAL_RAMPS`,
`src/core/input.ts`): a held key moves the pedal quickly to a knee and slowly past it —
throttle to 0.5 in 0.12 s and the floor by 0.72 s; brake to the car's threshold pedal
(`Vehicle.thresholdBrakePedal`, via `setBrakeKnee`) in 0.1 s and the floor by 0.6 s —
and a released key lifts it faster (0.1 s and 0.08 s for the whole travel). A tap is a
light touch, a short hold a firm one, and the floor is there for a key held on
purpose. `tools/pedal-dose.ts` checks both pedals.

**Driver aids** (Settings → Controls, all off by default): ABS, traction control and
countersteer assist, on the player's own car only (vehicle/vehicletuning.ts, DRIVER
AIDS).

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

- **Keyboard (and the touch wheel): a steering-wheel position** (KEYBOARD STEERING in
  `src/vehicle/vehicletuning.ts`, after BeamNG's keyboard filter). A held A/D turns the
  steering wheel at a constant 720°/s, slower winding further into a turn near the
  limit of grip and quicker against a turn; the road wheels follow through the steering
  ratio. Let go and the wheel returns to centre at 990°/s at any speed. Both keys down
  hold the wheel where it is.
- **Mouse driving** (`M` while driving; Settings → Controls → **Mouse driving**). Off
  by default; the setting persists, and leaving the car keeps it for next time. On foot
  `M` does nothing and the mouse looks as always. While it is on and the player drives
  with his own hands (not under the autopilot):
  - horizontal mouse motion (pointer locked) turns the STEERING WHEEL directly, 0.5° of
    rim per pixel (`MOUSE_RIM_RAD_PER_PX`, independent of Mouse Look), up to the rim's
    485° stop where every car reaches its lock: 970 px from centre to lock. The wheel
    stays exactly where the mouse put it: no assist, no self-centring, no caster
    return. The road wheels go to rim / steering ratio, sent `direct`, and the rack
    speed below still applies. Turning it on takes the wheel where it already stands;
  - left button is the throttle, right button the brake (both 0/1 on the keyboard
    pedal ramps), so they no longer use or aim a held item;
  - hold the middle button or **Shift** (the bindable "Mouse driving: look around",
    sharing Shift with sprint by default) and the mouse turns the camera instead; the
    wheel keeps its angle;
  - the keyboard works beside it: W/S, gears, handbrake and the rest as usual, and A/D
    nudge the same held wheel at 270° of rim per second, which also stays put.
- **Pad stick: a position.** Settings → Controller → **Steering assist** On
  (default): full stick reaches the front tyres' peak slip angle at this speed,
  proportional inside it. Off: full stick is full lock at any speed.
- The rack never moves faster than the car's rack speed (60°/s at the road wheel
  for the Soviet cars, quicker for later racks), whatever the device.
- Autopilot, traffic, the tow bar and mouse driving send `direct`: a rack angle as a
  share of lock, held, never reinterpreted (`Vehicle.steeringInputForWheelAngle`).

## Driving views and the cabin camera

`C` switches the driving view: **chase** (the follow arm) ↔ **cabin** (the seat).
Entering the cabin faces down the car. The cabin eye is rigid with the chassis and so
is its horizon; the mouse turns the head against the car (to look at a door, say), and
3 s after the mouse stops the head turns back to the road by itself. There is no zoom,
no occlusion pull-in, and the speed sway does not reach it.

The eye is per car model and seat, chassis-local metres (+X the car's left, +Y up, +Z
forward; `src/vehicle/cabincamera.ts`). The driver's is the kit seat:
`CarModelMeasure.cabinEye`, an anchor at the driver's cushion plus a seated eye height
(`KIT_DRIVER_EYE_NODE`, `src/carkit/interior.ts`) carried through the body fit; a body
without a kit cabin uses its bonnet mount. The front passenger's is the driver's mirrored
across the car; the rear seats' come from the bench (`CarModelMeasure.rearEye`, the
right one mirrored).

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
