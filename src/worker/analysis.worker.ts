/// <reference lib="webworker" />
import Manifold, { type ManifoldToplevel } from 'manifold-3d'
import manifoldWasmUrl from 'manifold-3d/manifold.wasm?url'
import { analyze, meshSolid, summarizeMesh } from '../analysis/pipeline'
import { buildSolid } from '../geometry/build'
import type { Solid } from '../geometry/types'
import type { SolidMesh } from '../mesher/meshSurface'
import { Tetgen } from '../mesher/tetgen'
import tetgenWasmUrl from '../mesher/wasm/tetgen.wasm?url'
import type { Envelope, Request, Response } from './protocol'

let manifold: Promise<ManifoldToplevel> | null = null
let tetgen: Promise<Tetgen> | null = null
let solid: Solid | null = null
let solidMesh: SolidMesh | null = null

function loadManifold(): Promise<ManifoldToplevel> {
  manifold ??= Manifold({ locateFile: () => manifoldWasmUrl }).then((m) => {
    m.setup()
    return m
  })
  return manifold
}

function loadTetgen(): Promise<Tetgen> {
  tetgen ??= Tetgen.load({ locateFile: () => tetgenWasmUrl })
  return tetgen
}

async function handle(req: Request): Promise<Response> {
  switch (req.type) {
    case 'build':
      solidMesh = null
      solid = null
      solid = buildSolid(await loadManifold(), req.features, req.maxEdge)
      return { type: 'build', solid }
    case 'mesh':
      if (!solid) throw new Error('Build the part before meshing')
      solidMesh = null
      solidMesh = meshSolid(await loadTetgen(), solid, req.elementSize)
      return { type: 'mesh', summary: summarizeMesh(solidMesh) }
    case 'solve':
      if (!solid || !solidMesh) throw new Error('Mesh the part before solving')
      return { type: 'solve', result: analyze(solid, solidMesh, req.setup) }
  }
}

self.onmessage = async (event: MessageEvent<{ id: number; request: Request }>) => {
  const { id, request } = event.data
  let reply: Envelope<Response>
  try {
    reply = { id, ok: true, value: await handle(request) }
  } catch (e) {
    // A WebAssembly trap leaves that module unusable, so load fresh copies next time
    if (e instanceof WebAssembly.RuntimeError) {
      manifold = null
      tetgen = null
    }
    reply = { id, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
  self.postMessage(reply)
}
