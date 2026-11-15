import type { AnalysisResult, AnalysisSetup, MeshSummary } from '../analysis/types'
import type { Feature, Solid } from '../geometry/types'

export type Request =
  | { type: 'build'; features: Feature[]; maxEdge: number }
  | { type: 'mesh'; elementSize: number }
  | { type: 'solve'; setup: AnalysisSetup }

export type Response =
  | { type: 'build'; solid: Solid }
  | { type: 'mesh'; summary: MeshSummary }
  | { type: 'solve'; result: AnalysisResult }

export type Envelope<T> = { id: number } & ({ ok: true; value: T } | { ok: false; error: string })
