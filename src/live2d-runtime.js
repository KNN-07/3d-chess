import { Application, Container, Texture } from 'pixi.js';
import { Live2DModel, Live2DFactory, Cubism4ModelSettings, config } from 'pixi-live2d-display/cubism4';

// This adapter is loaded only after the user supplies the proprietary Cubism Core.
config.sound = false;
config.logLevel = 3;

export class CompanionRenderer {
  constructor(host) {
    this.host = host;
    this.ownedTextures = [];
    this.disposedTextures = new WeakSet();
    this.loading = false;
    this.app = new Application({ backgroundAlpha: 0, antialias: true, autoDensity: true,
      resolution: Math.min(devicePixelRatio || 1, 2), width: 200, height: 240 });
    this.app.view.setAttribute('aria-label', 'Animated Live2D companion');
    this.app.view.setAttribute('role', 'img');
    this.app.ticker.maxFPS = 30;
    this.app.ticker.add(() => this.model?.update(Math.min(this.app.ticker.deltaMS, 50)));
    host.replaceChildren(this.app.view);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.visibility = () => document.hidden ? this.app.stop() : this.app.start();
    document.addEventListener('visibilitychange', this.visibility);
    this.pointer = event => {
      if (!this.model || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const rect = this.host.getBoundingClientRect();
      this.model.internalModel.focusController.focus(
        Math.max(-1, Math.min(1, (event.clientX - rect.left - rect.width / 2) / (innerWidth / 2))),
        Math.max(-1, Math.min(1, (rect.top + rect.height / 3 - event.clientY) / (innerHeight / 2))));
    };
    window.addEventListener('pointermove', this.pointer, { passive: true });
  }

  async load(settings, resolveURL) {
    if (this.destroyed) return;
    if (this.loading || this.model) throw new Error('This companion renderer already has a model.');
    this.loading = true;
    let model, activated = false;
    try {
      const groups = Object.keys(settings.FileReferences.Motions || {});
      const idle = groups.find(group => /^idle$/i.test(group)) || groups.find(group => /idle/i.test(group));
      model = new Live2DModel({ autoUpdate: false, autoInteract: false });
      this.pending = model;
      // Record each texture as it is allocated, including if a later allocation
      // throws. Preload before the plugin starts validating the MOC binary.
      for (const url of settings.FileReferences.Textures) {
        const texture = Texture.from(url, { resourceOptions: { autoLoad: false } });
        if (!this.ownedTextures.includes(texture)) this.ownedTextures.push(texture);
      }
      const textures = await Promise.allSettled(this.ownedTextures.map(texture =>
        Promise.resolve().then(() => texture.baseTexture.resource.load())));
      if (this.destroyed) return;
      const failed = textures.find(result => result.status === 'rejected');
      if (failed) throw failed.reason;
      const modelSettings = new Cubism4ModelSettings(settings);
      // Pixi 6's legacy URL resolver corrupts the nested scheme in blob:http URLs.
      modelSettings.resolveURL = resolveURL;
      await Live2DFactory.setupLive2DModel(model, modelSettings, {
        autoUpdate: false, autoInteract: false, motionPreload: 'IDLE', idleMotionGroup: idle,
      });
      if (this.destroyed) return;
      this.model = model;
      model.anchor.set(0.5, 1);
      this.app.stage.addChild(model);
      this.resize();
      // Force one frame before the caller declares the import successful.
      model.update(16);
      this.app.renderer.render(this.app.stage);
      this.visibility();
      activated = true;
    } catch (error) {
      // Revoking a cancelled package may fail its pending resource requests.
      // Cancellation remains a normal completion for the controller.
      if (!this.destroyed) throw error;
    } finally {
      this.loading = false;
      if (this.pending === model) this.pending = null;
      if (!activated) {
        if (this.model === model) this.model = null;
        this.disposeModel(model);
        this.disposeTextures(this.ownedTextures);
        this.ownedTextures = [];
      }
    }
  }

  resize() {
    if (this.destroyed) return;
    const width = Math.max(this.host.clientWidth, 1), height = Math.max(this.host.clientHeight, 1);
    this.app.renderer.resize(width, height);
    if (!this.model) return;
    const { width: modelWidth, height: modelHeight } = this.model.internalModel;
    this.model.scale.set(Math.min(width * 0.96 / modelWidth, height * 0.98 / modelHeight));
    this.model.position.set(width / 2, height);
  }

  motion(group, index) { return this.model?.motion(group, index, 3); }
  expression(name) {
    if (name === '') { this.model?.internalModel.motionManager.expressionManager?.resetExpression(); return true; }
    return this.model?.expression(name);
  }
  react(state) {
    if (!this.model || this.state === state) return;
    this.state = state;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const pattern = { thinking: /think/i, move: /tap.?body|move/i, check: /surpris|shock/i, end: /happy|win|wave/i }[state];
    const group = pattern && Object.keys(this.model.internalModel.settings.motions || {}).find(name => pattern.test(name));
    if (group) this.model.motion(group).catch(() => {});
  }

  disposeModel(model) {
    if (!model) return;
    const textures = [...(model.textures || [])];
    try {
      if (!model.destroyed && !model._destroyed) {
        // Texture ownership is handled separately: Pixi Texture has no reliable
        // `destroyed` flag, and model textures may overlap preloaded textures.
        if (model.internalModel) model.destroy({ children: true, texture: false, baseTexture: false });
        else {
          model.emit('destroy');
          Container.prototype.destroy.call(model, { children: true });
        }
      }
    } finally { this.disposeTextures(textures); }
  }
  disposeTextures(textures) {
    for (const texture of textures) {
      if (this.disposedTextures.has(texture)) continue;
      this.disposedTextures.add(texture);
      if (texture.baseTexture) texture.destroy(true);
    }
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.observer.disconnect();
    window.removeEventListener('pointermove', this.pointer);
    document.removeEventListener('visibilitychange', this.visibility);
    this.disposeModel(this.model);
    this.model = null;
    // Factory setup waits on model events. Destroying a pending model removes
    // its listeners and strands setup forever, so load() owns deferred cleanup.
    if (!this.loading) {
      this.disposeModel(this.pending);
      this.pending = null;
      this.disposeTextures(this.ownedTextures);
      this.ownedTextures = [];
    }
    this.app.destroy(true, { children: true, texture: false, baseTexture: false });
  }
}
