import createModule, { type TetgenModule } from './wasm/tetgen.mjs'

export interface Surface {
  // x, y, z per vertex
  vertices: Float64Array
  // 3 vertex indices per triangle, counter-clockwise seen from outside
  triangles: Uint32Array
  // Geometric face each triangle belongs to
  faceIds: Int32Array
}

export interface LinearTetMesh {
  points: Float64Array
  // 4 corners per tet
  tets: Uint32Array
  // 3 corners per boundary triangle, with the face id it came from
  faces: Uint32Array
  faceIds: Int32Array
}

const ERRORS: Record<number, string> = {
  1: 'out of memory',
  2: 'internal mesher error',
  3: 'the surface intersects itself',
  4: 'a feature is too small for the mesher tolerance',
  5: 'two faces are too close together',
  10: 'invalid input surface',
  200: 'the boundary would need extra points',
}

export type TetgenLoadOptions = Parameters<typeof createModule>[0]

export class Tetgen {
  private readonly module: TetgenModule

  private constructor(module: TetgenModule) {
    this.module = module
  }

  static async load(options?: TetgenLoadOptions): Promise<Tetgen> {
    return new Tetgen(await createModule(options))
  }

  // Runs TetGen with the given command-line switches on a closed surface
  tetrahedralize(surface: Surface, switches: string): LinearTetMesh {
    const m = this.module
    const pointCount = surface.vertices.length / 3
    const triangleCount = surface.triangles.length / 3
    if (surface.faceIds.length !== triangleCount) throw new Error('Surface needs one face id per triangle')
    const allocated: number[] = []
    const alloc = (bytes: number) => {
      const p = m._malloc(bytes)
      if (p === 0) throw new Error('Out of memory allocating mesher input')
      allocated.push(p)
      return p
    }
    try {
      const sw = m.stringToNewUTF8(switches)
      allocated.push(sw)
      const pts = alloc(8 * surface.vertices.length)
      const tris = alloc(4 * surface.triangles.length)
      const marks = alloc(4 * triangleCount)
      m.HEAPF64.set(surface.vertices, pts / 8)
      m.HEAP32.set(surface.triangles, tris / 4)
      m.HEAP32.set(surface.faceIds, marks / 4)
      const code = m._tg_tetrahedralize(sw, pointCount, pts, triangleCount, tris, marks)
      if (code !== 0) throw new Error(`Meshing failed: ${ERRORS[code] ?? `TetGen error ${code}`}`)
      if (m._tg_corners_per_tet() !== 4) throw new Error('Mesher returned non-linear tetrahedra')
      if (m._tg_face_count() > 0 && m._tg_face_markers() === 0) throw new Error('Mesher returned boundary faces without face ids')
      // Copy out before anything else can grow (and so detach) the heap
      const np = m._tg_point_count(), nt = m._tg_tet_count(), nf = m._tg_face_count()
      return {
        points: m.HEAPF64.slice(m._tg_points() / 8, m._tg_points() / 8 + 3 * np),
        tets: Uint32Array.from(m.HEAP32.subarray(m._tg_tets() / 4, m._tg_tets() / 4 + 4 * nt)),
        faces: Uint32Array.from(m.HEAP32.subarray(m._tg_faces() / 4, m._tg_faces() / 4 + 3 * nf)),
        faceIds: Int32Array.from(m.HEAP32.subarray(m._tg_face_markers() / 4, m._tg_face_markers() / 4 + nf)),
      }
    } finally {
      for (const p of allocated) m._free(p)
    }
  }
}
