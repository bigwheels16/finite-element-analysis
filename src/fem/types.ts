// Quadratic tetrahedral mesh: corners 0-3, then midside nodes on edges 01, 12, 02, 03, 13, 23
export interface Mesh {
  // x, y, z per node, in metres
  nodes: Float64Array
  // 10 node indices per element
  tets: Uint32Array
}

// Linear-elastic isotropic material, SI units
export interface Material {
  name: string
  youngsModulus: number // Pa
  poissonsRatio: number
  yieldStrength: number // Pa
}

// Six-node boundary face: corners c0, c1, c2 counter-clockwise seen from outside, then midsides 01, 12, 20
export type Face = readonly [number, number, number, number, number, number]

// Fixes the chosen DOFs of each node to the given displacement (0 for a plain support)
export interface Support {
  nodes: readonly number[]
  fix: readonly [boolean, boolean, boolean]
  displacement?: readonly [number, number, number]
}

export type Load =
  | { kind: 'nodalForce'; node: number; force: readonly [number, number, number] }
  // Uniform pressure in Pa; positive pushes into the surface
  | { kind: 'pressure'; faces: readonly Face[]; pressure: number }
  // Total force in N, spread as a uniform traction over the faces' area
  | { kind: 'faceForce'; faces: readonly Face[]; force: readonly [number, number, number] }

export interface StaticModel {
  mesh: Mesh
  material: Material
  supports: readonly Support[]
  loads: readonly Load[]
}

export interface StaticResult {
  // ux, uy, uz per node
  displacement: Float64Array
  // sxx, syy, szz, sxy, syz, szx per node, averaged across elements
  stress: Float64Array
  vonMises: Float64Array
  // s1 >= s2 >= s3 per node
  principal: Float64Array
  // Reaction force per DOF; zero on unsupported DOFs
  reaction: Float64Array
  // Yield strength over the largest nodal von Mises stress
  minFactorOfSafety: number
  solverIterations: number
}
