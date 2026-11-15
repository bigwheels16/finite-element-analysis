import type { Action, Restraint } from '../analysis/types'
import type { Feature, GeoFace, Solid } from '../geometry/types'

let counter = 0
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}${Date.now().toString(36)}${counter}`
}

export const DEFAULT_FEATURES: Feature[] = [
  {
    id: 'base',
    name: 'Base plate',
    plane: 'XY',
    offset: 0,
    depth: 10,
    operation: 'add',
    shapes: [
      { kind: 'rect', x: 0, y: 0, w: 120, h: 40, hole: false },
      { kind: 'circle', cx: 95, cy: 20, r: 8, hole: true },
    ],
  },
]

export function boundingBox(vertices: Float64Array): { min: number[]; max: number[]; size: number } {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity]
  for (let i = 0; i < vertices.length; i++) {
    min[i % 3] = Math.min(min[i % 3], vertices[i])
    max[i % 3] = Math.max(max[i % 3], vertices[i])
  }
  return { min, max, size: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) }
}

// Finds each old face in the rebuilt solid by its normal, centroid and area; unmatched faces are dropped
export function remapFaces(oldFaces: readonly GeoFace[], solid: Solid, ids: readonly number[]): { ids: number[]; lost: number } {
  const size = boundingBox(solid.vertices).size
  const out: number[] = []
  let lost = 0
  for (const id of ids) {
    const old = oldFaces[id]
    const match = old && solid.faces.find((f) => {
      const sameNormal = old.normal === null ? f.normal === null : f.normal !== null && f.normal.every((c, i) => Math.abs(c - old.normal![i]) < 1e-6)
      const near = Math.hypot(f.centroid[0] - old.centroid[0], f.centroid[1] - old.centroid[1], f.centroid[2] - old.centroid[2]) < 1e-4 * size
      return sameNormal && near && Math.abs(f.area - old.area) <= 1e-3 * old.area
    })
    if (match) out.push(match.id)
    else lost++
  }
  return { ids: out, lost }
}

export function remapSetup(
  oldFaces: readonly GeoFace[],
  solid: Solid,
  restraints: Restraint[],
  actions: Action[],
): { restraints: Restraint[]; actions: Action[]; lost: number } {
  let lost = 0
  const remap = <T extends { faces: number[] }>(item: T): T => {
    const r = remapFaces(oldFaces, solid, item.faces)
    lost += r.lost
    return { ...item, faces: r.ids }
  }
  return {
    restraints: restraints.map(remap),
    actions: actions.map((a) => (a.kind === 'point' ? a : remap(a))),
    lost,
  }
}

// Initial support and load for the default part: fixed at x = 0, pushed down on the far end
export function defaultSetup(solid: Solid): { restraints: Restraint[]; actions: Action[] } {
  const along = (axis: number, sign: number) =>
    solid.faces.filter((f) => f.normal !== null && f.normal[axis] * sign > 0.999).sort((a, b) => sign * (b.centroid[axis] - a.centroid[axis]))[0]
  const left = along(0, -1), right = along(0, 1)
  return {
    restraints: left ? [{ id: newId('r'), kind: 'fixed', faces: [left.id] }] : [],
    actions: right ? [{ id: newId('a'), kind: 'force', faces: [right.id], force: [0, 0, -1000] }] : [],
  }
}
