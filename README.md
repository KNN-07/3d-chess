# The Wooden Table — 3D Chess

A browser chess game with a wooden board, sculpted pieces, an animated human hand, and a computer opponent. The board, pieces, grain, shadows, and camera are rendered live in Three.js. Use the original illustrated companion or import your own animated Live2D model.

![The wooden chessboard and animated hand](docs/preview.jpg)

## Run locally

The supplied `3D-Chess.html` is a complete standalone edition: double-click it to play, with no installation or server required.

To run the editable source, with Node.js installed, double-click `START.cmd` on Windows or run `npm start` in this folder. Open http://127.0.0.1:4173. All chess libraries and the default artwork are included locally; no CDN or install is needed to play. The optional Live2D companion needs the one-time runtime setup below.

## Play

- Select a piece, then a highlighted destination. Drag to rotate and scroll to zoom.
- A 3D human hand reaches in, lifts the piece, and places it on the destination for both players. Undo and restart can interrupt the movement safely; reduced-motion preferences are respected.
- The menu offers computer or local two-player games, three computer difficulty levels, move history, notation entry, and PGN export.
- The right controls provide undo, a suggested move, and zoom. Lower-right controls flip the board, switch camera views, and enable sound.
- Castling, en passant, all four promotion choices, checkmate, stalemate, repetition, insufficient material, and the fifty-move draw rule are handled by chess.js. Available draws end the game automatically.
- Games are saved in this browser's local storage. Against the computer, you play White. Two-player mode is local pass-and-play; there is no online matchmaking.
- The computer is a lightweight, time-bounded search engine for casual play, not Stockfish or a rated opponent.

## Custom Live2D companion

Open **Game menu → Companion / Live2D**:

1. Download the [official Cubism SDK for Web](https://www.live2d.com/en/sdk/download/web/) under its applicable terms. Choose **Add Cubism Core** and select `Core/live2dcubismcore.min.js` (the unminified `live2dcubismcore.js` also works). This is a one-time local setup; the proprietary Core is not included in this repository or downloaded automatically.
2. Choose **Import model folder**, then select the complete exported model folder. It must contain a `.model3.json`, its `.moc3`, textures, and any referenced physics, pose, expressions, motions, or sound files. Preserve its subfolders. Unzip archives first. Editor project files and legacy Cubism 2 `.model.json` / `.moc` are unsupported.
3. Adjust **Companion size**, select a **Motion** and press **Play**, or choose an **Expression**. Controls reflect the assets actually included in your model. The model blinks, follows the pointer, and plays its idle motions; recognized motion groups such as `Think`, `TapBody`, and `Happy` can react to game events. Model audio is muted.

The renderer targets **Cubism 3/4 exports** using PixiJS 6.5.10 and pixi-live2d-display 0.4.0. Newer Cubism 5 features are not guaranteed. A newer `.moc3` may need a compatible Core or a Cubism 4-compatible export. Models with no expressions or motions still render, with unavailable controls disabled.

Imported files never leave the browser. Model files, relative paths, runtime, and size are saved in IndexedDB on this device when available; private browsing or storage limits may make them session-only. The folder limit is 150 MB / 5,000 files. Multiple models in a folder get a model selector. **Restore original companion** removes the saved model and restores the illustration, retaining the runtime for future imports. Replacing the runtime takes effect after a reload. Use only the official Core file: it is executable JavaScript.

This works in the standalone HTML too: the optional renderer is embedded, and local model/runtime files need no CDN. Browser support for folder selection and persistence varies, especially for `file://` pages; use `npm start` if your browser restricts local-file storage. Model imports do not affect the chess game.

Core and models retain their own licenses. Use models you have permission to use. Review [Live2D's publication requirements](https://www.live2d.com/en/sdk/license/) before distributing an application with Live2D enabled: custom-model importing may fall under its **Expandable Applications** terms. Supplying Core separately does not establish an exemption. No Live2D sample models are shipped here.

## Source

`dist/` contains the deployable static game. `scene.js` builds the 3D scene, `app.js` manages the interface/game session, and `ai.js` runs the computer search through `engine-worker.js`. `server.mjs` is a small local HTTP server. Run `npm test` for the chess and computer checks.

For development and tests, use Node.js 22.15+ (Node.js 24 recommended). To rebuild the standalone edition, run `npm ci` and then `npm run build`. This writes the root `3D-Chess.html` with the renderers, worker, rules, styles, and artwork embedded. Running `node bundle.mjs` without an output argument writes `dist/standalone.html` for local preview instead.

`dist/companion.js` manages the optional companion UI; `model-package.js` validates and resolves local assets; `companion-storage.js` handles IndexedDB. `src/live2d-runtime.js` is built into `dist/vendor/live2d-renderer.js` by `bundle.mjs` and loaded only after Core is supplied. The build also embeds it into the standalone HTML. No proprietary Core or sample models are included in either build.

Third-party libraries: Three.js 0.180.0 (MIT), chess.js 1.4.0 (BSD-2-Clause), PixiJS 6.5.10 (MIT), and pixi-live2d-display 0.4.0 (MIT, with Cubism framework code under separate Live2D terms). Full notices are in `dist/vendor/` and embedded in the standalone HTML. The unused `gh-pages` dependency of the Live2D plugin is overridden to 6.1.1 to avoid known vulnerable transitive versions; no deployment tooling is used by the game.
