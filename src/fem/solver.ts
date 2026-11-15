import { faceArea, integrateFace } from './faces'
import { buildPattern, multiply, neighbourIndex, reverseCuthillMcKee, solveCg } from './sparse'
import { TET10_NODE_COORDS, cartesianDerivatives, elasticity, elementStiffness, stressAt } from './tet10'
import type { Face, Load, StaticModel, StaticResult } from './types'

function validate(model: StaticModel): void {
  const { mesh, material, supports } = model
  const nodeCount = mesh.nodes.length / 3
  if (!Number.isInteger(nodeCount) || mesh.tets.length === 0 || mesh.tets.length % 10 !== 0) {
    throw new Error('Mesh must have x, y, z per node and 10 nodes per element')
  }
  for (const n of mesh.tets) if (n >= nodeCount) throw new Error(`Element refers to missing node ${n}`)
  const { youngsModulus: E, poissonsRatio: nu, yieldStrength } = material
  if (!(E > 0)) throw new Error("Young's modulus must be positive")
  if (!(nu > -1 && nu < 0.5)) throw new Error("Poisson's ratio must be between -1 and 0.5")
  if (!(yieldStrength > 0)) throw new Error('Yield strength must be positive')
  if (!supports.some((s) => s.nodes.length > 0 && s.fix.some(Boolean))) {
    throw new Error('Model has no supports')
  }
}

function addFaceTraction(nodes: Float64Array, faces: readonly Face[], f: Float64Array, traction: (area: [number, number, number]) => [number, number, number]): void {
  for (const face of faces) {
    integrateFace(nodes, face, ({ N, areaVector }) => {
      const t = traction(areaVector)
      for (let k = 0; k < 6; k++) {
        const p = 3 * face[k]
        f[p] += N[k] * t[0]
        f[p + 1] += N[k] * t[1]
        f[p + 2] += N[k] * t[2]
      }
    })
  }
}

// Consistent nodal force vector
export function loadVector(nodes: Float64Array, loads: readonly Load[]): Float64Array {
  const f = new Float64Array(nodes.length)
  for (const load of loads) {
    switch (load.kind) {
      case 'nodalForce':
        for (let c = 0; c < 3; c++) f[3 * load.node + c] += load.force[c]
        break
      case 'pressure':
        addFaceTraction(nodes, load.faces, f, ([x, y, z]) => [-load.pressure * x, -load.pressure * y, -load.pressure * z])
        break
      case 'faceForce': {
        const area = faceArea(nodes, load.faces)
        if (!(area > 0)) throw new Error('Face force applied to faces with no area')
        const [fx, fy, fz] = load.force
        addFaceTraction(nodes, load.faces, f, ([x, y, z]) => {
          const dA = Math.hypot(x, y, z) / area
          return [fx * dA, fy * dA, fz * dA]
        })
        break
      }
    }
  }
  return f
}

// Principal stresses of a symmetric tensor, largest first
export function principalStresses(s: ArrayLike<number>, offset: number, out: Float64Array, outOffset: number): void {
  const [xx, yy, zz, xy, yz, zx] = [s[offset], s[offset + 1], s[offset + 2], s[offset + 3], s[offset + 4], s[offset + 5]]
  const p1 = xy * xy + yz * yz + zx * zx
  const mean = (xx + yy + zz) / 3
  const a = xx - mean, b = yy - mean, c = zz - mean
  const p2 = a * a + b * b + c * c + 2 * p1
  const scale = Math.max(Math.abs(xx), Math.abs(yy), Math.abs(zz), Math.abs(xy), Math.abs(yz), Math.abs(zx))
  if (p2 <= (1e-12 * scale) ** 2) {
    out[outOffset] = out[outOffset + 1] = out[outOffset + 2] = mean
    return
  }
  const p = Math.sqrt(p2 / 6)
  // det((S - mean I) / p) / 2, clamped against rounding
  const det = a * (b * c - yz * yz) - xy * (xy * c - yz * zx) + zx * (xy * yz - b * zx)
  const r = Math.max(-1, Math.min(1, det / (2 * p * p * p)))
  const phi = Math.acos(r) / 3
  const s1 = mean + 2 * p * Math.cos(phi)
  const s3 = mean + 2 * p * Math.cos(phi + (2 * Math.PI) / 3)
  out[outOffset] = s1
  out[outOffset + 1] = 3 * mean - s1 - s3
  out[outOffset + 2] = s3
}

function solveOrdered(model: StaticModel): StaticResult {
  const { mesh, material, supports, loads } = model
  const { nodes, tets } = mesh
  const nodeCount = nodes.length / 3
  const D = elasticity(material.youngsModulus, material.poissonsRatio)

  // Assemble the global stiffness matrix
  const { csr: K, neighbours } = buildPattern(nodeCount, tets, 10)
  const conn = new Uint32Array(10)
  for (let e = 0; e < tets.length; e += 10) {
    for (let a = 0; a < 10; a++) conn[a] = tets[e + a]
    const Ke = elementStiffness(nodes, conn, D)
    for (let a = 0; a < 10; a++) {
      const na = conn[a]
      for (let b = 0; b < 10; b++) {
        const block = 3 * neighbourIndex(neighbours[na], conn[b])
        for (let i = 0; i < 3; i++) {
          const rowStart = K.rowPtr[3 * na + i] + block
          for (let j = 0; j < 3; j++) K.values[rowStart + j] += Ke[(3 * a + i) * 30 + 3 * b + j]
        }
      }
    }
  }
  const original = Float64Array.from(K.values)

  // Prescribed DOFs, eliminated symmetrically
  const fixed = new Uint8Array(K.n)
  const prescribed = new Float64Array(K.n)
  for (const s of supports) {
    for (const node of s.nodes) {
      for (let c = 0; c < 3; c++) {
        if (!s.fix[c]) continue
        fixed[3 * node + c] = 1
        prescribed[3 * node + c] = s.displacement?.[c] ?? 0
      }
    }
  }
  const fExternal = loadVector(nodes, loads)
  const rhs = Float64Array.from(fExternal)
  for (let r = 0; r < K.n; r++) {
    for (let p = K.rowPtr[r]; p < K.rowPtr[r + 1]; p++) {
      const c = K.cols[p]
      if (fixed[r]) {
        K.values[p] = c === r ? 1 : 0
      } else if (fixed[c]) {
        rhs[r] -= K.values[p] * prescribed[c]
        K.values[p] = 0
      }
    }
    if (fixed[r]) rhs[r] = prescribed[r]
  }

  const { x: u, iterations } = solveCg(K, rhs)

  // Reactions from the unmodified matrix
  K.values.set(original)
  const ku = new Float64Array(K.n)
  multiply(K, u, ku)
  const reaction = new Float64Array(K.n)
  for (let r = 0; r < K.n; r++) if (fixed[r]) reaction[r] = ku[r] - fExternal[r]

  // Stresses at element nodes, averaged per node
  const stress = new Float64Array(6 * nodeCount)
  const count = new Uint32Array(nodeCount)
  const ue = new Float64Array(30)
  const dN = new Float64Array(30)
  const dNdx = new Float64Array(30)
  const local = new Float64Array(6)
  for (let e = 0; e < tets.length; e += 10) {
    for (let a = 0; a < 10; a++) {
      conn[a] = tets[e + a]
      for (let c = 0; c < 3; c++) ue[3 * a + c] = u[3 * conn[a] + c]
    }
    for (let a = 0; a < 10; a++) {
      const [xi, eta, zeta] = TET10_NODE_COORDS[a]
      cartesianDerivatives(nodes, conn, xi, eta, zeta, dN, dNdx)
      stressAt(dNdx, ue, D, local, 0)
      const n = conn[a]
      for (let i = 0; i < 6; i++) stress[6 * n + i] += local[i]
      count[n]++
    }
  }
  const vonMises = new Float64Array(nodeCount)
  const principal = new Float64Array(3 * nodeCount)
  let maxVonMises = 0
  for (let n = 0; n < nodeCount; n++) {
    if (count[n] === 0) continue
    for (let i = 0; i < 6; i++) stress[6 * n + i] /= count[n]
    const [xx, yy, zz, xy, yz, zx] = stress.subarray(6 * n, 6 * n + 6)
    const vm = Math.sqrt(0.5 * ((xx - yy) ** 2 + (yy - zz) ** 2 + (zz - xx) ** 2) + 3 * (xy * xy + yz * yz + zx * zx))
    vonMises[n] = vm
    if (vm > maxVonMises) maxVonMises = vm
    principalStresses(stress, 6 * n, principal, 3 * n)
  }

  return {
    displacement: u,
    stress,
    vonMises,
    principal,
    reaction,
    minFactorOfSafety: maxVonMises > 0 ? material.yieldStrength / maxVonMises : Infinity,
    solverIterations: iterations,
  }
}

// Renumbers nodes for a compact matrix profile, solves, and maps results back to the caller's numbering
export function solveStatic(model: StaticModel): StaticResult {
  validate(model)
  const { mesh } = model
  const nodeCount = mesh.nodes.length / 3
  const { neighbours } = buildPattern(nodeCount, mesh.tets, 10)
  const order = reverseCuthillMcKee(neighbours)
  const newIndex = new Int32Array(nodeCount)
  order.forEach((old, i) => (newIndex[old] = i))
  const map = (n: number) => newIndex[n]
  const nodes = new Float64Array(mesh.nodes.length)
  order.forEach((old, i) => nodes.set(mesh.nodes.subarray(3 * old, 3 * old + 3), 3 * i))
  const tets = mesh.tets.map(map)
  const mapFaces = (faces: readonly Face[]) => faces.map((f) => f.map(map) as unknown as Face)
  const r = solveOrdered({
    ...model,
    mesh: { nodes, tets },
    supports: model.supports.map((s) => ({ ...s, nodes: s.nodes.map(map) })),
    loads: model.loads.map((l): Load => (l.kind === 'nodalForce' ? { ...l, node: map(l.node) } : { ...l, faces: mapFaces(l.faces) })),
  })
  const back = (values: Float64Array, width: number) => {
    const out = new Float64Array(values.length)
    for (let old = 0; old < nodeCount; old++) out.set(values.subarray(width * newIndex[old], width * newIndex[old] + width), width * old)
    return out
  }
  return {
    ...r,
    displacement: back(r.displacement, 3),
    stress: back(r.stress, 6),
    vonMises: back(r.vonMises, 1),
    principal: back(r.principal, 3),
    reaction: back(r.reaction, 3),
  }
}
