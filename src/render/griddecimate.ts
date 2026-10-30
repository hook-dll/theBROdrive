/**
 * A coarse copy of a regular-grid mesh, for the far world.
 *
 * The desert tile and the road surface are both row × column grids: every vertex has a
 * place at (row, column), and the triangles only join neighbours. That is enough to
 * build a lower LOD without touching the generators or the look code: keep every
 * `stride`-th row and column, copy each attribute's values at those vertices, and
 * re-index the smaller grid. The material and every attribute it reads stay the same,
 * so the far mesh is the real surface at coarser geometry, not a flat substitute.
 *
 * Winding follows the source grid (the road and the desert tile wind opposite ways);
 * getting it wrong makes a FrontSide material disappear. The last row and column are
 * always kept, so the tile/chunk edge does not move and no seam opens at the LOD swap.
 */

import * as THREE from 'three';

export type GridWinding = 'road' | 'desert';

function picked(count: number, stride: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i += stride) out.push(i);
  if (out[out.length - 1] !== count - 1) out.push(count - 1);
  return out;
}

/**
 * `geometry` laid out as `rows × columns`; every `stride`-th row/column is kept.
 * All non-index attributes are copied with their own item sizes; the index is rebuilt.
 */
export function decimateGrid(
  geometry: THREE.BufferGeometry,
  rows: number,
  columns: number,
  stride: number,
  winding: GridWinding,
): THREE.BufferGeometry {
  if (rows < 2 || columns < 2 || stride <= 1) return geometry;
  const rowPick = picked(rows, stride);
  const columnPick = picked(columns, stride);
  const outRows = rowPick.length;
  const outColumns = columnPick.length;
  const out = new THREE.BufferGeometry();
  out.name = `${geometry.name || 'grid'}:far`;

  for (const [name, attribute] of Object.entries(geometry.attributes)) {
    const source = attribute as THREE.BufferAttribute;
    const itemSize = source.itemSize;
    const values = new Float32Array(outRows * outColumns * itemSize);
    let at = 0;
    for (const row of rowPick) {
      for (const column of columnPick) {
        const from = (row * columns + column) * itemSize;
        for (let k = 0; k < itemSize; k++) values[at++] = source.array[from + k]!;
      }
    }
    out.setAttribute(
      name,
      new THREE.BufferAttribute(values, itemSize, source.normalized),
    );
  }

  const indices: number[] = [];
  for (let r = 0; r + 1 < outRows; r++) {
    for (let c = 0; c + 1 < outColumns; c++) {
      const a = r * outColumns + c;
      const b = (r + 1) * outColumns + c;
      const cc = a + 1;
      const d = b + 1;
      if (winding === 'road') {
        indices.push(a, b, cc, b, d, cc);
      } else {
        indices.push(a, cc, b, b, cc, d);
      }
    }
  }
  out.setIndex(new THREE.BufferAttribute(new Uint32Array(indices), 1));
  out.computeBoundingSphere();
  return out;
}
