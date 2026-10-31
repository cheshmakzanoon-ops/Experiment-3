#!/usr/bin/env bash
# Build the original codec with static embind wrappers; never relax desktop CSP.
# Usage: build-basis-csp.sh /path/to/emsdk /path/to/basis_universal [output-dir]
set -eo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
sdk=$(cd "${1:?Pass the emsdk checkout}" && pwd)
source_dir=$(cd "${2:?Pass the Basis checkout}" && pwd)
out=${3:-"$root/public/assets/basis"}
mkdir -p "$out"
out=$(cd "$out" && pwd)
test "$(git -C "$sdk" rev-parse HEAD)" = 7b4e60e4bfcba326025e373024369eaa9904af55
test "$(git -C "$source_dir" rev-parse HEAD)" = 051ad6d8a64bb95a79e8601c317055fd1782ad3e
git -C "$sdk" diff --quiet
git -C "$sdk" diff --cached --quiet
git -C "$source_dir" diff --quiet
git -C "$source_dir" diff --cached --quiet
export EMSDK_QUIET=1
source "$sdk/emsdk_env.sh"
emcc --version | head -1 | grep -F '4.0.19'
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
cd "$source_dir"
emcc -O3 -DNDEBUG -c zstd/zstddeclib.c -o "$work/zstd.o"
em++ -std=c++17 -O3 -fno-strict-aliasing -DNDEBUG \
  -DBASISD_SUPPORT_UASTC_HDR=1 -DBASISD_SUPPORT_UASTC=1 -DBASISD_SUPPORT_BC7=1 \
  -DBASISD_SUPPORT_ATC=0 -DBASISD_SUPPORT_ASTC_HIGHER_OPAQUE_QUALITY=0 \
  -DBASISD_SUPPORT_PVRTC2=0 -DBASISD_SUPPORT_FXT1=0 -DBASISD_SUPPORT_ETC2_EAC_RG11=0 \
  -DBASISU_SUPPORT_ENCODING=0 -DBASISD_ENABLE_DEBUG_FLAGS=1 \
  -DBASISD_SUPPORT_KTX2=1 -DBASISD_SUPPORT_KTX2_ZSTD=1 -Itranscoder \
  transcoder/basisu_transcoder.cpp webgl/transcoder/basis_wrappers.cpp "$work/zstd.o" \
  --bind -sALLOW_MEMORY_GROWTH=1 -sMALLOC=emmalloc -sMODULARIZE=1 \
  -sEXPORT_NAME=BASIS -sASSERTIONS=0 -sDYNAMIC_EXECUTION=0 -sEMBIND_AOT=1 \
  '-sEXPORTED_RUNTIME_METHODS=["HEAP8"]' \
  -o "$work/basis_transcoder.js"
cp "$work/basis_transcoder.js" "$work/basis_transcoder.wasm" "$out/"
cp "$source_dir/LICENSE" "$out/LICENSE.txt"
cp "$source_dir/zstd/LICENSE" "$out/ZSTD_LICENSE.txt"
chmod 644 "$out/basis_transcoder.js" "$out/basis_transcoder.wasm" "$out/LICENSE.txt" "$out/ZSTD_LICENSE.txt"
python3 - "$out" "$root/scripts/assets/build-basis-csp.sh" <<'PY'
import hashlib,json,pathlib,sys
out=pathlib.Path(sys.argv[1])
receipt={
 'version':1,'codecVersion':'1.50.0','license':'Apache-2.0',
 'dependencies':[{'name':'Zstandard','license':'BSD-3-Clause','notice':'ZSTD_LICENSE.txt'}],
 'source':{'repository':'https://github.com/BinomialLLC/basis_universal','commit':'051ad6d8a64bb95a79e8601c317055fd1782ad3e','tag':'v1_50_0'},
 'compiler':{'sdkVersion':'4.0.19','repository':'https://github.com/emscripten-core/emsdk','commit':'7b4e60e4bfcba326025e373024369eaa9904af55'},
 'settings':{'DYNAMIC_EXECUTION':0,'EMBIND_AOT':1,'MODULARIZE':1,'EXPORT_NAME':'BASIS','ALLOW_MEMORY_GROWTH':1,'EXPORTED_RUNTIME_METHODS':['HEAP8']},
 'reference':{'three':'0.180.0','wasmSHA256':'6cf17dc889352c42e9acf8897107978d127005fe3386c36a0e3845e27967630a'},
 'recipe':'scripts/assets/build-basis-csp.sh',
 'recipeSHA256':hashlib.sha256(pathlib.Path(sys.argv[2]).read_bytes()).hexdigest(),
 'files':{n:{'bytes':(out/n).stat().st_size,'sha256':hashlib.sha256((out/n).read_bytes()).hexdigest()} for n in ['basis_transcoder.js','basis_transcoder.wasm','LICENSE.txt','ZSTD_LICENSE.txt']}
}
(out/'build.json').write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt,indent=2))
PY
