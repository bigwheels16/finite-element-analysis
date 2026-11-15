# Finite Element Analysis

A browser-based linear static FEA tool for solid parts: sketch and extrude geometry, mesh it with
quadratic tetrahedra, apply supports and loads, solve, and review displacements, stresses and the
factor of safety. Everything runs in the browser. Units are mm, N and MPa.

**Demonstration only.** Results are not verified for design use.

## How it works

| Stage | Where | What |
|---|---|---|
| Geometry | `src/geometry` | Sketches (rectangles, circles, polygons) extruded on the XY, XZ or YZ plane, added or cut with [Manifold](https://github.com/elalish/manifold); triangles grouped into selectable faces |
| Mesh | `src/mesher` | [TetGen](https://wias-berlin.de/software/tetgen/) compiled to WebAssembly; linear tets upgraded to 10-node tets, boundary faces keep their face ids |
| Solve | `src/fem` | TET10 stiffness, sparse assembly, reverse Cuthill-McKee ordering, incomplete-Cholesky-preconditioned conjugate gradient |
| Results | `src/analysis`, `src/ui` | Nodal von Mises and principal stresses, displacement, reactions, factor of safety against yield |

Geometry, meshing and solving run in a Web Worker (`src/worker`).

## Verification

`npm test` runs the suite, which is also the deploy gate:

- Element: symmetry and zero stiffness against rigid-body motion
- Patch tests on structured and TetGen meshes: linear displacement fields and uniform stress reproduced exactly
- Load and reaction equilibrium; under-constrained models rejected
- Cantilever against Timoshenko beam theory (tip deflection and bending stress within 2% and 5%)
- Thick-walled cylinder under internal pressure against Lamé (hoop stress and bore displacement within 1%)
- Plate with a hole in tension against Heywood's stress concentration (peak stress within 3%)

## Development

The mesher is compiled from TetGen's source, fetched at a pinned version and checked against its
SHA-256. It needs [Emscripten](https://emscripten.org/) on the PATH:

```sh
./scripts/build-tetgen.sh   # writes src/mesher/wasm/
npm install
npm run dev                 # http://localhost:5173
npm run lint
npm test
VITE_SOURCE_URL=<repository URL> npm run build
```

On Windows, `run_local.bat` builds the mesher and runs the dev server in Docker with live reload.

## License

GNU Affero General Public License v3.0 or later; see [LICENSE](LICENSE). TetGen is AGPL-3.0,
Manifold is Apache-2.0 and three.js is MIT. Release builds require `VITE_SOURCE_URL` so the page
links to its source.

