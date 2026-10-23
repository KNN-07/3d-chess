import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { Chess } from '../dist/vendor/chess.js';

// Exercise the actual app handlers and chess rules. Only the DOM, 3D scene,
// companion, and asynchronous engine boundary are substituted.
const harnesses = new Map();
globalThis.__noirAppEngineTests = harnesses;
let sequence = 0;
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
class Element {
  constructor() {
    this.childNodes = []; this.dataset = {}; this.attributes = {}; this.events = new Map();
    this.textContent = ''; this.value = ''; this.hidden = false; this.disabled = false;
    this.classes = new Set(); this.classList = { toggle: (name, on) => on ? this.classes.add(name) : this.classes.delete(name) };
  }
  append(...children) { this.childNodes.push(...children); }
  replaceChildren(...children) { this.childNodes = children; }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  querySelector() { return this.button ||= new Element(); }
  addEventListener(type, listener) { this.events.set(type, listener); }
  emit(type) { this.events.get(type)?.({}); }
  showModal() { this.open = true; }
  close() { this.open = false; this.emit('close'); }
  focus() {}
  click() { if (!this.disabled) this.onclick?.(); }
}

async function harness(t, saved = null) {
  const id = String(++sequence), elements = new Map(), state = { requests: [], cancels: 0, animations: [], positions: [], highlights: [] };
  const get = name => { if (!elements.has(name)) elements.set(name, new Element()); return elements.get(name); };
  const data = new Map(saved ? [['wooden-table-chess-v1', JSON.stringify(saved)]] : []);
  const modes = ['ai', 'local'].map(mode => { const element = new Element(); element.dataset.mode = mode; return element; });
  const promotions = ['q', 'r', 'b', 'n'].map(promote => { const element = new Element(); element.dataset.promote = promote; return element; });
  const dependencies = {
    Chess: class extends Chess { constructor(...args) { super(...args); state.game = this; } },
    Companion: class { react(value) { state.reaction = value; } },
    StockfishClient: class {
      search(options) { const request = { options, ...deferred() }; state.requests.push(request); return request.promise; }
      cancel() { state.cancels++; }
    },
    ChessScene: class {
      constructor(host, options) { state.scene = this; this.options = options; }
      setPosition(board) { state.positions.push(board); }
      setHighlights(value) { state.highlights.push(value); }
      animateMove(move, board) { const animation = { move, board, ...deferred(), finished: false }; state.animations.push(animation); return animation.promise; }
      cancelMove() { for (const animation of state.animations) { animation.finished = true; animation.resolve(); } }
      resetView() {} setView() {} zoom() {} flip() {}
    },
  };
  harnesses.set(id, dependencies);
  const keys = ['document', 'window', 'localStorage', 'Option', 'setTimeout', 'clearTimeout'];
  const originals = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.document = {
    getElementById: get, createElement: () => new Element(), addEventListener() {},
    querySelectorAll: selector => selector === '[data-mode]' ? modes : selector === '[data-promote]' ? promotions : [],
  };
  globalThis.window = {};
  globalThis.localStorage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
  globalThis.Option = class extends Element { constructor(text, value) { super(); this.textContent = text; this.value = value; } };
  globalThis.setTimeout = () => 1;
  globalThis.clearTimeout = () => {};
  t.after(() => {
    harnesses.delete(id);
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const names = { './vendor/chess.js': 'Chess', './scene.js': 'ChessScene', './companion.js': 'Companion', './stockfish-client.js': 'StockfishClient' };
  const hooks = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.endsWith(`?engine-test=${id}`) && names[specifier]) return { url: `noir-app-test:${id}/${names[specifier]}`, shortCircuit: true };
      return next(specifier, context);
    },
    load(url, context, next) {
      if (!url.startsWith(`noir-app-test:${id}/`)) return next(url, context);
      const name = url.split('/').at(-1);
      return { format: 'module', shortCircuit: true, source: `export const ${name} = globalThis.__noirAppEngineTests.get('${id}').${name};` };
    },
  });
  try { await import(new URL(`../dist/app.js?engine-test=${id}`, import.meta.url)); }
  finally { hooks.deregister(); }
  await flush();
  const submit = async value => { get('move-input').value = value; get('move-form').onsubmit({ preventDefault() {} }); await flush(); };
  const finishAnimation = async () => {
    const animation = state.animations.find(value => !value.finished);
    assert.ok(animation, 'a move animation should be pending');
    animation.finished = true; animation.resolve(); await flush();
  };
  const difficulty = async value => { get('difficulty').value = value; get('difficulty').onchange(); await flush(); };
  return { state, get, data, submit, finishAnimation, difficulty };
}
function savedGame(chess, extras = {}) { return { pgn: chess.pgn(), mode: 'ai', strength: '1500', sound: false, ...extras }; }
async function awaitingBlack(t) {
  const h = await harness(t); await h.submit('e4'); await h.finishAnimation();
  assert.equal(h.state.requests.length, 1);
  return h;
}

test('engine receives the complete replay history and original starting FEN', async t => {
  const position = new Chess(); for (const move of ['e4', 'e5', 'Nf3']) position.move(move);
  const h = await harness(t, savedGame(position));
  const request = h.state.requests[0].options;
  assert.equal(request.fen, position.fen());
  assert.equal(request.startFen, new Chess().fen());
  assert.deepEqual(request.moves, ['e2e4', 'e7e5', 'g1f3']);
  assert.equal(request.elo, 1500);
  assert.equal(request.movetime, 1500);
  assert.equal(h.get('opponent-name').textContent, 'Stockfish');
});

test('undo cancels a pending search and ignores its late legal result', async t => {
  const h = await awaitingBlack(t), old = h.state.requests[0], before = h.state.cancels;
  h.get('undo-button').click(); await flush();
  assert.ok(h.state.cancels > before);
  old.resolve({ move: { from: 'e7', to: 'e5' } }); await flush();
  assert.deepEqual(h.state.game.history(), []);
  assert.equal(h.state.game.fen(), new Chess().fen());
  assert.equal(h.state.requests.length, 1);
  assert.equal(h.get('move-input').disabled, false);
});

test('confirmed new game cancels a pending search and ignores its late result', async t => {
  const h = await awaitingBlack(t), old = h.state.requests[0], before = h.state.cancels;
  h.get('restart-button').click();
  assert.equal(h.get('new-game-dialog').open, true);
  h.get('new-game-dialog').returnValue = 'start'; h.get('new-game-dialog').close(); await flush();
  assert.ok(h.state.cancels > before);
  old.resolve({ move: { from: 'e7', to: 'e5' } }); await flush();
  assert.deepEqual(h.state.game.history(), []);
  assert.equal(h.state.requests.length, 1);
  assert.equal(h.get('turn-status').textContent, '1. White to move');
});

test('changing Elo replaces the current search and rejects the old response', async t => {
  const h = await awaitingBlack(t), old = h.state.requests[0], before = h.state.cancels;
  await h.difficulty('2100');
  assert.ok(h.state.cancels > before);
  assert.equal(h.state.requests.length, 2);
  assert.equal(h.state.requests[1].options.elo, 2100);
  old.resolve({ move: { from: 'e7', to: 'e5' } }); await flush();
  assert.deepEqual(h.state.game.history(), ['e4']);
  h.state.requests[1].resolve({ move: { from: 'c7', to: 'c5' } }); await flush();
  assert.deepEqual(h.state.game.history(), ['e4', 'c5']);
  await h.finishAnimation();
  assert.equal(h.state.requests.length, 2);
  assert.equal(h.state.game.getHeaders().Black, 'Stockfish 19');
  assert.equal(h.state.game.getHeaders().BlackElo, '2100');
});

test('difficulty changes during the hand animation start exactly one search after it finishes', async t => {
  const h = await harness(t);
  await h.submit('e4');
  assert.equal(h.state.animations.length, 1);
  await h.difficulty('1700'); await h.difficulty('2800');
  h.get('hint-button').click(); await flush();
  assert.equal(h.state.requests.length, 0, 'AI and hint requests must wait for the visual move');
  assert.equal(h.get('speech-text').textContent, 'Making a move');
  await h.finishAnimation();
  assert.equal(h.state.requests.length, 1);
  assert.equal(h.state.requests[0].options.elo, 2800);
  assert.deepEqual(h.state.requests[0].options.moves, ['e2e4']);
});

test('changing difficulty cancels a pending full-strength hint without selecting its stale suggestion', async t => {
  const h = await harness(t);
  h.get('hint-button').click(); await flush();
  const hint = h.state.requests[0], before = h.state.cancels;
  assert.equal(hint.options.elo, null);
  assert.equal(hint.options.movetime, 2000);
  await h.difficulty('3190');
  assert.ok(h.state.cancels > before);
  hint.resolve({ move: { from: 'e2', to: 'e4' } }); await flush();
  assert.equal(h.state.requests.length, 1);
  assert.equal(h.state.highlights.at(-1).selected, null);
  assert.doesNotMatch(h.get('toast').textContent, /suggests/);
  assert.equal(h.get('hint-button').disabled, false);
});

test('playing a move cancels a hint and prevents the hint from competing with the ensuing AI search', async t => {
  const h = await harness(t);
  h.get('hint-button').click(); await flush();
  const hint = h.state.requests[0], before = h.state.cancels;
  await h.submit('d4');
  assert.ok(h.state.cancels > before);
  hint.resolve({ move: { from: 'e2', to: 'e4' } }); await flush();
  assert.deepEqual(h.state.game.history(), ['d4']);
  assert.equal(h.state.requests.length, 1);
  await h.finishAnimation();
  assert.equal(h.state.requests.length, 2);
  assert.deepEqual(h.state.requests[1].options.moves, ['d2d4']);
});

test('illegal engine moves leave the position unchanged and expose a retry', async t => {
  const h = await awaitingBlack(t), fen = h.state.game.fen();
  h.state.requests[0].resolve({ move: { from: 'e7', to: 'e4' } }); await flush();
  assert.equal(h.state.game.fen(), fen);
  assert.equal(h.get('hint-button').attributes['aria-label'], 'Retry computer move');
  assert.equal(h.get('hint-button').disabled, false);
  h.get('hint-button').click(); await flush();
  assert.equal(h.state.requests.length, 2);
  assert.equal(h.state.requests[1].options.fen, fen);
});

test('promotion requires an exact legal promotion and custom starting positions are preserved', async t => {
  const position = new Chess('7k/8/8/8/8/8/p7/6K1 b - - 0 1');
  const h = await harness(t, savedGame(position, { strength: 'full' }));
  const first = h.state.requests[0];
  assert.equal(first.options.startFen, position.fen());
  assert.deepEqual(first.options.moves, []);
  assert.equal(first.options.elo, null);
  assert.equal(first.options.movetime, 2000);
  first.resolve({ move: { from: 'a2', to: 'a1' } }); await flush();
  assert.equal(h.state.game.fen(), position.fen(), 'missing promotion must be rejected');
  h.get('hint-button').click(); await flush();
  h.state.requests[1].resolve({ move: { from: 'a2', to: 'a1', promotion: 'n' } }); await flush();
  assert.equal(h.state.game.get('a1').type, 'n');
  assert.equal(h.state.game.history({ verbose: true })[0].promotion, 'n');
  assert.equal(h.state.game.getHeaders().BlackElo, undefined, 'full strength has no fabricated Elo header');
  await h.finishAnimation();
});
