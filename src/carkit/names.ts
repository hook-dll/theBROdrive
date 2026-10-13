/**
 * Node names a kit car is built with, which its catalogue entry selects by. Kept free
 * of imports so the catalogue (vehicle/carmodels.ts) can name them without loading
 * the builder.
 */

export const KIT_WHEEL_NODES = {
  wheel_fl: ['kit_wheel_fl'],
  wheel_fr: ['kit_wheel_fr'],
  wheel_rl: ['kit_wheel_rl'],
  wheel_rr: ['kit_wheel_rr'],
} as const;

/** Lamp lens mesh per lamp slot (see materials.ts); `rear_passive` is never switched. */
export const KIT_LAMP_NODES = {
  lamp_head: 'kit_head',
  lamp_tail: 'kit_tail',
  lamp_brake: 'kit_brake',
  lamp_reverse: 'kit_reverse',
  lamp_blinker_l: 'kit_blink_l',
  lamp_blinker_r: 'kit_blink_r',
  lamp_inert: 'rear_passive',
} as const;

export const KIT_LIGHTS = {
  headlights: [KIT_LAMP_NODES.lamp_head],
  taillights: [KIT_LAMP_NODES.lamp_tail],
  brakeLights: [KIT_LAMP_NODES.lamp_brake],
  reverseLights: [KIT_LAMP_NODES.lamp_reverse],
  leftBlinkers: [KIT_LAMP_NODES.lamp_blinker_l],
  rightBlinkers: [KIT_LAMP_NODES.lamp_blinker_r],
} as const;

/** The material the kit's panes are drawn with (the def's `glassMaterial`). */
export const KIT_GLASS_MATERIAL = 'glass';
