import { describe, expect, it } from 'vitest'
import { boundaryFaces } from '../faces'
import { solveStatic } from '../solver'
import { boxMesh } from '../structuredMesh'
import type { Material } from '../types'

const steel: Material = { name: 'Steel', youngsModulus: 200e9, poissonsRatio: 0.3, yieldStrength: 250e6 }

describe('cantilever beam', () => {
  it('matches Timoshenko tip deflection and root bending stress', () => {
    const [L, b, h, P] = [1, 0.1, 0.1, 1000]
    const mesh = boxMesh(L, b, h, 20, 2, 2)
    const tol = 1e-9
    const clamped: number[] = []
    for (let n = 0; n < mesh.nodes.length / 3; n++) if (Math.abs(mesh.nodes[3 * n]) < tol) clamped.push(n)
    const tip = boundaryFaces(mesh).filter((f) => f.every((n) => Math.abs(mesh.nodes[3 * n] - L) < tol))
    const result = solveStatic({
      mesh,
      material: steel,
      supports: [{ nodes: clamped, fix: [true, true, true] }],
      loads: [{ kind: 'faceForce', faces: tip, force: [0, 0, -P] }],
    })

    const I = (b * h ** 3) / 12
    const G = steel.youngsModulus / (2 * (1 + steel.poissonsRatio))
    const expected = (P * L ** 3) / (3 * steel.youngsModulus * I) + (P * L) / ((5 / 6) * G * b * h)
    let tipDeflection = 0, tipNodes = 0
    for (let n = 0; n < mesh.nodes.length / 3; n++) {
      if (Math.abs(mesh.nodes[3 * n] - L) < tol) {
        tipDeflection += -result.displacement[3 * n + 2]
        tipNodes++
      }
    }
    tipDeflection /= tipNodes
    expect(Math.abs(tipDeflection / expected - 1)).toBeLessThan(0.02)

    // Bending stress at mid-span, clear of the clamp's local effects
    const sigma = (P * (L / 2) * (h / 2)) / I
    let top = 0
    for (let n = 0; n < mesh.nodes.length / 3; n++) {
      const [x, , z] = mesh.nodes.subarray(3 * n, 3 * n + 3)
      if (Math.abs(x - L / 2) < tol && Math.abs(z - h) < tol) top = Math.max(top, result.stress[6 * n])
    }
    expect(Math.abs(top / sigma - 1)).toBeLessThan(0.05)
  })
})
