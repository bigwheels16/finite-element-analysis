import type { Material } from '../fem/types'

// Supports and loads refer to geometric faces of the current solid
export type Restraint =
  | { id: string; kind: 'fixed'; faces: number[] }
  // Fixes movement normal to a flat face whose normal is along an axis
  | { id: string; kind: 'roller'; faces: number[] }

export type Action =
  | { id: string; kind: 'pressure'; faces: number[]; pressure: number } // MPa, positive pushes in
  | { id: string; kind: 'force'; faces: number[]; force: [number, number, number] } // N total
  | { id: string; kind: 'point'; position: [number, number, number]; force: [number, number, number] } // mm, N

export interface AnalysisSetup {
  material: Material
  restraints: Restraint[]
  actions: Action[]
}

export interface MeshSummary {
  elements: number
  nodes: number
  // Boundary drawn as linear triangles over the quadratic mesh's nodes, in mm
  positions: Float32Array
  triangles: Uint32Array
}

export interface AnalysisResult {
  // Per mesh node, in display units
  displacement: Float32Array // mm
  vonMises: Float32Array // MPa
  principal: Float32Array // MPa, s1 s2 s3 per node
  maxDisplacement: number // mm
  maxVonMises: number // MPa
  minFactorOfSafety: number
  // Total reaction force on each restraint, N
  reactions: { id: string; force: [number, number, number] }[]
  // Sum of applied loads, N
  appliedForce: [number, number, number]
  warnings: string[]
  solverIterations: number
  solveMs: number
}
