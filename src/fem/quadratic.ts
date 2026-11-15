import { TET10_EDGES } from './tet10'
import type { Mesh } from './types'

// Swaps two corners if the tet is negatively oriented
export function orientPositive(coords: ArrayLike<number>, t: number[]): number[] {
  const v = (a: number, b: number, c: number) => coords[3 * t[b] + c] - coords[3 * t[a] + c]
  const det =
    v(0, 1, 0) * (v(0, 2, 1) * v(0, 3, 2) - v(0, 2, 2) * v(0, 3, 1)) -
    v(0, 1, 1) * (v(0, 2, 0) * v(0, 3, 2) - v(0, 2, 2) * v(0, 3, 0)) +
    v(0, 1, 2) * (v(0, 2, 0) * v(0, 3, 1) - v(0, 2, 1) * v(0, 3, 0))
  return det > 0 ? t : [t[0], t[2], t[1], t[3]]
}

// Linear tets (4 corners each) to quadratic tets, sharing one midside node per edge
export function addMidsideNodes(coords: ArrayLike<number>, corners: ArrayLike<number>): Mesh {
  const out = Array.from(coords)
  const edgeNode = new Map<string, number>()
  const tets = new Uint32Array((corners.length / 4) * 10)
  for (let e = 0; e < corners.length / 4; e++) {
    const c = [corners[4 * e], corners[4 * e + 1], corners[4 * e + 2], corners[4 * e + 3]]
    for (let a = 0; a < 4; a++) tets[10 * e + a] = c[a]
    TET10_EDGES.forEach(([i, j], k) => {
      const a = Math.min(c[i], c[j]), b = Math.max(c[i], c[j])
      const key = `${a},${b}`
      let n = edgeNode.get(key)
      if (n === undefined) {
        n = out.length / 3
        for (let d = 0; d < 3; d++) out.push((out[3 * a + d] + out[3 * b + d]) / 2)
        edgeNode.set(key, n)
      }
      tets[10 * e + 4 + k] = n
    })
  }
  return { nodes: Float64Array.from(out), tets }
}
