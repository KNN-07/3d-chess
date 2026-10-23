import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {registerHooks} from 'node:module';

const modules = new Map();
globalThis.__noirRendererTestModules = modules;
let sequence = 0;
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return {promise, resolve, reject};
}
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Renderer load remained pending after cancellation')), 200); })]); }
  finally { clearTimeout(timer); }
}

async function harness(t, options = {}) {
  const id = String(++sequence);
  const state = {models: [], textures: new Map(), applications: [], setupCalls: 0, removedListeners: []};
  class Container extends EventEmitter {
    constructor() { super(); this.children = []; }
    addChild(child) { this.children.push(child); child.parent = this; }
    removeChild(child) { this.children = this.children.filter(value => value !== child); child.parent = null; }
    destroy() {
      this.containerDestroys = (this.containerDestroys || 0) + 1;
      this.parent?.removeChild(this); this._destroyed = true; this.removeAllListeners();
    }
  }
  class Model extends Container {
    constructor() {
      super(); this.textures = []; this.modelDestroys = 0;
      this.anchor = this.scale = this.position = {set() {}};
      state.models.push(this);
    }
    update() {}
    destroy(settings) {
      this.modelDestroys++; this.emit('destroy');
      if (settings?.texture) this.textures.forEach(texture => texture.destroy(settings.baseTexture));
      super.destroy();
    }
  }
  function texture(url) {
    if (!state.textures.has(url)) {
      const pending = options.textureLoads?.[url];
      state.textures.set(url, {
        url, destroys: 0, loads: 0,
        baseTexture: {resource: {load() { const value = state.textures.get(url); value.loads++; return pending?.promise || Promise.resolve(); }}},
        // Match Pixi 6: Texture.destroy nulls baseTexture; no destroyed flag.
        destroy() { this.destroys++; this.baseTexture = null; },
      });
    }
    return state.textures.get(url);
  }
  class Application {
    constructor() {
      this.stage = new Container(); this.view = {setAttribute() {}};
      this.ticker = {add() {}, deltaMS: 16}; this.destroyCalls = 0;
      this.renderer = {resize() {}, render() { if (options.renderError) throw new Error('Frame failed'); }};
      state.applications.push(this);
    }
    start() {} stop() {}
    destroy(_, settings) {
      this.destroyCalls++;
      for (const child of [...this.stage.children]) child.destroy(settings);
    }
  }
  const dependencies = {
    Application, Container,
    Texture: {from(url) { if (url === options.allocationFailure) throw new Error('Texture allocation failed'); return texture(url); }},
    Live2DModel: Model,
    Cubism4ModelSettings: class { constructor(settings) { Object.assign(this, settings); } },
    config: {},
    Live2DFactory: {async setupLive2DModel(model, settings, factoryOptions) {
      state.setupCalls++; state.factoryOptions = factoryOptions;
      if (options.setup) return options.setup(model, settings, state, texture);
      model.internalModel = {width: 100, height: 200};
      model.textures = settings.FileReferences.Textures.map(texture);
    }},
  };
  modules.set(id, dependencies);
  const keys = ['document','window','ResizeObserver','devicePixelRatio','matchMedia'];
  const originals = Object.fromEntries(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  globalThis.document = {hidden: false, addEventListener() {}, removeEventListener(name) { state.removedListeners.push(name); }};
  globalThis.window = {addEventListener() {}, removeEventListener(name) { state.removedListeners.push(name); }};
  globalThis.ResizeObserver = class { observe() {} disconnect() { state.observerDisconnected = true; } };
  globalThis.devicePixelRatio = 1;
  globalThis.matchMedia = () => ({matches: false});
  const hook = registerHooks({
    resolve(specifier, context, next) {
      if (context.parentURL?.endsWith(`?renderer-test=${id}`) && ['pixi.js','pixi-live2d-display/cubism4'].includes(specifier)) {
        return {url: `noir-renderer-test:${id}/${specifier}`, shortCircuit: true};
      }
      return next(specifier, context);
    },
    load(url, context, next) {
      if (!url.startsWith(`noir-renderer-test:${id}/`)) return next(url, context);
      const names = url.endsWith('/pixi.js') ? ['Application','Container','Texture'] : ['Live2DModel','Live2DFactory','Cubism4ModelSettings','config'];
      return {format: 'module', shortCircuit: true, source: names.map(name => `export const ${name} = globalThis.__noirRendererTestModules.get('${id}').${name};`).join('\n')};
    },
  });
  let Renderer;
  try { ({CompanionRenderer: Renderer} = await import(new URL(`../src/live2d-runtime.js?renderer-test=${id}`, import.meta.url))); }
  finally { hook.deregister(); }
  const host = {clientWidth: 200, clientHeight: 240, replaceChildren() {}};
  const renderer = new Renderer(host);
  t.after(() => {
    renderer.destroy(); modules.delete(id);
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    }
  });
  return {renderer, state, texture};
}
const settings = (...textures) => ({Version: 3, url: 'https://local-model.invalid/avatar.model3.json', FileReferences: {Moc: 'blob:moc', Textures: textures}});

test('cancel during preload releases UI immediately but waits for every texture before cleanup', async t => {
  const first = deferred(), second = deferred();
  const h = await harness(t, {textureLoads: {'blob:first': first, 'blob:second': second}});
  const loading = h.renderer.load(settings('blob:first','blob:second'), value => value);
  await flush(); h.renderer.destroy();
  assert.equal(h.state.applications[0].destroyCalls, 1);
  assert.equal(h.state.observerDisconnected, true);
  assert.deepEqual(h.state.removedListeners, ['pointermove','visibilitychange']);
  assert.equal(h.state.models[0]._destroyed, undefined);
  first.resolve(); await flush();
  assert.equal(h.texture('blob:first').destroys, 0, 'pending resources remain alive until all loads settle');
  second.resolve(); await bounded(loading);
  assert.equal(h.state.setupCalls, 0, 'cancelled preload never enters Cubism factory');
  assert.equal(h.state.models[0].containerDestroys, 1);
  assert.equal(h.texture('blob:first').destroys, 1);
  assert.equal(h.texture('blob:second').destroys, 1);
  assert.equal(h.renderer.pending, null);
  h.renderer.destroy(); assert.equal(h.texture('blob:first').destroys, 1);
});

test('cancel during factory setup preserves its event listeners and destroys late textures once', async t => {
  let finish;
  const h = await harness(t, {setup(model, modelSettings, state, texture) {
    model.internalModel = {width: 100,height: 200};
    const ready = new Promise(resolve => model.once('textureLoaded', resolve));
    finish = () => {
      model.textures = [texture('blob:body'),texture('blob:late')];
      model.emit('textureLoaded');
    };
    return ready;
  }});
  const loading = h.renderer.load(settings('blob:body'), value => value);
  await flush();
  const model = h.state.models[0];
  assert.equal(model.listenerCount('textureLoaded'), 1);
  h.renderer.destroy();
  assert.equal(model.listenerCount('textureLoaded'), 1, 'destroy must not remove the factory completion listener');
  assert.equal(model.modelDestroys, 0);
  finish(); await bounded(loading);
  assert.equal(model.modelDestroys, 1);
  assert.equal(h.texture('blob:body').destroys, 1);
  assert.equal(h.texture('blob:late').destroys, 1);
  assert.equal(h.renderer.model, null);
  assert.equal(h.renderer.pending, null);
  assert.equal(h.state.applications[0].stage.children.length, 0);
});

test('a texture failure waits for other in-flight textures and then releases the entire batch', async t => {
  const broken = deferred(), slow = deferred();
  const h = await harness(t, {textureLoads: {'blob:broken': broken, 'blob:slow': slow}});
  let settled = false;
  const outcome = h.renderer.load(settings('blob:broken','blob:slow'), value => value).then(() => null, error => error).finally(() => { settled = true; });
  broken.reject(new Error('Invalid image')); await flush();
  assert.equal(settled, false);
  assert.equal(h.texture('blob:slow').destroys, 0);
  slow.resolve();
  assert.match((await bounded(outcome)).message, /Invalid image/);
  assert.equal(h.state.setupCalls, 0);
  assert.equal(h.texture('blob:broken').destroys, 1);
  assert.equal(h.texture('blob:slow').destroys, 1);
  h.renderer.destroy(); assert.equal(h.texture('blob:slow').destroys, 1);
});

test('MOC failure cleans preloaded textures and uninitialized models without double destruction', async t => {
  const h = await harness(t, {setup: async () => { throw new Error('Invalid moc data'); }});
  await assert.rejects(h.renderer.load(settings('blob:body','blob:body'), value => value), /Invalid moc data/);
  assert.equal(h.texture('blob:body').loads, 1);
  assert.equal(h.texture('blob:body').destroys, 1);
  assert.equal(h.state.models[0].containerDestroys, 1);
  assert.equal(h.renderer.pending, null);
  h.renderer.destroy(); h.renderer.destroy();
  assert.equal(h.texture('blob:body').destroys, 1);
});

test('successful models retain textures until their renderer is destroyed', async t => {
  const h = await harness(t);
  await h.renderer.load(settings('blob:body','blob:body'), value => value);
  assert.equal(h.renderer.model, h.state.models[0]);
  assert.equal(h.texture('blob:body').destroys, 0);
  assert.equal(h.state.applications[0].stage.children.length, 1);
  h.renderer.destroy(); h.renderer.destroy();
  assert.equal(h.state.models[0].modelDestroys, 1);
  assert.equal(h.texture('blob:body').destroys, 1);
  assert.equal(h.state.applications[0].destroyCalls, 1);
});

test('partial texture allocation failure cleans textures allocated before the throw', async t => {
  const h = await harness(t, {allocationFailure:'blob:bad'});
  await assert.rejects(h.renderer.load(settings('blob:body','blob:bad'), value => value), /Texture allocation failed/);
  assert.equal(h.texture('blob:body').destroys, 1);
  assert.equal(h.state.setupCalls, 0);
  assert.equal(h.state.models[0].containerDestroys, 1);
});

test('factory rejection after cancellation resolves normally and still cleans all resources', async t => {
  const setup = deferred();
  const h = await harness(t, {setup: () => setup.promise});
  const loading = h.renderer.load(settings('blob:body'), value => value);
  await flush(); h.renderer.destroy();
  setup.reject(new Error('Revoked package URL'));
  await bounded(loading);
  assert.equal(h.texture('blob:body').destroys, 1);
  assert.equal(h.state.models[0].containerDestroys, 1);
  assert.equal(h.renderer.pending, null);
});

test('failure on the first rendered frame removes the staged model and owned textures', async t => {
  const h = await harness(t, {renderError:true});
  await assert.rejects(h.renderer.load(settings('blob:body'), value => value), /Frame failed/);
  assert.equal(h.renderer.model, null);
  assert.equal(h.renderer.pending, null);
  assert.equal(h.state.applications[0].stage.children.length, 0);
  assert.equal(h.texture('blob:body').destroys, 1);
});
