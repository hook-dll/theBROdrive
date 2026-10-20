/**
 * Every dwelling's MEASURED half extents, metres, in its own frame: `[x, z]`, x along its
 * front, z its depth. These are the numbers `createStructureInstance` measures from the
 * built body (world/poistructures.ts `halfExtentX`/`halfExtentZ`: symmetric about the
 * anchor, the larger side of each axis), rounded UP to the centimetre.
 *
 * Written down rather than measured on the spot because the settlements' layout
 * (world/settlement.ts) packs houses by their real size and is pure: the lay-by's
 * levelled site is read by the terrain inside the desert tile and vista workers, where
 * no house is ever built. tools/poi-placement.ts rebuilds every house and fails if a
 * row here is smaller than what the house measures, or more than 5 cm larger.
 */
export const DWELLING_HALF_EXTENTS: Readonly<Record<string, readonly [number, number]>> = {
  'izba': [5.70, 4.20],
  'izba-ruin': [4.19, 4.52],
  'dacha': [3.93, 5.50],
  'finnish-house': [5.10, 3.60],
  'barrack': [8.45, 5.31],
  'mazanka': [4.41, 3.10],
  'tudor': [5.10, 3.75],
  'chalet': [6.00, 5.25],
  'dutch-gable': [3.46, 5.91],
  'falu-cottage': [4.37, 4.91],
  'turf-house': [7.60, 4.20],
  'mansard': [6.20, 4.91],
  'cycladic': [4.43, 2.78],
  'trullo': [6.02, 4.10],
  'blackhouse': [7.60, 3.16],
  'bauhaus': [5.06, 3.55],
  'tbilisi': [4.91, 5.10],
  'pueblo': [8.61, 5.04],
  'tipi': [3.00, 3.00],
  'log-cabin': [4.60, 5.00],
  'saltbox': [5.81, 4.75],
  'victorian': [6.35, 6.04],
  'victorian-ghost': [4.83, 7.35],
  'shotgun': [2.85, 8.74],
  'dustbowl': [8.70, 5.81],
  'quonset': [3.41, 6.50],
  'airstream': [5.12, 2.41],
  'trailer-wreck': [7.23, 3.80],
  'a-frame': [4.35, 6.10],
  'butterfly': [12.50, 4.70],
  'streamline': [5.06, 4.31],
  'hacienda': [8.45, 5.94],
  'casita': [6.00, 3.50],
  'adobe-ruin': [6.41, 5.90],
  'maya': [6.94, 6.06],
  'chattel': [4.66, 4.60],
  'djenne': [5.06, 4.06],
  'nubian': [6.50, 3.89],
  'yemen': [4.20, 3.61],
  'windcatcher': [7.00, 3.09],
  'rondavel': [7.45, 5.62],
  'ndebele': [5.60, 5.58],
  'lebanese': [6.56, 4.91],
  'minka': [6.91, 5.70],
  'chinese': [7.50, 5.97],
  'yurt': [3.41, 3.50],
  'thai-stilt': [6.16, 6.00],
  'tongkonan': [7.60, 3.91],
  'haveli': [6.12, 5.09],
  'futuro': [4.00, 4.50],
};
