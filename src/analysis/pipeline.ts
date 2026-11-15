import type { Face, Load, Support } from '../fem/types'
import { loadVector, solveStatic } from '../fem/solver'
import type { Solid } from '../geometry/types'
import { meshSurface, type SolidMesh } from '../mesher/meshSurface'
import type { Tetgen } from '../mesher/tetgen'
import type { AnalysisResult, AnalysisSetup, MeshSummary } from './types'

const MM = 1e-3
const MPA = 1e6

export const MAX_ELEMENTS = 15000

// Volume of a regular tet with the given edge length
export function tetVolumeForEdge(edge: number): number {
  return (edge ** 3) / (6 * Math.SQRT2)
}

// Meshes the solid with quadratic tets of roughly the given edge length (mm)
export function meshSolid(tetgen: Tetgen, solid: Solid, elementSize: number): SolidMesh {
  const vertices = new Float64Array(solid.vertices.length)
  for (let i = 0; i < vertices.length; i++) vertices[i] = solid.vertices[i] * MM
  return meshSurface(
    tetgen,
    { vertices, triangles: solid.triangles, faceIds: solid.faceIds },
    { maxTetVolume: tetVolumeForEdge(elementSize * MM), maxElements: MAX_ELEMENTS },
  )
}

export function summarizeMesh(solidMesh: SolidMesh): MeshSummary {
  const { mesh, faces } = solidMesh
  const positions = new Float32Array(mesh.nodes.length)
  for (let i = 0; i < positions.length; i++) positions[i] = mesh.nodes[i] / MM
  // Each six-node face drawn as four triangles
  const triangles = new Uint32Array(faces.length * 12)
  faces.forEach(([c0, c1, c2, m01, m12, m20], i) => {
    triangles.set([c0, m01, m20, m01, c1, m12, m20, m12, c2, m01, m12, m20], 12 * i)
  })
  return { elements: mesh.tets.length / 10, nodes: mesh.nodes.length / 3, positions, triangles }
}

function facesWithIds(solidMesh: SolidMesh, ids: readonly number[], label: string): Face[] {
  const wanted = new Set(ids)
  const faces = solidMesh.faces.filter((_, i) => wanted.has(solidMesh.faceIds[i]))
  if (faces.length === 0) throw new Error(`${label} is not applied to any face`)
  return faces
}

function nodesOf(faces: readonly Face[]): number[] {
  return [...new Set(faces.flat())]
}

export function analyze(solid: Solid, solidMesh: SolidMesh, setup: AnalysisSetup): AnalysisResult {
  const start = performance.now()
  const { mesh } = solidMesh
  const warnings: string[] = []
  if (setup.restraints.length === 0) throw new Error('Add at least one support')
  if (setup.actions.length === 0) throw new Error('Add at least one load')

  const restraintNodes: { id: string; nodes: number[] }[] = []
  const supports: Support[] = setup.restraints.map((r, i) => {
    const label = `Support ${i + 1}`
    const nodes = nodesOf(facesWithIds(solidMesh, r.faces, label))
    restraintNodes.push({ id: r.id, nodes })
    if (r.kind === 'fixed') return { nodes, fix: [true, true, true] }
    const axes = new Set<number>()
    for (const id of r.faces) {
      const n = solid.faces[id]?.normal
      const axis = n ? n.findIndex((c) => Math.abs(Math.abs(c) - 1) < 1e-6) : -1
      if (axis < 0) throw new Error(`${label}: a roller needs flat faces facing along X, Y or Z`)
      axes.add(axis)
    }
    if (axes.size !== 1) throw new Error(`${label}: a roller's faces must all face along the same axis`)
    const axis = [...axes][0]
    return { nodes, fix: [axis === 0, axis === 1, axis === 2] }
  })

  const loads: Load[] = setup.actions.map((a, i) => {
    const label = `Load ${i + 1}`
    switch (a.kind) {
      case 'pressure':
        if (!Number.isFinite(a.pressure) || a.pressure === 0) throw new Error(`${label}: pressure must be non-zero`)
        return { kind: 'pressure', faces: facesWithIds(solidMesh, a.faces, label), pressure: a.pressure * MPA }
      case 'force':
        if (!a.force.every(Number.isFinite) || a.force.every((c) => c === 0)) throw new Error(`${label}: force must be non-zero`)
        return { kind: 'faceForce', faces: facesWithIds(solidMesh, a.faces, label), force: a.force }
      case 'point': {
        if (!a.force.every(Number.isFinite) || a.force.every((c) => c === 0)) throw new Error(`${label}: force must be non-zero`)
        warnings.push(`${label} is a point load: stresses next to it are unrealistically high; judge the part by stresses away from it.`)
        return { kind: 'nodalForce', node: nearestBoundaryNode(solidMesh, a.position), force: a.force }
      }
    }
  })

  const result = solveStatic({ mesh, material: setup.material, supports, loads })
  const nodeCount = mesh.nodes.length / 3

  // Resultant of all applied loads, pressures included
  const f = loadVector(mesh.nodes, loads)
  const appliedForce: [number, number, number] = [0, 0, 0]
  for (let i = 0; i < f.length; i++) appliedForce[i % 3] += f[i]
  const claimed = new Set<number>()
  const reactions = restraintNodes.map(({ id, nodes }) => {
    const force: [number, number, number] = [0, 0, 0]
    for (const n of nodes) {
      if (claimed.has(n)) continue
      claimed.add(n)
      for (let c = 0; c < 3; c++) force[c] += result.reaction[3 * n + c]
    }
    return { id, force }
  })

  const displacement = new Float32Array(3 * nodeCount)
  let maxDisplacement = 0
  for (let n = 0; n < nodeCount; n++) {
    const [x, y, z] = [result.displacement[3 * n] / MM, result.displacement[3 * n + 1] / MM, result.displacement[3 * n + 2] / MM]
    displacement.set([x, y, z], 3 * n)
    maxDisplacement = Math.max(maxDisplacement, Math.hypot(x, y, z))
  }
  const vonMises = new Float32Array(nodeCount)
  let maxVonMises = 0
  for (let n = 0; n < nodeCount; n++) {
    vonMises[n] = result.vonMises[n] / MPA
    maxVonMises = Math.max(maxVonMises, vonMises[n])
  }
  const principal = new Float32Array(3 * nodeCount)
  for (let i = 0; i < principal.length; i++) principal[i] = result.principal[i] / MPA

  const elements = mesh.tets.length / 10
  if (elements < 2000) {
    warnings.push(`The mesh has only ${elements} elements: peak stresses at holes and corners are likely under-predicted. Halve the element size and compare.`)
  }
  const bboxSize = boundingSize(mesh.nodes)
  if (maxDisplacement * MM > 0.05 * bboxSize) {
    warnings.push('Deflection exceeds 5% of the part size: linear (small-deflection) analysis is not reliable here.')
  }
  if (result.minFactorOfSafety < 1) warnings.push('Peak stress exceeds yield: the part is predicted to yield.')

  return {
    displacement,
    vonMises,
    principal,
    maxDisplacement,
    maxVonMises,
    minFactorOfSafety: result.minFactorOfSafety,
    reactions,
    appliedForce,
    warnings,
    solverIterations: result.solverIterations,
    solveMs: performance.now() - start,
  }
}

function nearestBoundaryNode(solidMesh: SolidMesh, positionMm: readonly number[]): number {
  const { nodes } = solidMesh.mesh
  const p = positionMm.map((c) => c * MM)
  let best = -1, bestDist = Infinity
  for (const face of solidMesh.faces) {
    for (let k = 0; k < 3; k++) {
      const n = face[k]
      const d = Math.hypot(nodes[3 * n] - p[0], nodes[3 * n + 1] - p[1], nodes[3 * n + 2] - p[2])
      if (d < bestDist) {
        bestDist = d
        best = n
      }
    }
  }
  if (best < 0) throw new Error('Mesh has no boundary nodes')
  return best
}

function boundingSize(nodes: Float64Array): number {
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < nodes.length; i++) {
    lo[i % 3] = Math.min(lo[i % 3], nodes[i])
    hi[i % 3] = Math.max(hi[i % 3], nodes[i])
  }
  return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])
}
