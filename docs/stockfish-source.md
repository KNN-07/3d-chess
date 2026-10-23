# Stockfish engine, license, and corresponding source

The computer opponent uses **Stockfish.js 19.0.1**, the **Stockfish 19 Lite WASM** single-threaded build by Nathan Rugg, Chess.com, and the Stockfish contributors. The two engine files are unmodified official release assets. The lite build contains a smaller NNUE network than the full Stockfish build. Its configured Elo is an approximate engine strength setting, not a measured rating for this app or device.

## License and source access

The engine is distributed under GNU GPL version 3; see the full [license](../dist/vendor/stockfish/COPYING.txt) and [authors](../dist/vendor/stockfish/AUTHORS). Stockfish is free software and comes without warranty. The engine's GPL terms remain separate from notices for other components. Preserve the license, attribution, and access to the corresponding source when redistributing the engine or the standalone game.

This repository provides the corresponding upstream source and the exact embedded network, rather than relying only on an external source-code link:

- [Complete source archive](../third_party/stockfish/stockfishjs-19.0.1-source.tgz): the untouched upstream repository snapshot at commit `0d5dd7944f88c817c07a26bc4fb1905d5f9c46d6` (tag `v19.0.1`), including C++ sources, Emscripten glue, build scripts, notices, examples, and tests. The archive preserves the upstream example-directory symlink.
- [Embedded NNUE network](../third_party/stockfish/networks/nn-61e7af4bb97d.nnue): exact parameters required by the lite build, credited upstream to Chris Bao (`sscg13`). [Official network listing](https://tests.stockfishchess.org/nns?network_name=nn-61e7af4bb97d).
- [Artifact manifest](../dist/vendor/stockfish/manifest.json): exact source URLs, version, commit, build-tool versions, and SHA-256 checksums.
- [Upstream release](https://github.com/nmrugg/stockfish.js/releases/tag/v19.0.1) and [immutable source tree](https://github.com/nmrugg/stockfish.js/tree/0d5dd7944f88c817c07a26bc4fb1905d5f9c46d6).

Public source access for copies of this game: [KNN-07/3d-chess source documentation](https://github.com/KNN-07/3d-chess/blob/main/docs/stockfish-source.md). Distributors hosting a standalone copy must retain equivalent source access with that distribution; do not publish only the binaries while omitting their source and license information.

## Rebuild

Use a POSIX build environment such as Linux or WSL, with Node.js, npm, GNU Make, and the usual compiler/build tools. Install and activate **Emscripten 6.0.9** using the [official emsdk](https://github.com/emscripten-core/emsdk), then source its `emsdk_env.sh`. The source package pins **Terser 5.51.2**. The release build configuration is in `build.js` and `src/emscripten/wasm-makefile.mk` inside the archive.

From this repository's root, extract into a new build directory and supply the included network:

```sh
mkdir -p work/stockfish-build
tar -xzf third_party/stockfish/stockfishjs-19.0.1-source.tgz \
  -C work/stockfish-build --strip-components=1
cp third_party/stockfish/networks/nn-61e7af4bb97d.nnue \
  work/stockfish-build/src/
cd work/stockfish-build
npm install --ignore-scripts
node build.js --single-threaded --lite --no-split --strict-em-check -f
```

The generated files are `src/stockfish-19-lite-single.js` and `src/stockfish-19-lite-single.wasm`. The upstream recipe embeds the network, uses WASM SIMD and Asyncify, disables pthreads for this flavor, and strips Syzygy probing by default. It needs no external network file at runtime. Emscripten 6.0.9 is checked by `--strict-em-check`; the exact preferred source and build scripts are included above. The vendored release was tested directly; this repository does not claim that a fresh local rebuild was performed or is byte-identical across toolchain environments.

To restore missing official artifacts, or verify existing copies without downloading the full npm package:

```sh
node scripts/vendor-stockfish.mjs
node scripts/vendor-stockfish.mjs --verify
```

The script checks every SHA-256 before writing and refuses to overwrite a differing local artifact.

## Runtime integration

Use a **classic Web Worker**, preserving the release filenames in the same directory:

```js
const engine = new Worker('./vendor/stockfish/stockfish-19-lite-single.js');
engine.onmessage = ({ data }) => console.log(data); // UCI text lines
engine.postMessage('uci');
```

This single-threaded build requires WebAssembly and WASM SIMD, but does not require `SharedArrayBuffer`, COOP, COEP, or cross-origin isolation. Its worker derives the default WASM URL from its own filename. The server must serve `.wasm` as `application/wasm`, because this upstream worker wrapper uses `WebAssembly.instantiateStreaming`.

For a fully embedded standalone HTML file, keep the JS bytes unchanged and supply a WASM Blob URL in the worker URL fragment:

```js
const wasmURL = URL.createObjectURL(new Blob([wasmBytes], { type: 'application/wasm' }));
const scriptURL = URL.createObjectURL(new Blob([engineJS], { type: 'text/javascript' }));
const engine = new Worker(`${scriptURL}#${encodeURIComponent(wasmURL)}`);
```

The upstream wrapper decodes the first comma-separated fragment field as the WASM URL. Keep both Blob URLs alive until the worker is finished, then terminate the worker and revoke them. Its auto-starting browser-worker wrapper creates its own module configuration, so assigning a global `Module.wasmBinary` before loading this file does not configure that wrapper. The internal Emscripten factory accepts `locateFile`/`wasmBinary`, but the URL-fragment mechanism is the supported path used here without modifying release code.

## Verified UCI options

The actual vendored engine returned these options during a local UCI handshake:

```text
id name Stockfish 19 Lite WASM
option name Threads type spin default 1 min 1 max 1
option name Hash type spin default 16 min 1 max 33554432
option name Skill Level type spin default 20 min 0 max 20
option name UCI_LimitStrength type check default false
option name UCI_Elo type spin default 1320 min 1320 max 3190
option name EvalFile type string default nn-61e7af4bb97d.nnue
```

Wait for `uciok`, set `UCI_LimitStrength` and `UCI_Elo` for a limited preset, send `isready`, and wait for `readyok` before issuing the position and search. Full-strength mode sets `UCI_LimitStrength` to `false`. Pass move history in the UCI `position` command when available so the engine sees repetition history. Elo presets outside 1320–3190 are not supported by this engine's native `UCI_Elo` option.

## Release checksums and sizes

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| `stockfish-19-lite-single.js` | 28,230 | `ccb130d7ff29408531c47d859a49f91d59d4f482d05a53eb1a3231a4f624c91a` |
| `stockfish-19-lite-single.wasm` | 1,845,971 | `ee4f115bdb2d32cadf96cada104a05b5ec257d7ad6f57582190b49bc71f096de` |
| `stockfishjs-19.0.1-source.tgz` | 426,352 | `e5289a920554bf0069a6601c228e81d957c00522bb31c4343588dc5d7d251879` |
| `nn-61e7af4bb97d.nnue` | 1,166,381 | `61e7af4bb97d51eeeb25d322916f86513b5cd3a827ce189c98c6e31946f99e5b` |
