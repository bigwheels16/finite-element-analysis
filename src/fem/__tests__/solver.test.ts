import { describe, expect, it } from 'vitest'
import { boundaryFaces, faceArea } from '../faces'
import { loadVector, principalStresses, solveStatic } from '../solver'
import { boxMesh } from '../structuredMesh'
import { elasticity, elementStiffness } from '../tet10'
import type { Face, Material, Mesh } from '../types'

const steel: Material = { name: 'Steel', youngsModulus: 200e9, poissonsRatio: 0.3, yieldStrength: 250e6 }
const tol = 1e-6

function nodesWhere(mesh: Mesh, test: (x: number, y: number, z: number) => boolean): number[] {
  const out: number[] = []
  for (let n = 0; n < mesh.nodes.length / 3; n++) {
    if (test(mesh.nodes[3 * n], mesh.nodes[3 * n + 1], mesh.nodes[3 * n + 2])) out.push(n)
  }
  return out
}

function facesWhere(mesh: Mesh, test: (x: number, y: number, z: number) => boolean): Face[] {
  return boundaryFaces(mesh).filter((f) => f.every((n) => test(mesh.nodes[3 * n], mesh.nodes[3 * n + 1], mesh.nodes[3 * n + 2])))
}

describe('TET10 element', () => {
  const mesh = boxMesh(1, 1, 1, 1, 1, 1)
  const K = elementStiffness(mesh.nodes, mesh.tets.subarray(0, 10), elasticity(steel.youngsModulus, steel.poissonsRatio))

  it('is symmetric', () => {
    let max = 0
    for (const v of K) max = Math.max(max, Math.abs(v))
    for (let i = 0; i < 30; i++) for (let j = 0; j < 30; j++) expect(Math.abs(K[30 * i + j] - K[30 * j + i])).toBeLessThan(1e-12 * max)
  })

  it('has no stiffness against rigid-body motion', () => {
    const conn = mesh.tets.subarray(0, 10)
    const motions = [
      (x: number, y: number, z: number) => [1 + 0 * x * y * z, 0, 0],
      () => [0, 1, 0],
      () => [0, 0, 1],
      (x: number, y: number) => [-y, x, 0],
      (_x: number, y: number, z: number) => [0, -z, y],
      (x: number, _y: number, z: number) => [z, 0, -x],
    ]
    let max = 0
    for (const v of K) max = Math.max(max, Math.abs(v))
    for (const motion of motions) {
      const u = new Float64Array(30)
      for (let a = 0; a < 10; a++) {
        const p = 3 * conn[a]
        u.set(motion(mesh.nodes[p], mesh.nodes[p + 1], mesh.nodes[p + 2]), 3 * a)
      }
      for (let i = 0; i < 30; i++) {
        let s = 0
        for (let j = 0; j < 30; j++) s += K[30 * i + j] * u[j]
        expect(Math.abs(s)).toBeLessThan(1e-10 * max)
      }
    }
  })
})

describe('patch tests', () => {
  it('reproduces a linear displacement field exactly at interior nodes', () => {
    const mesh = boxMesh(2, 1.5, 1, 2, 2, 2)
    const field = (x: number, y: number, z: number) => [1e-4 * (x + 2 * y - z), 1e-4 * (-x + 0.5 * z), 1e-4 * (3 * y + z)] as const
    const boundary = nodesWhere(mesh, (x, y, z) => [x, y, z].some((v, i) => Math.abs(v) < tol || Math.abs(v - [2, 1.5, 1][i]) < tol))
    const result = solveStatic({
      mesh,
      material: steel,
      supports: boundary.map((n) => ({
        nodes: [n],
        fix: [true, true, true],
        displacement: field(mesh.nodes[3 * n], mesh.nodes[3 * n + 1], mesh.nodes[3 * n + 2]),
      })),
      loads: [],
    })
    expect(mesh.nodes.length / 3 - boundary.length).toBeGreaterThan(0)
    for (let n = 0; n < mesh.nodes.length / 3; n++) {
      const expected = field(mesh.nodes[3 * n], mesh.nodes[3 * n + 1], mesh.nodes[3 * n + 2])
      for (let c = 0; c < 3; c++) expect(result.displacement[3 * n + c] / 1e-4).toBeCloseTo(expected[c] / 1e-4, 6)
    }
    // Constant strain gives the same stress at every node
    const E = steel.youngsModulus, nu = steel.poissonsRatio
    const lam = (E * nu) / ((1 + nu) * (1 - 2 * nu)), mu = E / (2 * (1 + nu))
    const exx = 1e-4, eyy = 0, ezz = 1e-4, gxy = 1e-4, gyz = 3.5e-4, gzx = -1e-4
    const tr = exx + eyy + ezz
    const expected = [lam * tr + 2 * mu * exx, lam * tr + 2 * mu * eyy, lam * tr + 2 * mu * ezz, mu * gxy, mu * gyz, mu * gzx]
    for (let n = 0; n < mesh.nodes.length / 3; n++) {
      for (let i = 0; i < 6; i++) expect(result.stress[6 * n + i] / 1e6).toBeCloseTo(expected[i] / 1e6, 5)
    }
  })

  it('gives uniform uniaxial stress and the exact elongation under an end load', () => {
    const [L, w, h] = [3, 1, 0.5]
    const mesh = boxMesh(L, w, h, 3, 2, 2)
    const F = 1e6
    const result = solveStatic({
      mesh,
      material: steel,
      supports: [
        { nodes: nodesWhere(mesh, (x) => Math.abs(x) < tol), fix: [true, false, false] },
        { nodes: nodesWhere(mesh, (x, y, z) => Math.abs(x) < tol && Math.abs(y) < tol && Math.abs(z) < tol), fix: [false, true, true] },
        { nodes: nodesWhere(mesh, (x, y, z) => Math.abs(x) < tol && Math.abs(y - w) < tol && Math.abs(z) < tol), fix: [false, false, true] },
      ],
      loads: [{ kind: 'faceForce', faces: facesWhere(mesh, (x) => Math.abs(x - L) < tol), force: [F, 0, 0] }],
    })
    const sigma = F / (w * h)
    for (let n = 0; n < mesh.nodes.length / 3; n++) {
      expect(result.stress[6 * n] / sigma).toBeCloseTo(1, 8)
      expect(result.vonMises[n] / sigma).toBeCloseTo(1, 8)
      const x = mesh.nodes[3 * n], y = mesh.nodes[3 * n + 1]
      expect((result.displacement[3 * n] * steel.youngsModulus) / sigma).toBeCloseTo(x, 8)
      expect((result.displacement[3 * n + 1] * steel.youngsModulus) / sigma).toBeCloseTo(-steel.poissonsRatio * y, 8)
    }
    expect(result.minFactorOfSafety / (steel.yieldStrength / sigma)).toBeCloseTo(1, 8)
  })
})

describe('loads and reactions', () => {
  const mesh = boxMesh(2, 1, 1, 2, 2, 2)

  it('distributes a pressure to the face area times pressure', () => {
    const top = facesWhere(mesh, (_x, _y, z) => Math.abs(z - 1) < tol)
    expect(faceArea(mesh.nodes, top)).toBeCloseTo(2, 12)
    const f = loadVector(mesh.nodes, [{ kind: 'pressure', faces: top, pressure: 1000 }])
    const total = [0, 0, 0]
    for (let i = 0; i < f.length; i++) total[i % 3] += f[i]
    expect(total[0]).toBeCloseTo(0, 9)
    expect(total[1]).toBeCloseTo(0, 9)
    expect(total[2]).toBeCloseTo(-2000, 9)
  })

  it('balances applied loads with reactions', () => {
    const result = solveStatic({
      mesh,
      material: steel,
      supports: [{ nodes: nodesWhere(mesh, (x) => Math.abs(x) < tol), fix: [true, true, true] }],
      loads: [
        { kind: 'faceForce', faces: facesWhere(mesh, (x) => Math.abs(x - 2) < tol), force: [100, -200, 300] },
        { kind: 'nodalForce', node: nodesWhere(mesh, (x, y, z) => x === 2 && y === 1 && z === 1)[0], force: [0, 0, -50] },
      ],
    })
    const total = [0, 0, 0]
    for (let i = 0; i < result.reaction.length; i++) total[i % 3] += result.reaction[i]
    expect(total[0]).toBeCloseTo(-100, 6)
    expect(total[1]).toBeCloseTo(200, 6)
    expect(total[2]).toBeCloseTo(-250, 6)
  })

  it('rejects a model with no supports', () => {
    expect(() => solveStatic({ mesh, material: steel, supports: [], loads: [] })).toThrow(/no supports/)
  })

  it('rejects an under-constrained model', () => {
    // A single pinned node leaves rotations free
    const pinned = nodesWhere(mesh, (x, y, z) => x === 0 && y === 0 && z === 0)
    expect(() =>
      solveStatic({
        mesh,
        material: steel,
        supports: [{ nodes: pinned, fix: [true, true, true] }],
        loads: [{ kind: 'faceForce', faces: facesWhere(mesh, (x) => Math.abs(x - 2) < tol), force: [0, 0, 1000] }],
      }),
    ).toThrow(/under-constrained/)
  })
})

describe('principal stresses', () => {
  it('matches a known tensor', () => {
    const out = new Float64Array(3)
    // Eigenvalues of [[2,1,0],[1,2,0],[0,0,5]] are 5, 3, 1
    principalStresses([2, 2, 5, 1, 0, 0], 0, out, 0)
    expect([...out].map((v) => +v.toFixed(10))).toEqual([5, 3, 1])
    principalStresses([-7, -7, -7, 0, 0, 0], 0, out, 0)
    expect([...out]).toEqual([-7, -7, -7])
  })
})
