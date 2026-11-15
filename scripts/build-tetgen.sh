#!/usr/bin/env bash
# Downloads TetGen at a pinned version, checks its hash, and compiles it with the wrapper to WebAssembly
set -euo pipefail

TETGEN_URL="https://wias-berlin.de/software/tetgen/1.5/src/tetgen1.6.0.tar.gz"
TETGEN_SHA256="87b5e61ebd3a471fc4f2cdd7124c2b11dd6639f4feb1f941a5d2f5110d05ce39"

root="$(cd "$(dirname "$0")/.." && pwd)"
out="$root/src/mesher/wasm"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

curl -sSfL -o "$work/tetgen.tar.gz" "$TETGEN_URL"
echo "$TETGEN_SHA256  $work/tetgen.tar.gz" | sha256sum -c -
tar -xzf "$work/tetgen.tar.gz" -C "$work"
src="$work/tetgen1.6.0"

mkdir -p "$out"
# TETLIBRARY makes TetGen throw an error code instead of exiting the process
em++ -O2 -DTETLIBRARY -fwasm-exceptions -I"$src" \
  "$src/tetgen.cxx" "$src/predicates.cxx" "$root/src/mesher/tetgen_wrapper.cpp" \
  -o "$out/tetgen.mjs" \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=worker,node \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=1gb -sSTACK_SIZE=4mb \
  -sEXPORTED_FUNCTIONS=_malloc,_free,_tg_tetrahedralize,_tg_point_count,_tg_points,_tg_tet_count,_tg_corners_per_tet,_tg_tets,_tg_face_count,_tg_faces,_tg_face_markers \
  -sEXPORTED_RUNTIME_METHODS=HEAPF64,HEAP32,stringToNewUTF8
echo "Built $out/tetgen.mjs and $out/tetgen.wasm"
