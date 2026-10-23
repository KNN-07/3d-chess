import { createModelPackage, discoverModelManifests } from './model-package.js';
import { readCompanionSave, writeCompanionSave, clearCompanionSave, readCoreSave, writeCoreSave } from './companion-storage.js';

const $ = id => document.getElementById(id);
const scriptLoads = new Map();
function loadScript(url) {
  if (scriptLoads.has(url)) return scriptLoads.get(url);
  const promise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => { script.remove(); reject(new Error('Runtime loading timed out. Try adding the official Cubism Core file again.')); }, 20000);
    script.src = url;
    script.onload = () => { clearTimeout(timeout); script.remove(); resolve(); };
    script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('Could not load the Live2D renderer.')); };
    document.head.append(script);
  }).catch(error => { scriptLoads.delete(url); throw error; });
  scriptLoads.set(url, promise);
  return promise;
}

export class Companion {
  constructor() {
    this.generation = 0;
    this.files = [];
    this.size = 240;
    this.state = 'idle';
    $('choose-core').onclick = () => $('core-file').click();
    $('choose-model').onclick = () => $('model-folder').click();
    $('core-file').onchange = () => {
      const file = $('core-file').files[0]; $('core-file').value = '';
      if (file) this.addCore(file);
    };
    $('model-folder').onchange = () => {
      const files = [...$('model-folder').files]; $('model-folder').value = '';
      if (files.length) this.chooseFiles(files);
    };
    $('model-selector').onchange = () => this.load(this.candidateFiles, $('model-selector').value);
    $('reset-companion').onclick = () => this.reset();
    $('companion-size').oninput = () => {
      this.setSize(Number($('companion-size').value));
    };
    $('companion-size').onchange = () => this.persist();
    $('play-motion').onclick = async () => {
      const selected = $('companion-motion').selectedOptions[0];
      if (!selected?.dataset.group) return;
      try {
        const started = await this.renderer?.motion(selected.dataset.group, Number(selected.dataset.index));
        if (!started) this.status('This motion could not play. Check that its files are included.', true);
      } catch { this.status('This motion could not play. Check that its files are included.', true); }
    };
    $('companion-expression').onchange = async () => {
      try {
        const applied = await this.renderer?.expression($('companion-expression').value);
        if (!applied) this.status('This expression could not load.', true);
      } catch { this.status('This expression could not load.', true); }
    };
    this.restore();
  }

  status(message, error = false) {
    $('model-status').textContent = message;
    $('model-status').classList.toggle('error', error);
  }
  busy(value) {
    this.loading = value;
    for (const id of ['choose-core', 'choose-model', 'model-selector']) $(id).disabled = value;
    $('model-controls').inert = value;
  }
  async ensureRuntime() {
    if (!window.Live2DCubismCore) {
      if (!this.coreFile) throw new Error('Add live2dcubismcore.min.js from the official Cubism SDK first, then import your model folder.');
      const url = URL.createObjectURL(this.coreFile);
      try { await loadScript(url); } finally { URL.revokeObjectURL(url); scriptLoads.delete(url); }
      if (!window.Live2DCubismCore?.Version || !window.Live2DCubismCore?.Moc) throw new Error('That file is not a compatible Cubism Core runtime. Use the official live2dcubismcore.min.js.');
    }
    if (!window.NoirLive2DRuntime) {
      const embedded = $('embedded-live2d-renderer');
      const url = embedded ? URL.createObjectURL(new Blob([embedded.textContent], { type: 'text/javascript' })) : './vendor/live2d-renderer.js';
      try { await loadScript(url); } finally { if (embedded) URL.revokeObjectURL(url); }
      if (!window.NoirLive2DRuntime) throw new Error('The Live2D renderer could not initialize. Check your Cubism Core version.');
    }
  }
  async addCore(file) {
    if (!/^live2dcubismcore(?:\.min)?\.js$/i.test(file.name) || file.size > 5 * 1024 * 1024) {
      this.status('Choose the official live2dcubismcore.min.js (or live2dcubismcore.js), up to 5 MB.', true); return;
    }
    if (window.Live2DCubismCore) {
      // Replacing a live singleton can invalidate models; apply the new file next visit.
      try { await writeCoreSave(file); $('core-status').textContent = 'Replacement runtime saved. Reload the game to use it.'; }
      catch { this.status('Could not save the replacement runtime in this browser.', true); }
      return;
    }
    const generation = ++this.generation;
    this.busy(true);
    this.coreFile = file;
    this.status('Preparing Live2D…');
    try {
      await this.ensureRuntime();
      if (generation !== this.generation) return;
      $('core-status').textContent = 'Cubism Core ready · local runtime';
      try { await writeCoreSave(file); } catch { $('core-status').textContent = 'Cubism Core ready for this visit. Browser storage is unavailable.'; }
      if (generation === this.generation) this.status('Ready. Import your model folder.');
    } catch (error) {
      if (generation === this.generation) { this.coreFile = null; this.status(error.message, true); }
    } finally { if (generation === this.generation) this.busy(false); }
  }
  async chooseFiles(files) {
    try {
      const manifests = discoverModelManifests(files);
      if (!manifests.length) throw new Error('No .model3.json found. Choose the complete exported Cubism 3 or 4 model folder, not an editor project or ZIP.');
      this.candidateFiles = files;
      $('model-selector').replaceChildren(...manifests.map(path => new Option(path, path)));
      $('model-selector-row').hidden = manifests.length < 2;
      await this.load(files, manifests[0]);
    } catch (error) { this.status(error.message, true); }
  }
  async load(files, manifestPath, restoring = false) {
    const generation = ++this.generation;
    this.busy(true);
    this.status(restoring ? 'Restoring your companion…' : 'Loading your companion…');
    let modelPackage, renderer, host;
    try {
      modelPackage = await createModelPackage(files, manifestPath);
      if (generation !== this.generation) { modelPackage.dispose(); return; }
      await this.ensureRuntime();
      if (generation !== this.generation) { modelPackage.dispose(); return; }
      // Load into an off-screen staging host, keeping the existing companion on failure.
      host = document.createElement('div');
      host.className = 'live2d-staging';
      document.body.append(host);
      renderer = new window.NoirLive2DRuntime.CompanionRenderer(host);
      this.pending = { renderer, modelPackage, host };
      await renderer.load(modelPackage.settings, modelPackage.resolveURL);
      if (generation !== this.generation) { renderer.destroy(); modelPackage.dispose(); host.remove(); return; }
      this.releaseCurrent();
      this.renderer = renderer;
      this.modelPackage = modelPackage;
      this.pending = null;
      const stage = $('live2d-stage');
      stage.replaceChildren(...host.childNodes);
      renderer.observer.unobserve(host);
      renderer.host = stage;
      renderer.observer.observe(stage);
      host.remove();
      $('companion-image').hidden = true;
      $('companion-fallback').hidden = true;
      stage.hidden = false;
      stage.closest('.companion').classList.add('has-live2d');
      this.setSize(this.size);
      this.files = files;
      this.candidateFiles = files;
      this.manifestPath = modelPackage.manifestPath;
      this.fillControls(modelPackage.settings);
      renderer.react(this.state);
      const saved = restoring || await this.persist();
      if (generation === this.generation) this.status(`${modelPackage.name} active · ${saved ? 'saved on this device' : 'this visit only; browser storage unavailable'}.`);
    } catch (error) {
      if (renderer && renderer !== this.renderer) renderer.destroy();
      host?.remove();
      if (modelPackage && modelPackage !== this.modelPackage) modelPackage.dispose();
      if (generation === this.generation) {
        this.pending = null;
        this.status(`Could not load companion. ${error.message || 'Check the model files and Cubism Core compatibility.'}`, true);
      }
    } finally { if (generation === this.generation) this.busy(false); }
  }
  fillControls(settings) {
    const motions = [];
    for (const [group, items] of Object.entries(settings.FileReferences.Motions || {})) {
      items.forEach((item, index) => {
        const option = new Option(`${group} · ${index + 1}`, `${group}:${index}`);
        option.dataset.group = group; option.dataset.index = index; motions.push(option);
      });
    }
    $('companion-motion').replaceChildren(...(motions.length ? motions : [new Option('No motions included', '')]));
    $('companion-motion').disabled = $('play-motion').disabled = !motions.length;
    const expressions = settings.FileReferences.Expressions || [];
    $('companion-expression').replaceChildren(new Option('Default', ''), ...expressions.map(item => new Option(item.Name, item.Name)));
    $('companion-expression').disabled = !expressions.length;
    $('model-controls').hidden = false;
  }
  setSize(size) {
    this.size = Math.max(140, Math.min(360, Number(size) || 240));
    $('companion-size').value = this.size;
    $('live2d-stage').closest('.companion').style.setProperty('--companion-size', `${this.size}px`);
    this.renderer?.resize();
  }
  react(state) { this.state = state; this.renderer?.react(state); }
  async persist() {
    if (!this.modelPackage) return false;
    try {
      await writeCompanionSave({ files: this.files, paths: this.files.map(file => file.webkitRelativePath || file.name), manifestPath: this.manifestPath, preferences: { size: this.size } });
      return true;
    } catch { return false; }
  }
  releaseCurrent() {
    this.renderer?.destroy(); this.renderer = null;
    this.modelPackage?.dispose(); this.modelPackage = null;
  }
  async reset() {
    ++this.generation;
    if (this.pending) {
      this.pending.renderer.destroy(); this.pending.modelPackage.dispose(); this.pending.host.remove(); this.pending = null;
    }
    this.releaseCurrent(); this.files = []; this.candidateFiles = []; this.manifestPath = null;
    $('live2d-stage').hidden = true;
    $('live2d-stage').closest('.companion').classList.remove('has-live2d');
    $('companion-image').hidden = false;
    $('model-controls').hidden = $('model-selector-row').hidden = true;
    this.busy(false);
    this.status('Original companion active. Imported files stay on this device.');
    try { await clearCompanionSave(); }
    catch { this.status('Original companion restored for this visit. The browser could not clear its saved model.', true); }
  }
  async restore() {
    const generation = this.generation;
    try {
      const [saved, core] = await Promise.all([readCompanionSave(), readCoreSave()]);
      if (generation !== this.generation) return;
      this.coreFile = core;
      if (core) $('core-status').textContent = 'Saved Cubism Core available · local runtime';
      if (!saved?.files?.length) return;
      const files = saved.files.map((file, index) => {
        Object.defineProperty(file, 'webkitRelativePath', { value: saved.paths[index], configurable: true }); return file;
      });
      this.files = files;
      this.candidateFiles = files;
      const manifests = discoverModelManifests(files);
      $('model-selector').replaceChildren(...manifests.map(path => new Option(path, path)));
      $('model-selector').value = saved.manifestPath;
      $('model-selector-row').hidden = manifests.length < 2;
      this.setSize(saved.preferences?.size);
      await this.load(files, saved.manifestPath, true);
    } catch { if (generation === this.generation) this.status('Saved companion unavailable. Import your model folder again.', true); }
  }
}
