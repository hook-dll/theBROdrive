/**
 * The toilet layouts (docs/toilet-poi-design.md, "Layouts"): the scale and siting a
 * catalogue entry is read at, across the plan families, with the rules that keep each one
 * honest and the share of the fifty it is planned for. Pure data: toilet-check holds every
 * variant to its layout's rule.
 */

import type { ToiletFamily, ToiletForm, ToiletLayoutKind } from './types';

export interface ToiletLayoutRule {
  readonly kind: ToiletLayoutKind;
  /** How many of the fifty catalogue entries are planned at this layout. */
  readonly planned: number;
  /** The plan families that may draw it. */
  readonly families: readonly ToiletFamily[];
  /** Sealed volumes besides the cabin (rooms, huts, booths, cubes), fewest and most. */
  readonly annexes: readonly [min: number, max: number];
  /** Longest side of the authored footprint, metres: the bound on the visual volume. */
  readonly span: number;
  /** Whether it belongs to a host POI (`ToiletVariant.host`); only `facility-attached` does. */
  readonly hosted: boolean;
}

export const TOILET_LAYOUTS: readonly ToiletLayoutRule[] = [
  { kind: 'single', planned: 9, families: ['cabin'], annexes: [0, 0], span: 6, hosted: false },
  { kind: 'pavilion', planned: 8, families: ['vessel', 'eave', 'canopy'], annexes: [0, 1], span: 16, hosted: false },
  { kind: 'row', planned: 6, families: ['row'], annexes: [1, 4], span: 14, hosted: false },
  { kind: 'cluster', planned: 6, families: ['cluster'], annexes: [2, 6], span: 16, hosted: false },
  { kind: 'circular', planned: 5, families: ['eave', 'vessel'], annexes: [0, 4], span: 12, hosted: false },
  { kind: 'large-public', planned: 4, families: ['row', 'cluster', 'eave', 'canopy'], annexes: [3, 10], span: 24, hosted: false },
  { kind: 'facility-attached', planned: 6, families: ['cabin', 'row'], annexes: [0, 1], span: 6, hosted: true },
  { kind: 'desert-autonomous', planned: 6, families: ['cabin', 'cluster', 'canopy'], annexes: [0, 2], span: 12, hosted: false },
];

/** A layout's rule; throws on an unknown kind. */
export function toiletLayoutRule(kind: ToiletLayoutKind): ToiletLayoutRule {
  const rule = TOILET_LAYOUTS.find((candidate) => candidate.kind === kind);
  if (!rule) throw new Error(`Unknown toilet layout ${kind}`);
  return rule;
}

/** The sealed volumes a family draws besides the cabin. */
export function toiletAnnexCount(form: ToiletForm): number {
  switch (form.family) {
    case 'row':
      return form.rooms.length;
    case 'cluster':
      return form.huts.length;
    case 'eave':
      return form.booths.length;
    case 'canopy':
      return form.cubes.length;
    case 'cabin':
    case 'vessel':
      return 0;
  }
}
