import type { CrossSection, Manifold, ManifoldToplevel, Mat4 } from 'manifold-3d'
import type { Feature, GeoFace, Shape, Solid, SketchPlane } from './types'

// Sketch (u, v, w) to world axes for each plane; all are proper rotations
const PLANE_AXES: Record<SketchPlane, [number[], number[], number[]]> = {
  XY: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  XZ: [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
  YZ: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
}

export function planeNormal(plane: SketchPlane): [number, number, number] {
  const [x, y, z] = PLANE_AXES[plane][2]
  return [x, y, z]
}

// Sketch-plane point at height w to world coordinates
export function planeToWorld(plane: SketchPlane, u: number, v: number, w: number): [number, number, number] {
  const [a, b, c] = PLANE_AXES[plane]
  return [0, 1, 2].map((i) => a[i] * u + b[i] * v + c[i] * w) as [number, number, number]
}

function planeTransform(plane: SketchPlane, offset: number): Mat4 {
  const [a, b, c] = PLANE_AXES[plane]
  return [a[0], a[1], a[2], 0, b[0], b[1], b[2], 0, c[0], c[1], c[2], 0, c[0] * offset, c[1] * offset, c[2] * offset, 1]
}

// Segments for a circle so its edges are no longer than maxEdge; at least 24 keeps it one smooth face
export function circleSegments(r: number, maxEdge: number): number {
  return Math.max(24, Math.min(96, Math.ceil((2 * Math.PI * r) / maxEdge)))
}

function validateShape(s: Shape, feature: string): void {
  const bad = (msg: string) => new Error(`${feature}: ${msg}`)
  switch (s.kind) {
    case 'rect':
      if (![s.x, s.y, s.w, s.h].every(Number.isFinite) || !(s.w > 0 && s.h > 0)) throw bad('rectangle needs a positive width and height')
      break
    case 'circle':
      if (![s.cx, s.cy, s.r].every(Number.isFinite) || !(s.r > 0)) throw bad('circle needs a positive radius')
      break
    case 'polygon':
      if (s.points.length < 3 || !s.points.flat().every(Number.isFinite)) throw bad('polygon needs at least three points')
      break
  }
}

// Builds the solid from its features; maxEdge (mm) sets how finely circles are faceted
export function buildSolid(wasm: ManifoldToplevel, features: readonly Feature[], maxEdge: number): Solid {
  const { CrossSection } = wasm
  if (features.length === 0) throw new Error('Add a feature to build the part')
  if (features[0].operation !== 'add') throw new Error('The first feature must add material')
  const owned: { delete(): void }[] = []
  const own = <T extends { delete(): void }>(x: T): T => {
    owned.push(x)
    return x
  }
  try {
    let solid: Manifold | null = null
    for (const f of features) {
      if (!(f.depth > 0) || !Number.isFinite(f.offset)) throw new Error(`${f.name}: depth must be positive`)
      const solids: CrossSection[] = []
      const holes: CrossSection[] = []
      for (const s of f.shapes) {
        validateShape(s, f.name)
        let cs: CrossSection
        if (s.kind === 'rect') cs = own(own(CrossSection.square([s.w, s.h])).translate([s.x, s.y]))
        else if (s.kind === 'circle') cs = own(own(CrossSection.circle(s.r, circleSegments(s.r, maxEdge))).translate([s.cx, s.cy]))
        else cs = own(new CrossSection([s.points], 'NonZero'))
        ;(s.hole ? holes : solids).push(cs)
      }
      if (solids.length === 0) throw new Error(`${f.name}: sketch has no solid shapes`)
      let section = own(CrossSection.union(solids))
      if (holes.length > 0) section = own(section.subtract(own(CrossSection.union(holes))))
      if (section.isEmpty()) throw new Error(`${f.name}: holes remove the whole sketch`)
      const body = own(own(section.extrude(f.depth)).transform(planeTransform(f.plane, f.offset)))
      if (solid === null) solid = body
      else solid = own(f.operation === 'add' ? solid.add(body) : solid.subtract(body))
    }
    if (solid === null || solid.isEmpty()) throw new Error('The part has no material')
    const status = solid.status()
    if (status !== 'NoError') throw new Error(`Geometry error: ${status}`)
    const mesh = solid.getMesh()
    const vertexCount = mesh.vertProperties.length / mesh.numProp
    const vertices = new Float64Array(3 * vertexCount)
    for (let i = 0; i < vertexCount; i++) {
      for (let c = 0; c < 3; c++) vertices[3 * i + c] = mesh.vertProperties[i * mesh.numProp + c]
    }
    const triangles = Uint32Array.from(mesh.triVerts)
    const { faceIds, faces } = groupFaces(vertices, triangles)
    return { vertices, triangles, faceIds, faces, volume: solid.volume() }
  } finally {
    for (const x of owned) x.delete()
  }
}

// Largest angle between neighbouring triangle normals that still counts as one smooth face
const SMOOTH_ANGLE = (20 * Math.PI) / 180

// Groups triangles into smooth faces by flood fill across shallow edges
export function groupFaces(vertices: Float64Array, triangles: Uint32Array): { faceIds: Int32Array; faces: GeoFace[] } {
  const triCount = triangles.length / 3
  const normals = new Float64Array(3 * triCount)
  const areas = new Float64Array(triCount)
  for (let t = 0; t < triCount; t++) {
    const [a, b, c] = [3 * triangles[3 * t], 3 * triangles[3 * t + 1], 3 * triangles[3 * t + 2]]
    const e1 = [vertices[b] - vertices[a], vertices[b + 1] - vertices[a + 1], vertices[b + 2] - vertices[a + 2]]
    const e2 = [vertices[c] - vertices[a], vertices[c + 1] - vertices[a + 1], vertices[c + 2] - vertices[a + 2]]
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]]
    const len = Math.hypot(n[0], n[1], n[2])
    areas[t] = len / 2
    for (let i = 0; i < 3; i++) normals[3 * t + i] = len > 0 ? n[i] / len : 0
  }
  const edgeTris = new Map<string, number[]>()
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const a = triangles[3 * t + k], b = triangles[3 * t + ((k + 1) % 3)]
      const key = a < b ? `${a},${b}` : `${b},${a}`
      const list = edgeTris.get(key)
      if (list) list.push(t)
      else edgeTris.set(key, [t])
    }
  }
  const cosLimit = Math.cos(SMOOTH_ANGLE)
  const faceIds = new Int32Array(triCount).fill(-1)
  const faces: GeoFace[] = []
  for (let seed = 0; seed < triCount; seed++) {
    if (faceIds[seed] !== -1) continue
    const id = faces.length
    const stack = [seed]
    faceIds[seed] = id
    let area = 0
    const centroid = [0, 0, 0]
    let flat = true
    while (stack.length > 0) {
      const t = stack.pop()!
      area += areas[t]
      for (let k = 0; k < 3; k++) {
        const p = 3 * triangles[3 * t + k]
        for (let c = 0; c < 3; c++) centroid[c] += (areas[t] * vertices[p + c]) / 3
      }
      const dotSeed = normals[3 * t] * normals[3 * seed] + normals[3 * t + 1] * normals[3 * seed + 1] + normals[3 * t + 2] * normals[3 * seed + 2]
      if (dotSeed < 1 - 1e-9) flat = false
      for (let k = 0; k < 3; k++) {
        const a = triangles[3 * t + k], b = triangles[3 * t + ((k + 1) % 3)]
        for (const u of edgeTris.get(a < b ? `${a},${b}` : `${b},${a}`)!) {
          if (faceIds[u] !== -1) continue
          const dot = normals[3 * t] * normals[3 * u] + normals[3 * t + 1] * normals[3 * u + 1] + normals[3 * t + 2] * normals[3 * u + 2]
          if (dot >= cosLimit) {
            faceIds[u] = id
            stack.push(u)
          }
        }
      }
    }
    faces.push({
      id,
      area,
      centroid: [centroid[0] / area, centroid[1] / area, centroid[2] / area],
      normal: flat ? [normals[3 * seed], normals[3 * seed + 1], normals[3 * seed + 2]] : null,
    })
  }
  return { faceIds, faces }
}
