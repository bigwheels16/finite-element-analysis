import { beforeAll, describe, expect, it } from 'vitest'
import { faceArea } from '../../fem/faces'
import { solveStatic } from '../../fem/solver'
import type { Material } from '../../fem/types'
import { meshSurface, surfaceVolume } from '../meshSurface'
import type { Surface, Tetgen } from '../tetgen'
import { loadTetgen } from './loadTetgen'

const steel: Material = { name: 'Steel', youngsModulus: 200e9, poissonsRatio: 0.3, yieldStrength: 250e6 }

// Box surface with one face id per side: 0 x=0, 1 x=lx, 2 y=0, 3 y=ly, 4 z=0, 5 z=lz
function boxSurface(lx: number, ly: number, lz: number): Surface {
  const v = [0, 0, 0, lx, 0, 0, lx, ly, 0, 0, ly, 0, 0, 0, lz, lx, 0, lz, lx, ly, lz, 0, ly, lz]
  const quads = [
    [0, 4, 7, 3], [1, 2, 6, 5], [0, 1, 5, 4], [3, 7, 6, 2], [0, 3, 2, 1], [4, 5, 6, 7],
  ]
  const triangles: number[] = []
  const faceIds: number[] = []
  quads.forEach(([a, b, c, d], id) => {
    triangles.push(a, b, c, a, c, d)
    faceIds.push(id, id)
  })
  return { vertices: Float64Array.from(v), triangles: Uint32Array.from(triangles), faceIds: Int32Array.from(faceIds) }
}

function tetVolume(nodes: Float64Array, t: Uint32Array, e: number): number {
  const p = (k: number, c: number) => nodes[3 * t[10 * e + k] + c] - nodes[3 * t[10 * e] + c]
  return (
    (p(1, 0) * (p(2, 1) * p(3, 2) - p(2, 2) * p(3, 1)) -
      p(1, 1) * (p(2, 0) * p(3, 2) - p(2, 2) * p(3, 0)) +
      p(1, 2) * (p(2, 0) * p(3, 1) - p(2, 1) * p(3, 0))) / 6
  )
}

describe('meshSurface', () => {
  let tetgen: Tetgen
  beforeAll(async () => {
    tetgen = await loadTetgen()
  })

  it('fills the box with positively oriented elements and keeps every face id', () => {
    const surface = boxSurface(2, 1, 0.5)
    expect(surfaceVolume(surface)).toBeCloseTo(1, 12)
    const { mesh, faces, faceIds } = meshSurface(tetgen, surface, { maxTetVolume: 0.01, maxElements: 5000 })
    let volume = 0
    for (let e = 0; e < mesh.tets.length / 10; e++) {
      const v = tetVolume(mesh.nodes, mesh.tets, e)
      expect(v).toBeGreaterThan(0)
      volume += v
    }
    expect(volume).toBeCloseTo(1, 10)
    expect(mesh.tets.length / 10).toBeGreaterThan(100)
    const areas = [0.5, 0.5, 1, 1, 2, 2]
    areas.forEach((area, id) => {
      expect(faceArea(mesh.nodes, faces.filter((_, i) => faceIds[i] === id))).toBeCloseTo(area, 10)
    })
  })

  it('passes the uniaxial patch test on the unstructured mesh', () => {
    const [lx, ly, lz] = [2, 1, 0.5]
    const { mesh, faces, faceIds } = meshSurface(tetgen, boxSurface(lx, ly, lz), { maxTetVolume: 0.02, maxElements: 5000 })
    const nodesOnFace = (id: number) => [...new Set(faces.filter((_, i) => faceIds[i] === id).flat())]
    const F = 1e6
    const result = solveStatic({
      mesh,
      material: steel,
      supports: [
        { nodes: nodesOnFace(0), fix: [true, false, false] },
        { nodes: nodesOnFace(2), fix: [false, true, false] },
        { nodes: nodesOnFace(4), fix: [false, false, true] },
      ],
      loads: [{ kind: 'faceForce', faces: faces.filter((_, i) => faceIds[i] === 1), force: [F, 0, 0] }],
    })
    const sigma = F / (ly * lz)
    for (let n = 0; n < mesh.nodes.length / 3; n++) {
      expect(result.stress[6 * n] / sigma).toBeCloseTo(1, 6)
      expect((result.displacement[3 * n] * steel.youngsModulus) / sigma).toBeCloseTo(mesh.nodes[3 * n], 6)
    }
  })

  it('refuses meshes over the element limit', () => {
    expect(() => meshSurface(tetgen, boxSurface(1, 1, 1), { maxTetVolume: 1e-4, maxElements: 100 })).toThrow(/over the limit/)
  })

  it('rejects an open surface', () => {
    const open = boxSurface(1, 1, 1)
    const surface = { ...open, triangles: open.triangles.slice(0, -3), faceIds: open.faceIds.slice(0, -1) }
    expect(() => meshSurface(tetgen, surface, { maxTetVolume: 0.01, maxElements: 5000 })).toThrow()
  })

  it('rejects a self-intersecting surface', () => {
    // Two overlapping boxes given as one surface
    const a = boxSurface(1, 1, 1)
    const b = boxSurface(1, 1, 1)
    const shifted = b.vertices.map((v, i) => (i % 3 === 0 ? v + 0.5 : v))
    const surface: Surface = {
      vertices: Float64Array.from([...a.vertices, ...shifted]),
      triangles: Uint32Array.from([...a.triangles, ...b.triangles.map((t) => t + 8)]),
      faceIds: Int32Array.from([...a.faceIds, ...b.faceIds]),
    }
    expect(() => meshSurface(tetgen, surface, { maxTetVolume: 0.01, maxElements: 5000 })).toThrow(/Meshing failed/)
  })
})
