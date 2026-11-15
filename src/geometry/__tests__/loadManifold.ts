import { readFileSync } from 'node:fs'
import Module, { type ManifoldToplevel } from 'manifold-3d'

// Loads the geometry kernel from disk for tests
export async function loadManifold(): Promise<ManifoldToplevel> {
  const wasmBinary = readFileSync(new URL('../../../node_modules/manifold-3d/manifold.wasm', import.meta.url))
  // The published typings omit Emscripten's wasmBinary option
  const wasm = await Module({ wasmBinary } as unknown as Parameters<typeof Module>[0])
  wasm.setup()
  return wasm
}
