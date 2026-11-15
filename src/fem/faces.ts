import type { Face, Mesh } from './types'

// Corner triples of each tet face, outward for a positively oriented tet, with their midside nodes
const TET_FACES: readonly Face[] = [
  [0, 2, 1, 6, 5, 4],
  [0, 1, 3, 4, 8, 7],
  [1, 2, 3, 5, 9, 8],
  [0, 3, 2, 7, 9, 6],
]

// Faces belonging to only one element, oriented outward
export function boundaryFaces(mesh: Mesh): Face[] {
  const seen = new Map<string, Face | null>()
  const { tets } = mesh
  for (let e = 0; e < tets.length; e += 10) {
    for (const local of TET_FACES) {
      const face = local.map((i) => tets[e + i]) as unknown as Face
      const key = [face[0], face[1], face[2]].sort((a, b) => a - b).join(',')
      seen.set(key, seen.has(key) ? null : face)
    }
  }
  return [...seen.values()].filter((f): f is Face => f !== null)
}

// Six-point rule on the reference triangle, exact for quartics; weights include the reference area of 1/2
const G1 = 0.445948490915965, W1 = 0.223381589678011 / 2
const G2 = 0.091576213509771, W2 = 0.109951743655322 / 2
const TRI_GAUSS: readonly (readonly [number, number, number])[] = [
  [G1, G1, W1], [1 - 2 * G1, G1, W1], [G1, 1 - 2 * G1, W1],
  [G2, G2, W2], [1 - 2 * G2, G2, W2], [G2, 1 - 2 * G2, W2],
]

// Integrates each node's shape function times the outward area vector over a six-node face
export function integrateFace(
  nodes: Float64Array,
  face: Face,
  visit: (point: { N: Float64Array; areaVector: [number, number, number] }) => void,
): void {
  const N = new Float64Array(6)
  const dr = new Float64Array(6)
  const ds = new Float64Array(6)
  for (const [r, s, w] of TRI_GAUSS) {
    const t = 1 - r - s
    // Area coordinates: c0 = t, c1 = r, c2 = s
    N[0] = t * (2 * t - 1); N[1] = r * (2 * r - 1); N[2] = s * (2 * s - 1)
    N[3] = 4 * t * r; N[4] = 4 * r * s; N[5] = 4 * s * t
    dr[0] = 1 - 4 * t; dr[1] = 4 * r - 1; dr[2] = 0
    dr[3] = 4 * (t - r); dr[4] = 4 * s; dr[5] = -4 * s
    ds[0] = 1 - 4 * t; ds[1] = 0; ds[2] = 4 * s - 1
    ds[3] = -4 * r; ds[4] = 4 * r; ds[5] = 4 * (t - s)
    const xr = [0, 0, 0], xs = [0, 0, 0]
    for (let k = 0; k < 6; k++) {
      const p = 3 * face[k]
      for (let c = 0; c < 3; c++) {
        xr[c] += dr[k] * nodes[p + c]
        xs[c] += ds[k] * nodes[p + c]
      }
    }
    visit({
      N,
      areaVector: [
        w * (xr[1] * xs[2] - xr[2] * xs[1]),
        w * (xr[2] * xs[0] - xr[0] * xs[2]),
        w * (xr[0] * xs[1] - xr[1] * xs[0]),
      ],
    })
  }
}

export function faceArea(nodes: Float64Array, faces: readonly Face[]): number {
  let area = 0
  for (const face of faces) {
    integrateFace(nodes, face, ({ areaVector: [x, y, z] }) => {
      area += Math.hypot(x, y, z)
    })
  }
  return area
}
