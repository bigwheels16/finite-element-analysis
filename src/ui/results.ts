import type { AnalysisResult } from '../analysis/types'

export type Field = 'vonMises' | 'displacement' | 's1' | 's3' | 'fos'

export const FIELDS: { id: Field; label: string; unit: string }[] = [
  { id: 'vonMises', label: 'Von Mises stress', unit: 'MPa' },
  { id: 'displacement', label: 'Displacement', unit: 'mm' },
  { id: 's1', label: 'Max principal stress', unit: 'MPa' },
  { id: 's3', label: 'Min principal stress', unit: 'MPa' },
  { id: 'fos', label: 'Factor of safety', unit: '' },
]

// Factors of safety above this are shown at the top of the scale
export const FOS_CAP = 5

export function fieldValues(result: AnalysisResult, field: Field, yieldMpa: number): Float32Array {
  const n = result.vonMises.length
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    switch (field) {
      case 'vonMises': out[i] = result.vonMises[i]; break
      case 'displacement': out[i] = Math.hypot(result.displacement[3 * i], result.displacement[3 * i + 1], result.displacement[3 * i + 2]); break
      case 's1': out[i] = result.principal[3 * i]; break
      case 's3': out[i] = result.principal[3 * i + 2]; break
      case 'fos': out[i] = result.vonMises[i] > 0 ? Math.min(FOS_CAP, yieldMpa / result.vonMises[i]) : FOS_CAP; break
    }
  }
  return out
}

// Range of a field over the nodes that are drawn
export function fieldRange(values: Float32Array, nodes: Uint32Array): [number, number] {
  let lo = Infinity, hi = -Infinity
  for (const n of nodes) {
    lo = Math.min(lo, values[n])
    hi = Math.max(hi, values[n])
  }
  return [lo, hi]
}

// Values below zeroBelow in magnitude show as 0, hiding round-off
export function formatNumber(v: number, zeroBelow = 0): string {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : '−∞'
  const a = Math.abs(v)
  if (a <= zeroBelow) return '0'
  if (a >= 1e5 || a < 1e-3) return v.toExponential(3)
  return v.toPrecision(4)
}
