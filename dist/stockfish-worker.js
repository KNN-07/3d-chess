let embeddedScriptURL, embeddedWasmURL;

/** Start the same unmodified engine in served and self-contained editions. */
export function createStockfishWorker() {
  const script = document.getElementById('embedded-stockfish-script');
  const wasm = document.getElementById('embedded-stockfish-wasm');
  if (!script || !wasm) return new Worker('./vendor/stockfish/stockfish-19-lite-single.js');
  if (!embeddedScriptURL) {
    const binary = atob(wasm.textContent.trim());
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
    embeddedWasmURL = URL.createObjectURL(new Blob([bytes], { type: 'application/wasm' }));
    embeddedScriptURL = URL.createObjectURL(new Blob([script.textContent], { type: 'text/javascript' }));
  }
  // Stockfish.js officially accepts its WASM URL in the worker URL fragment.
  // Blob URLs stay alive for subsequent searches until this document closes.
  return new Worker(`${embeddedScriptURL}#${encodeURIComponent(embeddedWasmURL)}`);
}
