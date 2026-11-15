import type { ManifoldToplevel } from 'manifold-3d'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildSolid } from '../../geometry/build'
import { loadManifold } from '../../geometry/__tests__/loadManifold'
import type { Feature, Solid } from '../../geometry/types'
import { loadTetgen } from '../../mesher/__tests__/loadTetgen'
import type { Tetgen } from '../../mesher/tetgen'
import { analyze, meshSolid } from '../pipeline'
import type { Restraint } from '../types'

const steel = { name: 'Steel', youngsModulus: 200e9, poissonsRatio: 0.3, yieldStrength: 250e6 }

// Removes everything outside the first quadrant (x >= 0, y >= 0)
const quadrantCut: Feature = {
  id: 'cut', name: 'Quadrant', plane: 'XY', offset: -1, depth: 1000, operation: 'subtract',
  shapes: [
    { kind: 'rect', x: -500, y: -500, w: 1000, h: 500, hole: false },
    { kind: 'rect', x: -500, y: 0, w: 500, h: 500, hole: false },
  ],
}

function flatFace(solid: Solid, axis: number, sign: number, at?: number): number {
  const face = solid.faces.find((f) => f.normal !== null && f.normal[axis] * sign > 0.999 && (at === undefined || Math.abs(f.centroid[axis] - at) < 1e-6))
  if (!face) throw new Error(`No face facing ${sign > 0 ? '+' : '-'}${'xyz'[axis]}`)
  return face.id
}

function rollers(solid: Solid, faces: [number, number, number?][]): Restraint[] {
  return faces.map(([axis, sign, at], i) => ({ id: `r${i}`, kind: 'roller', faces: [flatFace(solid, axis, sign, at)] }))
}

describe('benchmarks against closed-form solutions', () => {
  let wasm: ManifoldToplevel
  let tetgen: Tetgen
  beforeAll(async () => {
    wasm = await loadManifold()
    tetgen = await loadTetgen()
  })

  it('thick-walled cylinder under internal pressure matches Lamé (plane strain)', () => {
    const [a, b, length, p] = [50, 100, 20, 10]
    const ring: Feature = {
      id: 'ring', name: 'Ring', plane: 'XY', offset: 0, depth: length, operation: 'add',
      shapes: [{ kind: 'circle', cx: 0, cy: 0, r: b, hole: false }, { kind: 'circle', cx: 0, cy: 0, r: a, hole: true }],
    }
    const solid = buildSolid(wasm, [ring, quadrantCut], 3)
    const curved = solid.faces.filter((f) => f.normal === null).sort((x, y) => x.area - y.area)
    expect(curved).toHaveLength(2)
    const solidMesh = meshSolid(tetgen, solid, 8)
    const result = analyze(solid, solidMesh, {
      material: steel,
      // Symmetry on the cut planes, and both ends held axially for plane strain
      restraints: rollers(solid, [[0, -1], [1, -1], [2, -1], [2, 1]]),
      actions: [{ id: 'p', kind: 'pressure', faces: [curved[0].id], pressure: p }],
    })

    const E = steel.youngsModulus / 1e6, nu = steel.poissonsRatio
    const A = (p * a * a) / (b * b - a * a), C = (p * a * a * b * b) / (b * b - a * a)
    const hoopInner = A + C / (a * a)
    const uInner = ((1 + nu) / E) * ((1 - 2 * nu) * A * a + C / a)

    // Average hoop stress and radial displacement over the bore, mid-length
    const { nodes } = solidMesh.mesh
    const stress = result.principal
    let hoop = 0, u = 0, count = 0
    for (let n = 0; n < nodes.length / 3; n++) {
      const [x, y, z] = [nodes[3 * n] * 1e3, nodes[3 * n + 1] * 1e3, nodes[3 * n + 2] * 1e3]
      const r = Math.hypot(x, y)
      if (Math.abs(r - a) > 0.05 || Math.abs(z - length / 2) > length / 4) continue
      // On the bore, hoop is the largest principal stress
      hoop += stress[3 * n]
      u += (result.displacement[3 * n] * x + result.displacement[3 * n + 1] * y) / r
      count++
    }
    expect(count).toBeGreaterThan(10)
    expect(Math.abs(hoop / count / hoopInner - 1)).toBeLessThan(0.01)
    expect(Math.abs(u / count / uInner - 1)).toBeLessThan(0.01)
  }, 60000)

  it('plate with a hole in tension matches the Heywood stress concentration', () => {
    const [halfLength, halfWidth, t, r, sigma] = [100, 50, 2, 5, 100]
    const plate: Feature = {
      id: 'plate', name: 'Plate', plane: 'XY', offset: 0, depth: t, operation: 'add',
      shapes: [
        { kind: 'rect', x: -halfLength, y: -halfWidth, w: 2 * halfLength, h: 2 * halfWidth, hole: false },
        { kind: 'circle', cx: 0, cy: 0, r, hole: true },
      ],
    }
    const solid = buildSolid(wasm, [plate, quadrantCut], 0.5)
    const solidMesh = meshSolid(tetgen, solid, 6)
    const result = analyze(solid, solidMesh, {
      material: steel,
      restraints: rollers(solid, [[0, -1], [1, -1], [2, -1, 0]]),
      actions: [{ id: 'f', kind: 'force', faces: [flatFace(solid, 0, 1, halfLength)], force: [sigma * halfWidth * t, 0, 0] }],
    })

    // Heywood: Kt on net section 2 + (1 - d/W)^3, converted to gross stress
    const dw = (2 * r) / (2 * halfWidth)
    const peak = ((2 + (1 - dw) ** 3) * sigma) / (1 - dw)
    expect(Math.abs(result.maxVonMises / peak - 1)).toBeLessThan(0.03)
  }, 60000)
})
