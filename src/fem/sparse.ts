// Symmetric matrix in compressed sparse row form, one row per DOF
export interface Csr {
  n: number
  rowPtr: Int32Array
  cols: Int32Array
  values: Float64Array
}

// Sparsity pattern for 3 DOFs per node, from element connectivity; also returns per-node sorted neighbours
export function buildPattern(nodeCount: number, conn: Uint32Array, nodesPerElement: number): { csr: Csr; neighbours: Int32Array[] } {
  const sets: Set<number>[] = Array.from({ length: nodeCount }, () => new Set<number>())
  for (let e = 0; e < conn.length; e += nodesPerElement) {
    for (let a = 0; a < nodesPerElement; a++) {
      const s = sets[conn[e + a]]
      for (let b = 0; b < nodesPerElement; b++) s.add(conn[e + b])
    }
  }
  const neighbours = sets.map((s) => Int32Array.from(s).sort())
  const n = 3 * nodeCount
  const rowPtr = new Int32Array(n + 1)
  for (let node = 0; node < nodeCount; node++) {
    const len = 3 * neighbours[node].length
    for (let i = 0; i < 3; i++) rowPtr[3 * node + i + 1] = len
  }
  for (let r = 0; r < n; r++) rowPtr[r + 1] += rowPtr[r]
  const cols = new Int32Array(rowPtr[n])
  for (let node = 0; node < nodeCount; node++) {
    const nb = neighbours[node]
    for (let i = 0; i < 3; i++) {
      let p = rowPtr[3 * node + i]
      for (let k = 0; k < nb.length; k++) {
        cols[p++] = 3 * nb[k]
        cols[p++] = 3 * nb[k] + 1
        cols[p++] = 3 * nb[k] + 2
      }
    }
  }
  return { csr: { n, rowPtr, cols, values: new Float64Array(cols.length) }, neighbours }
}

// Position of neighbour node m within node n's sorted neighbour list
export function neighbourIndex(neighbours: Int32Array, m: number): number {
  let lo = 0, hi = neighbours.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const v = neighbours[mid]
    if (v === m) return mid
    if (v < m) lo = mid + 1
    else hi = mid - 1
  }
  throw new Error(`Node ${m} is not in the sparsity pattern`)
}

export function multiply(A: Csr, x: Float64Array, out: Float64Array): void {
  const { n, rowPtr, cols, values } = A
  for (let r = 0; r < n; r++) {
    let s = 0
    for (let p = rowPtr[r]; p < rowPtr[r + 1]; p++) s += values[p] * x[cols[p]]
    out[r] = s
  }
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i] * b[i]
  return s
}

// Incomplete Cholesky factor L (lower triangle, diagonal last in each row) on the lower pattern of A
interface IncompleteCholesky {
  rowPtr: Int32Array
  cols: Int32Array
  values: Float64Array
}

// IC(0) of A + shift * diag(A); returns null if a pivot is not positive
function factorIc0(A: Csr, shift: number): IncompleteCholesky | null {
  const { n, rowPtr, cols, values } = A
  const lPtr = new Int32Array(n + 1)
  for (let r = 0; r < n; r++) {
    let count = 0
    for (let p = rowPtr[r]; p < rowPtr[r + 1]; p++) if (cols[p] <= r) count++
    lPtr[r + 1] = lPtr[r] + count
  }
  const lCols = new Int32Array(lPtr[n])
  const lVals = new Float64Array(lPtr[n])
  for (let r = 0; r < n; r++) {
    let q = lPtr[r]
    for (let p = rowPtr[r]; p < rowPtr[r + 1]; p++) {
      if (cols[p] > r) continue
      lCols[q] = cols[p]
      lVals[q++] = cols[p] === r ? values[p] * (1 + shift) : values[p]
    }
  }
  for (let i = 0; i < n; i++) {
    const iStart = lPtr[i], iEnd = lPtr[i + 1] - 1
    for (let q = iStart; q < iEnd; q++) {
      const k = lCols[q]
      // Dot product of rows i and k over columns before k
      let s = lVals[q]
      let a = iStart, b = lPtr[k]
      const bEnd = lPtr[k + 1] - 1
      while (a < q && b < bEnd) {
        const ca = lCols[a], cb = lCols[b]
        if (ca === cb) s -= lVals[a++] * lVals[b++]
        else if (ca < cb) a++
        else b++
      }
      lVals[q] = s / lVals[bEnd]
    }
    let d = lVals[iEnd]
    for (let q = iStart; q < iEnd; q++) d -= lVals[q] * lVals[q]
    if (!(d > 0)) return null
    lVals[iEnd] = Math.sqrt(d)
  }
  return { rowPtr: lPtr, cols: lCols, values: lVals }
}

// z = (L L^T)^-1 r
function applyIc(L: IncompleteCholesky, r: Float64Array, z: Float64Array): void {
  const { rowPtr, cols, values } = L
  const n = r.length
  for (let i = 0; i < n; i++) {
    let s = r[i]
    const end = rowPtr[i + 1] - 1
    for (let q = rowPtr[i]; q < end; q++) s -= values[q] * z[cols[q]]
    z[i] = s / values[end]
  }
  for (let i = n - 1; i >= 0; i--) {
    const end = rowPtr[i + 1] - 1
    const x = z[i] / values[end]
    z[i] = x
    for (let q = rowPtr[i]; q < end; q++) z[cols[q]] -= values[q] * x
  }
}

// Incomplete-Cholesky-preconditioned conjugate gradient; throws if it does not converge
export function solveCg(A: Csr, b: Float64Array, tolerance = 1e-8, maxIterations = 10 * A.n): { x: Float64Array; iterations: number } {
  const { n, rowPtr, cols, values } = A
  for (let r = 0; r < n; r++) {
    let diag = 0
    for (let p = rowPtr[r]; p < rowPtr[r + 1]; p++) if (cols[p] === r) diag = values[p]
    if (!(diag > 0)) throw new Error(`Stiffness matrix has a non-positive diagonal at DOF ${r}`)
  }
  // Shift the diagonal until the incomplete factorization succeeds
  let L: IncompleteCholesky | null = null
  for (let shift = 0; L === null; shift = shift === 0 ? 1e-4 : shift * 4) {
    if (shift > 1) throw new Error('Could not build the solver preconditioner; the model is probably under-constrained')
    L = factorIc0(A, shift)
  }
  const x = new Float64Array(n)
  const r = Float64Array.from(b)
  const z = new Float64Array(n)
  const p = new Float64Array(n)
  const q = new Float64Array(n)
  const bNorm = Math.sqrt(dot(b, b))
  if (bNorm === 0) return { x, iterations: 0 }
  applyIc(L, r, z)
  p.set(z)
  let rz = dot(r, z)
  for (let it = 1; it <= maxIterations; it++) {
    multiply(A, p, q)
    const pq = dot(p, q)
    if (!(pq > 0)) throw new Error('Stiffness matrix is not positive definite; the model is probably under-constrained')
    const alpha = rz / pq
    for (let i = 0; i < n; i++) {
      x[i] += alpha * p[i]
      r[i] -= alpha * q[i]
    }
    if (Math.sqrt(dot(r, r)) <= tolerance * bNorm) return { x, iterations: it }
    applyIc(L, r, z)
    const rzNew = dot(r, z)
    const beta = rzNew / rz
    rz = rzNew
    for (let i = 0; i < n; i++) p[i] = z[i] + beta * p[i]
  }
  throw new Error(`Solver did not converge in ${maxIterations} iterations; the model is probably under-constrained`)
}

// Reverse Cuthill-McKee node order from per-node neighbour lists; order[newIndex] = oldIndex
export function reverseCuthillMcKee(neighbours: readonly Int32Array[]): Int32Array {
  const n = neighbours.length
  const order = new Int32Array(n)
  const visited = new Uint8Array(n)
  let head = 0, tail = 0
  while (tail < n) {
    // Start each component from its lowest-degree unvisited node
    let start = -1
    for (let i = 0; i < n; i++) {
      if (!visited[i] && (start < 0 || neighbours[i].length < neighbours[start].length)) start = i
    }
    visited[start] = 1
    order[tail++] = start
    while (head < tail) {
      const node = order[head++]
      const next = Array.from(neighbours[node]).filter((m) => !visited[m])
      next.sort((a, b) => neighbours[a].length - neighbours[b].length)
      for (const m of next) {
        visited[m] = 1
        order[tail++] = m
      }
    }
  }
  return order.reverse()
}
