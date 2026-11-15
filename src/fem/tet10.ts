// Midside node index for each corner pair
export const TET10_EDGES: readonly (readonly [number, number])[] = [
  [0, 1], [1, 2], [0, 2], [0, 3], [1, 3], [2, 3],
]

// Natural coordinates (xi, eta, zeta) of the ten nodes
export const TET10_NODE_COORDS: readonly (readonly [number, number, number])[] = [
  [0, 0, 0], [1, 0, 0], [0, 1, 0], [0, 0, 1],
  [0.5, 0, 0], [0.5, 0.5, 0], [0, 0.5, 0], [0, 0, 0.5], [0.5, 0, 0.5], [0, 0.5, 0.5],
]

// Four-point rule, exact for quadratics; weights include the reference volume of 1/6
const A = 0.5854101966249685
const B = 0.1381966011250105
export const TET_GAUSS: readonly (readonly [number, number, number, number])[] = [
  [B, B, B, 1 / 24], [A, B, B, 1 / 24], [B, A, B, 1 / 24], [B, B, A, 1 / 24],
]

// Volume coordinate derivatives with respect to xi, eta, zeta
const DL: readonly (readonly [number, number, number])[] = [
  [-1, -1, -1], [1, 0, 0], [0, 1, 0], [0, 0, 1],
]

// Shape function derivatives in natural coordinates: out[3n + a] = dN_n / dxi_a
export function shapeDerivatives(xi: number, eta: number, zeta: number, out: Float64Array): void {
  const L = [1 - xi - eta - zeta, xi, eta, zeta]
  for (let n = 0; n < 4; n++) {
    const d = 4 * L[n] - 1
    for (let a = 0; a < 3; a++) out[3 * n + a] = d * DL[n][a]
  }
  for (let e = 0; e < 6; e++) {
    const [i, j] = TET10_EDGES[e]
    for (let a = 0; a < 3; a++) out[3 * (4 + e) + a] = 4 * (DL[i][a] * L[j] + L[i] * DL[j][a])
  }
}

// Cartesian shape function derivatives at a natural point; returns det(J), throws on an inverted element
export function cartesianDerivatives(
  nodes: Float64Array,
  conn: ArrayLike<number>,
  xi: number, eta: number, zeta: number,
  dN: Float64Array,
  out: Float64Array,
): number {
  shapeDerivatives(xi, eta, zeta, dN)
  // J[a][b] = d x_b / d xi_a
  const J = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  for (let n = 0; n < 10; n++) {
    const p = 3 * conn[n]
    for (let a = 0; a < 3; a++) {
      const d = dN[3 * n + a]
      J[3 * a] += d * nodes[p]
      J[3 * a + 1] += d * nodes[p + 1]
      J[3 * a + 2] += d * nodes[p + 2]
    }
  }
  const det =
    J[0] * (J[4] * J[8] - J[5] * J[7]) -
    J[1] * (J[3] * J[8] - J[5] * J[6]) +
    J[2] * (J[3] * J[7] - J[4] * J[6])
  if (!(det > 0)) throw new Error(`Inverted or degenerate element (det J = ${det})`)
  const inv = [
    (J[4] * J[8] - J[5] * J[7]) / det, (J[2] * J[7] - J[1] * J[8]) / det, (J[1] * J[5] - J[2] * J[4]) / det,
    (J[5] * J[6] - J[3] * J[8]) / det, (J[0] * J[8] - J[2] * J[6]) / det, (J[2] * J[3] - J[0] * J[5]) / det,
    (J[3] * J[7] - J[4] * J[6]) / det, (J[1] * J[6] - J[0] * J[7]) / det, (J[0] * J[4] - J[1] * J[3]) / det,
  ]
  // dN/dx_b = sum_a inv(J)[b][a] dN/dxi_a
  for (let n = 0; n < 10; n++) {
    const d0 = dN[3 * n], d1 = dN[3 * n + 1], d2 = dN[3 * n + 2]
    out[3 * n] = inv[0] * d0 + inv[1] * d1 + inv[2] * d2
    out[3 * n + 1] = inv[3] * d0 + inv[4] * d1 + inv[5] * d2
    out[3 * n + 2] = inv[6] * d0 + inv[7] * d1 + inv[8] * d2
  }
  return det
}

// Isotropic elasticity matrix for strains [exx, eyy, ezz, gxy, gyz, gzx]
export function elasticity(E: number, nu: number): Float64Array {
  const lam = (E * nu) / ((1 + nu) * (1 - 2 * nu))
  const mu = E / (2 * (1 + nu))
  const D = new Float64Array(36)
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) D[6 * i + j] = lam
    D[6 * i + i] = lam + 2 * mu
    D[6 * (i + 3) + i + 3] = mu
  }
  return D
}

// Stress [sxx, syy, szz, sxy, syz, szx] from Cartesian derivatives and element displacements
export function stressAt(dNdx: Float64Array, ue: Float64Array, D: Float64Array, out: Float64Array, offset: number): void {
  const e = [0, 0, 0, 0, 0, 0]
  for (let n = 0; n < 10; n++) {
    const dx = dNdx[3 * n], dy = dNdx[3 * n + 1], dz = dNdx[3 * n + 2]
    const ux = ue[3 * n], uy = ue[3 * n + 1], uz = ue[3 * n + 2]
    e[0] += dx * ux
    e[1] += dy * uy
    e[2] += dz * uz
    e[3] += dy * ux + dx * uy
    e[4] += dz * uy + dy * uz
    e[5] += dz * ux + dx * uz
  }
  for (let i = 0; i < 6; i++) {
    let s = 0
    for (let j = 0; j < 6; j++) s += D[6 * i + j] * e[j]
    out[offset + i] = s
  }
}

// 30x30 element stiffness, row-major
export function elementStiffness(nodes: Float64Array, conn: ArrayLike<number>, D: Float64Array): Float64Array {
  const K = new Float64Array(900)
  const dN = new Float64Array(30)
  const g = new Float64Array(30)
  for (const [xi, eta, zeta, w] of TET_GAUSS) {
    const f = w * cartesianDerivatives(nodes, conn, xi, eta, zeta, dN, g)
    for (let a = 0; a < 10; a++) {
      // Columns of B for node a: rows exx, eyy, ezz, gxy, gyz, gzx
      const ax = g[3 * a], ay = g[3 * a + 1], az = g[3 * a + 2]
      const Ba = [
        [ax, 0, 0], [0, ay, 0], [0, 0, az], [ay, ax, 0], [0, az, ay], [az, 0, ax],
      ]
      // DBa = D * Ba (6x3)
      const DBa = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
      for (let r = 0; r < 6; r++) {
        for (let k = 0; k < 6; k++) {
          const d = D[6 * r + k]
          if (d === 0) continue
          DBa[3 * r] += d * Ba[k][0]
          DBa[3 * r + 1] += d * Ba[k][1]
          DBa[3 * r + 2] += d * Ba[k][2]
        }
      }
      for (let b = 0; b < 10; b++) {
        const bx = g[3 * b], by = g[3 * b + 1], bz = g[3 * b + 2]
        const Bb = [
          [bx, 0, 0], [0, by, 0], [0, 0, bz], [by, bx, 0], [0, bz, by], [bz, 0, bx],
        ]
        // Kab = Bb^T * DBa, placed at rows of b, columns of a (symmetric overall)
        for (let i = 0; i < 3; i++) {
          for (let j = 0; j < 3; j++) {
            let s = 0
            for (let r = 0; r < 6; r++) s += Bb[r][i] * DBa[3 * r + j]
            K[(3 * b + i) * 30 + 3 * a + j] += f * s
          }
        }
      }
    }
  }
  return K
}
