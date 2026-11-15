import { boundaryFaces } from '../fem/faces'
import { addMidsideNodes, orientPositive } from '../fem/quadratic'
import type { Face, Mesh } from '../fem/types'
import type { Surface, Tetgen } from './tetgen'

export interface MeshOptions {
  // Largest allowed tet volume, in cubic metres
  maxTetVolume: number
  // Refuse to return meshes with more elements than this
  maxElements: number
}

export interface SolidMesh {
  mesh: Mesh
  // Outward boundary faces, with the geometric face id each came from
  faces: Face[]
  faceIds: Int32Array
}

// Enclosed volume of a closed, outward-oriented triangle surface
export function surfaceVolume(surface: Surface): number {
  const { vertices: v, triangles: t } = surface
  let six = 0
  for (let i = 0; i < t.length; i += 3) {
    const a = 3 * t[i], b = 3 * t[i + 1], c = 3 * t[i + 2]
    six +=
      v[a] * (v[b + 1] * v[c + 2] - v[b + 2] * v[c + 1]) -
      v[a + 1] * (v[b] * v[c + 2] - v[b + 2] * v[c]) +
      v[a + 2] * (v[b] * v[c + 1] - v[b + 1] * v[c])
  }
  return six / 6
}

// Quality tetrahedral mesh of a closed surface, as quadratic tets with face ids on the boundary
export function meshSurface(tetgen: Tetgen, surface: Surface, options: MeshOptions): SolidMesh {
  if (!(options.maxTetVolume > 0)) throw new Error('Element size must be positive')
  if (!(surfaceVolume(surface) > 0)) throw new Error('Surface must be closed and enclose a positive volume')
  // p: surface input, q: radius-edge ratio and dihedral bounds, a: volume bound, z: zero-based, Q: quiet
  const linear = tetgen.tetrahedralize(surface, `pq1.5/15a${options.maxTetVolume.toPrecision(6)}zQ`)
  const tetCount = linear.tets.length / 4
  if (tetCount === 0) throw new Error('Meshing produced no elements')
  if (tetCount > options.maxElements) {
    throw new Error(`Mesh has ${tetCount} elements, over the limit of ${options.maxElements}; use a larger element size`)
  }

  const corners = new Uint32Array(linear.tets.length)
  for (let e = 0; e < tetCount; e++) {
    corners.set(orientPositive(linear.points, Array.from(linear.tets.subarray(4 * e, 4 * e + 4))), 4 * e)
  }
  const mesh = addMidsideNodes(linear.points, corners)

  const idByCorners = new Map<string, number>()
  for (let f = 0; f < linear.faceIds.length; f++) {
    idByCorners.set(cornerKey(linear.faces[3 * f], linear.faces[3 * f + 1], linear.faces[3 * f + 2]), linear.faceIds[f])
  }
  const faces = boundaryFaces(mesh)
  const faceIds = new Int32Array(faces.length)
  faces.forEach((face, i) => {
    const id = idByCorners.get(cornerKey(face[0], face[1], face[2]))
    if (id === undefined) throw new Error('Mesher left a boundary face without a face id')
    faceIds[i] = id
  })
  return { mesh, faces, faceIds }
}

function cornerKey(a: number, b: number, c: number): string {
  return [a, b, c].sort((x, y) => x - y).join(',')
}
