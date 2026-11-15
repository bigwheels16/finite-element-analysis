import type { Material } from '../fem/types'

// Typical room-temperature properties; minimum specified yield where a standard gives one
export const MATERIALS: Material[] = [
  { name: 'Structural steel (ASTM A36)', youngsModulus: 200e9, poissonsRatio: 0.26, yieldStrength: 250e6 },
  { name: 'Aluminium 6061-T6', youngsModulus: 68.9e9, poissonsRatio: 0.33, yieldStrength: 276e6 },
  { name: 'Stainless steel 304 (annealed)', youngsModulus: 193e9, poissonsRatio: 0.29, yieldStrength: 215e6 },
]
