import { readFileSync } from 'node:fs'
import { Tetgen } from '../tetgen'

// Loads the WebAssembly mesher from disk for tests
export function loadTetgen(): Promise<Tetgen> {
  return Tetgen.load({ wasmBinary: readFileSync(new URL('../wasm/tetgen.wasm', import.meta.url)) })
}
