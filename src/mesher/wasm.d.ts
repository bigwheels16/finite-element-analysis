// Emscripten-generated TetGen module, built by scripts/build-tetgen.sh
declare module '*/wasm/tetgen.mjs' {
  export interface TetgenModule {
    HEAPF64: Float64Array
    HEAP32: Int32Array
    _malloc(bytes: number): number
    _free(ptr: number): void
    stringToNewUTF8(s: string): number
    _tg_tetrahedralize(switches: number, pointCount: number, points: number, triangleCount: number, triangles: number, markers: number): number
    _tg_point_count(): number
    _tg_points(): number
    _tg_tet_count(): number
    _tg_corners_per_tet(): number
    _tg_tets(): number
    _tg_face_count(): number
    _tg_faces(): number
    _tg_face_markers(): number
  }
  export default function createModule(options?: { wasmBinary?: ArrayBuffer | Uint8Array; locateFile?: (path: string) => string }): Promise<TetgenModule>
}
