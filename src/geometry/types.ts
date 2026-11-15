// Sketch shapes in the sketch plane's (u, v) coordinates, in millimetres
export type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; hole: boolean }
  | { kind: 'circle'; cx: number; cy: number; r: number; hole: boolean }
  | { kind: 'polygon'; points: [number, number][]; hole: boolean }

export type SketchPlane = 'XY' | 'XZ' | 'YZ'

// A sketch extruded along its plane's normal, added to or cut from the solid
export interface Feature {
  id: string
  name: string
  plane: SketchPlane
  // Sketch plane position along its normal, mm
  offset: number
  // Extrusion length along the normal, mm
  depth: number
  operation: 'add' | 'subtract'
  shapes: Shape[]
}

// A selectable geometric face: a smooth patch of the solid's surface
export interface GeoFace {
  id: number
  area: number // mm^2
  centroid: [number, number, number] // mm
  // Unit outward normal if the face is flat
  normal: [number, number, number] | null
}

export interface Solid {
  // x, y, z per vertex, mm
  vertices: Float64Array
  // 3 vertex indices per triangle, counter-clockwise seen from outside
  triangles: Uint32Array
  // Face id of each triangle
  faceIds: Int32Array
  faces: GeoFace[]
  volume: number // mm^3
}
