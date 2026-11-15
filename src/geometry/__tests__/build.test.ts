import type { ManifoldToplevel } from 'manifold-3d'
import { beforeAll, describe, expect, it } from 'vitest'
import { buildSolid } from '../build'
import type { Feature } from '../types'
import { loadManifold } from './loadManifold'

const plate: Feature = {
  id: 'f1', name: 'Plate', plane: 'XY', offset: 0, depth: 10, operation: 'add',
  shapes: [{ kind: 'rect', x: 0, y: 0, w: 100, h: 50, hole: false }],
}

describe('buildSolid', () => {
  let wasm: ManifoldToplevel
  beforeAll(async () => {
    wasm = await loadManifold()
  })

  it('extrudes a rectangle into a box with six flat faces', () => {
    const solid = buildSolid(wasm, [plate], 2)
    expect(solid.volume).toBeCloseTo(50000, 6)
    expect(solid.faces).toHaveLength(6)
    expect(solid.faces.every((f) => f.normal !== null)).toBe(true)
    const top = solid.faces.find((f) => f.normal![2] > 0.99)!
    expect(top.area).toBeCloseTo(5000, 6)
    expect(top.centroid[2]).toBeCloseTo(10, 9)
  })

  it('cuts a hole as one curved face', () => {
    const solid = buildSolid(wasm, [{ ...plate, shapes: [...plate.shapes, { kind: 'circle', cx: 50, cy: 25, r: 10, hole: true }] }], 2)
    expect(solid.faces).toHaveLength(7)
    const bore = solid.faces.filter((f) => f.normal === null)
    expect(bore).toHaveLength(1)
    // Faceted bore area is close to the true cylinder's
    expect(bore[0].area / (2 * Math.PI * 10 * 10)).toBeCloseTo(1, 2)
  })

  it('subtracts a feature sketched on another plane', () => {
    const slot: Feature = {
      id: 'f2', name: 'Slot', plane: 'XZ', offset: -60, depth: 80, operation: 'subtract',
      shapes: [{ kind: 'rect', x: 40, y: 5, w: 20, h: 10, hole: false }],
    }
    const solid = buildSolid(wasm, [plate, slot], 2)
    expect(solid.volume).toBeCloseTo(50000 - 20 * 5 * 50, 6)
  })

  it('rejects invalid input', () => {
    expect(() => buildSolid(wasm, [], 2)).toThrow(/Add a feature/)
    expect(() => buildSolid(wasm, [{ ...plate, operation: 'subtract' }], 2)).toThrow(/first feature/)
    expect(() => buildSolid(wasm, [{ ...plate, depth: 0 }], 2)).toThrow(/depth/)
    expect(() => buildSolid(wasm, [{ ...plate, shapes: [{ kind: 'circle', cx: 0, cy: 0, r: -1, hole: false }] }], 2)).toThrow(/radius/)
  })
})
