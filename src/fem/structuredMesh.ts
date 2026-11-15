import { addMidsideNodes, orientPositive } from './quadratic'
import type { Mesh } from './types'

// Box [0,lx]x[0,ly]x[0,lz] split into nx*ny*nz cubes of six tets each, with midside nodes added
export function boxMesh(lx: number, ly: number, lz: number, nx: number, ny: number, nz: number): Mesh {
  const coords: number[] = []
  const id = (i: number, j: number, k: number) => i + (nx + 1) * (j + (ny + 1) * k)
  for (let k = 0; k <= nz; k++)
    for (let j = 0; j <= ny; j++)
      for (let i = 0; i <= nx; i++) coords.push((lx * i) / nx, (ly * j) / ny, (lz * k) / nz)

  // Kuhn subdivision: one tet per axis ordering, all sharing the cube's main diagonal, so neighbours conform
  const orders = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]]
  const corners: number[] = []
  for (let k = 0; k < nz; k++)
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        for (const order of orders) {
          const step = [0, 0, 0]
          const tet = [id(i, j, k)]
          for (const axis of order) {
            step[axis] = 1
            tet.push(id(i + step[0], j + step[1], k + step[2]))
          }
          corners.push(...orientPositive(coords, tet))
        }
  return addMidsideNodes(coords, corners)
}
