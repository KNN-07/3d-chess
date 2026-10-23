import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Test the real controller with controllable storage, package, and renderer
// boundaries. No WebGL context, external runtime, or IndexedDB mock is needed.
const modules = new Map();
globalThis.__noirCompanionTestModules = modules;
let sequence = 0;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Element {
  constructor() {
    this.childNodes = []; this.dataset = {}; this.hidden = false; this.disabled = false;
    this.textContent = ''; this.value = ''; this.files = []; this.selectedOptions = [];
    this.classes = new Set();
    this.classList = {
      add: name => this.classes.add(name), remove: name => this.classes.delete(name),
      contains: name => this.classes.has(name),
      toggle: (name, value) => value ? this.classes.add(name) : this.classes.delete(name),
    };
    this.style = { setProperty() {} };
  }
  append(...children) {
    for (const child of children) {
      child.remove(); child.parent = this; this.childNodes.push(child);
    }
  }
  replaceChildren(...children) {
    for (const child of this.childNodes) child.parent = null;
    this.childNodes = []; this.append(...children);
  }
  remove() {
    if (this.parent) this.parent.childNodes = this.parent.childNodes.filter(child => child !== this);
    this.parent = null;
  }
  closest() { return this.container; }
  click() { this.onclick?.(); }
}

function modelPackage(name = 'avatar') {
  return {
    name, manifestPath: `${name}/${name}.model3.json`, settings: { FileReferences: {} },
    resolveURL: value => value, disposals: 0,
    dispose() { this.disposals++; },
  };
}
const filesFor = name => [{ name: `${name}.model3.json`, webkitRelativePath: `${name}/${name}.model3.json` }];

async function harness(t, options = {}) {
  const id = String(++sequence);
  const elements = new Map();
  const container = new Element();
  const get = name => {
    if (!elements.has(name)) elements.set(name, new Element());
    return elements.get(name);
  };
  get('live2d-stage').container = container;
  get('live2d-stage').hidden = true;
  get('game-status').textContent = 'White to move';
  const state = { saved: options.saved ?? null, core: null, writes: [], clears: 0, packages: [], renderers: [] };
  const dependencies = {
    createModelPackage: async () => { const value = modelPackage(); state.packages.push(value); return value; },
    discoverModelManifests: files => files.map(file => file.webkitRelativePath || file.name),
    readCompanionSave: options.readSaved || (async () => state.saved),
    readCoreSave: options.readCore || (async () => state.core),
    writeCompanionSave: async record => { state.saved = record; state.writes.push(record); },
    clearCompanionSave: async () => { state.saved = null; state.clears++; },
    writeCoreSave: async core => { state.core = core; },
  };
  modules.set(id, dependencies);
  const originals = Object.fromEntries(['document', 'window', 'Option'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.document = { getElementById: get, createElement: () => new Element(), body: new Element(), head: new Element() };
  globalThis.Option = class extends Element {
    constructor(text, value) { super(); this.textContent = text; this.value = value; }
  };
  class Renderer {
    constructor(host) {
      this.host = host; this.canvas = new Element(); host.append(this.canvas);
      this.observer = { observe() {}, unobserve() {} }; this.destroys = 0;
      state.renderers.push(this);
    }
    async load(...args) { return options.rendererLoad?.(this, ...args); }
    destroy() { this.destroys++; }
    resize() {}
    react(value) { this.reaction = value; }
  }
  globalThis.window = { Live2DCubismCore: options.noCore ? undefined : { Version: {}, Moc: {} }, NoirLive2DRuntime: { CompanionRenderer: Renderer } };
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.endsWith(`?controller-test=${id}`) && /^\.\/(model-package|companion-storage)\.js$/.test(specifier)) {
        return { url: `noir-test:${id}/${specifier.slice(2)}`, shortCircuit: true };
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (!url.startsWith(`noir-test:${id}/`)) return next(url, context);
      const names = url.endsWith('/model-package.js') ? ['createModelPackage', 'discoverModelManifests'] : ['readCompanionSave', 'writeCompanionSave', 'clearCompanionSave', 'readCoreSave', 'writeCoreSave'];
      return { format: 'module', shortCircuit: true, source: names.map(name => `export const ${name} = (...args) => globalThis.__noirCompanionTestModules.get('${id}').${name}(...args);`).join('\n') };
    },
  });
  let Companion;
  try { ({ Companion } = await import(new URL(`../dist/companion.js?controller-test=${id}`, import.meta.url))); }
  finally { hook.deregister(); }
  t.after(() => {
    modules.delete(id);
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const companion = new Companion();
  await flush();
  return { companion, state, dependencies, get, container };
}

test('reset during package creation cannot resurrect a companion or save stale files', async t => {
  const h = await harness(t);
  const pending = deferred();
  const packageValue = modelPackage();
  h.dependencies.createModelPackage = () => pending.promise;
  const loading = h.companion.load(filesFor('avatar'), packageValue.manifestPath);
  await h.companion.reset();
  pending.resolve(packageValue);
  await loading;
  assert.equal(packageValue.disposals, 1);
  assert.equal(h.state.renderers.length, 0);
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.get('live2d-stage').hidden, true);
  assert.equal(h.get('companion-image').hidden, false);
  assert.deepEqual(h.companion.files, []);
  assert.equal(h.companion.loading, false);
});

test('reset during renderer loading disposes staging resources and leaves the original visible', async t => {
  const pending = deferred();
  const h = await harness(t, { rendererLoad: () => pending.promise });
  const loading = h.companion.load(filesFor('avatar'), 'avatar/avatar.model3.json');
  await flush();
  assert.ok(h.companion.pending, 'renderer has entered the asynchronous staging phase');
  await h.companion.reset();
  pending.resolve();
  await loading;
  assert.ok(h.state.renderers[0].destroys >= 1);
  assert.ok(h.state.packages[0].disposals >= 1);
  assert.equal(h.state.renderers[0].host.parent, null);
  assert.equal(h.companion.renderer, null);
  assert.equal(h.companion.pending, null);
  assert.equal(h.get('live2d-stage').hidden, true);
  assert.equal(h.container.classList.contains('has-live2d'), false);
  assert.equal(h.state.saved, null);
});

test('a failed replacement preserves the active renderer, files, and committed save', async t => {
  let shouldFail = false;
  const h = await harness(t, { rendererLoad: async () => { if (shouldFail) throw new Error('Invalid moc data'); } });
  const oldFiles = filesFor('old');
  await h.companion.load(oldFiles, 'old/old.model3.json');
  const oldRenderer = h.companion.renderer;
  const oldPackage = h.companion.modelPackage;
  const oldSave = h.state.saved;
  shouldFail = true;
  await h.companion.chooseFiles(filesFor('broken'));
  assert.equal(h.companion.renderer, oldRenderer);
  assert.equal(h.companion.modelPackage, oldPackage);
  assert.equal(h.companion.files, oldFiles);
  assert.equal(h.state.saved, oldSave);
  assert.equal(h.state.writes.length, 1);
  assert.equal(oldRenderer.destroys, 0);
  assert.equal(oldPackage.disposals, 0);
  assert.equal(h.state.renderers[1].destroys, 1);
  assert.equal(h.state.packages[1].disposals, 1);
  assert.deepEqual(h.get('live2d-stage').childNodes, [oldRenderer.canvas]);
  assert.match(h.get('model-status').textContent, /Invalid moc data/);
  assert.equal(h.companion.loading, false);
});

test('a persisted restore arriving after reset cannot restore files, size, or a model', async t => {
  const pending = deferred();
  const h = await harness(t, { readSaved: () => pending.promise });
  await h.companion.reset();
  const resetMessage = h.get('model-status').textContent;
  pending.resolve({ files: filesFor('saved'), paths: ['saved/saved.model3.json'], manifestPath: 'saved/saved.model3.json', preferences: { size: 350 } });
  await flush();
  assert.deepEqual(h.companion.files, []);
  assert.equal(h.companion.size, 240);
  assert.equal(h.state.packages.length, 0);
  assert.equal(h.state.renderers.length, 0);
  assert.equal(h.get('model-status').textContent, resetMessage);
  assert.equal(h.state.saved, null);
});

test('a late restore failure cannot overwrite a completed reset status', async t => {
  const pending = deferred();
  const h = await harness(t, { readSaved: () => pending.promise });
  await h.companion.reset();
  const resetMessage = h.get('model-status').textContent;
  pending.reject(new Error('Storage unavailable'));
  await flush();
  assert.equal(h.get('model-status').textContent, resetMessage);
});

test('missing Cubism Core produces an actionable error without disrupting game state', async t => {
  const h = await harness(t, { noCore: true });
  h.companion.react('thinking');
  await h.companion.load(filesFor('avatar'), 'avatar/avatar.model3.json');
  assert.match(h.get('model-status').textContent, /Add live2dcubismcore\.min\.js/);
  assert.equal(h.get('model-status').classList.contains('error'), true);
  assert.equal(h.get('game-status').textContent, 'White to move');
  assert.equal(h.companion.state, 'thinking');
  assert.equal(h.companion.loading, false);
  assert.equal(h.get('choose-model').disabled, false);
  assert.equal(h.get('live2d-stage').hidden, true);
  assert.equal(h.state.renderers.length, 0);
  assert.equal(h.state.writes.length, 0);
  assert.equal(h.state.packages[0].disposals, 1);
});
