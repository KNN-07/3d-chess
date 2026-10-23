/** Resolve a user-selected Cubism 3+ folder without fetching external resources. */
export const MAX_MODEL_PACKAGE_BYTES = 150 * 1024 * 1024;
const MAX_FILES = 5000;
const MAX_MANIFEST_BYTES = 5 * 1024 * 1024;
const MODEL_SUFFIX = /\.model3\.json$/i;
const OPTIONAL_FILES = ['Physics', 'Pose', 'DisplayInfo', 'UserData', 'MotionSync'];
const REFERENCE_KEYS = new Set(['Moc', 'Textures', 'Expressions', 'Motions', ...OPTIONAL_FILES]);

export class ModelPackageError extends Error {
  constructor(message, code = 'INVALID_MODEL_PACKAGE', details = {}) {
    super(message);
    this.name = 'ModelPackageError';
    this.code = code;
    Object.assign(this, details);
  }
}

function fail(message, code, details) { throw new ModelPackageError(message, code, details); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }

function safePathText(value, label, decode = false) {
  if (typeof value !== 'string' || !value.length || value.trim() !== value) {
    fail(`${label} must be a non-empty relative file path.`);
  }
  let path = value;
  if (decode) {
    try { path = decodeURIComponent(path); }
    catch { fail(`${label} contains invalid URL encoding.`, 'UNSAFE_PATH'); }
  }
  path = path.replaceAll('\\', '/').normalize('NFC');
  if (/^[a-z][a-z\d+.-]*:/i.test(path) || path.startsWith('/') || /[\u0000-\u001f\u007f?#:]/.test(path)) {
    fail(`${label} must stay inside the selected folder; URLs, absolute paths, queries and fragments are not allowed.`, 'UNSAFE_PATH');
  }
  return path;
}

function inventoryPath(value) {
  const path = safePathText(value, 'File path');
  const parts = path.split('/');
  if (parts.includes('..')) fail(`File path "${value}" contains a parent-directory escape.`, 'UNSAFE_PATH');
  const normalized = parts.filter(part => part && part !== '.').join('/');
  if (!normalized) fail('A selected file has an empty path.', 'UNSAFE_PATH');
  return normalized;
}

function indexPackage(files) {
  if (!files || typeof files === 'string' || typeof files[Symbol.iterator] !== 'function') {
    fail('Choose the complete exported Live2D model folder, including its .model3.json, .moc3 and textures.');
  }
  const list = Array.from(files);
  if (!list.length) fail('The selected folder is empty. Choose a folder containing an exported .model3.json model.', 'EMPTY_PACKAGE');
  if (list.length > MAX_FILES) fail(`This folder contains too many files. Choose only the model folder (${MAX_FILES} files maximum).`, 'PACKAGE_TOO_LARGE');
  const entries = new Map(), folded = new Map();
  let total = 0;
  for (const file of list) {
    if (!file || typeof file.text !== 'function' || typeof file.arrayBuffer !== 'function' || !Number.isSafeInteger(file.size) || file.size < 0) {
      fail('The selected package must contain browser File objects.');
    }
    total += file.size;
    if (total > MAX_MODEL_PACKAGE_BYTES) fail('This model folder exceeds the 150 MB size limit. Choose a smaller exported model folder.', 'PACKAGE_TOO_LARGE');
    const path = inventoryPath(file.webkitRelativePath || file.name);
    const key = path.toLowerCase();
    if (folded.has(key)) fail(`Duplicate or ambiguous file path: "${path}" and "${folded.get(key)}". Keep one uniquely named copy.`, 'AMBIGUOUS_PATH');
    folded.set(key, path);
    entries.set(path, file);
  }
  const paths = [...entries.keys()];
  const firstRoot = paths[0].includes('/') ? paths[0].split('/')[0] : '';
  const root = firstRoot && paths.every(path => path.startsWith(`${firstRoot}/`)) ? [firstRoot] : [];
  return {entries, root, manifests: paths.filter(path => MODEL_SUFFIX.test(path)).sort()};
}

function requireManifests(index) {
  if (index.manifests.length) return index.manifests;
  if ([...index.entries.keys()].some(path => /\.model\.json$/i.test(path))) {
    fail('This is a legacy Cubism 2 model (.model.json). Export a Cubism 3 or newer model containing .model3.json and .moc3 files.', 'LEGACY_MODEL');
  }
  fail('No .model3.json was found. Choose the complete exported Cubism 3 or newer model folder, rather than only its textures or project source.', 'MANIFEST_NOT_FOUND');
}

/** Return sorted package-relative manifest paths for a model-selection menu. */
export function discoverModelManifests(files) {
  return [...requireManifests(indexPackage(files))];
}

function resolveReference(reference, manifestPath, root, entries, label) {
  const path = safePathText(reference, label, true);
  const parts = manifestPath.split('/').slice(0, -1);
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (parts.length <= root.length) fail(`${label} escapes the selected model folder: "${reference}".`, 'UNSAFE_PATH');
      parts.pop();
    } else parts.push(part);
  }
  const resolved = parts.join('/');
  if (!entries.has(resolved)) {
    fail(`Missing model asset "${resolved}" (${label}). Select the complete folder and preserve the original file names and subfolders.`, 'MISSING_ASSET', {path: resolved, field: label});
  }
  if (!entries.get(resolved).size) fail(`Model asset "${resolved}" is empty (${label}). Re-export or restore that file.`, 'EMPTY_ASSET');
  return resolved;
}

function mimeType(path) {
  const extension = path.split('.').at(-1).toLowerCase();
  return ({json:'application/json', png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', webp:'image/webp', wav:'audio/wav', mp3:'audio/mpeg', ogg:'audio/ogg', m4a:'audio/mp4'})[extension] || 'application/octet-stream';
}

/**
 * Construct Cubism4ModelSettings(result.settings), then set that instance's
 * resolveURL = result.resolveURL before passing it to Live2DModel.from(). Pixi's
 * legacy URL resolver corrupts blob:http(s) URLs, so this override is required.
 * settings.url is a synthetic absolute base required by ModelSettings; it is
 * never fetched. Keep this package alive for lazy motion/expression loading.
 * Destroy the model before calling dispose().
 */
export async function createModelPackage(files, manifestPath) {
  const index = indexPackage(files);
  const manifests = requireManifests(index);
  if (manifestPath === undefined) {
    if (manifests.length > 1) {
      fail('This folder contains multiple models. Choose which .model3.json to open.', 'MANIFEST_SELECTION_REQUIRED', {manifests: [...manifests]});
    }
    manifestPath = manifests[0];
  } else manifestPath = inventoryPath(manifestPath);
  if (!MODEL_SUFFIX.test(manifestPath)) fail('Choose a .model3.json manifest. Legacy .model.json models are not supported.', 'LEGACY_MODEL');
  if (!manifests.includes(manifestPath)) fail(`The selected model manifest "${manifestPath}" is not in this folder.`, 'MANIFEST_NOT_FOUND');
  const manifest = index.entries.get(manifestPath);
  if (manifest.size > MAX_MANIFEST_BYTES) fail('The model manifest exceeds the 5 MB limit. Choose the exported .model3.json file.', 'MANIFEST_TOO_LARGE');
  let settings;
  try { settings = JSON.parse((await manifest.text()).replace(/^\uFEFF/, '')); }
  catch { fail(`"${manifestPath}" is not valid JSON. Re-export the Live2D model.`, 'INVALID_MANIFEST'); }
  if (!record(settings) || settings.Version !== 3 || !record(settings.FileReferences)) {
    fail('The manifest must be an exported Cubism 3+ .model3.json with format Version 3 and FileReferences.', 'INVALID_MANIFEST');
  }
  const references = settings.FileReferences;
  for (const key of Object.keys(references)) {
    if (!REFERENCE_KEYS.has(key)) fail(`Unsupported FileReferences field "${key}". This importer supports standard Cubism model3 packages.`, 'UNSUPPORTED_REFERENCE');
  }
  // Validate every declared reference before allocating any object URLs.
  const replacements = [];
  const add = (object, key, label, optional = false) => {
    if (optional && (object[key] === undefined || object[key] === '')) { delete object[key]; return; }
    const path = resolveReference(object[key], manifestPath, index.root, index.entries, label);
    replacements.push({object, key, path});
    return path;
  };
  const moc = add(references, 'Moc', 'FileReferences.Moc');
  if (!/\.moc3$/i.test(moc)) fail('The model binary must be a .moc3 file. Cubism 2 .moc files are not supported.', 'LEGACY_MODEL');
  if (!Array.isArray(references.Textures) || !references.Textures.length) fail('FileReferences.Textures must contain at least one texture path.', 'INVALID_MANIFEST');
  references.Textures.forEach((_, i) => add(references.Textures, i, `FileReferences.Textures[${i}]`));
  OPTIONAL_FILES.forEach(key => add(references, key, `FileReferences.${key}`, true));
  if (references.Expressions !== undefined) {
    if (!Array.isArray(references.Expressions)) fail('FileReferences.Expressions must be an array.', 'INVALID_MANIFEST');
    references.Expressions.forEach((expression, i) => {
      if (!record(expression) || typeof expression.Name !== 'string' || !expression.Name) fail(`Expression ${i + 1} must have a Name and File.`, 'INVALID_MANIFEST');
      add(expression, 'File', `FileReferences.Expressions[${i}].File`);
    });
  }
  if (references.Motions !== undefined) {
    if (!record(references.Motions)) fail('FileReferences.Motions must contain named motion arrays.', 'INVALID_MANIFEST');
    for (const [group, motions] of Object.entries(references.Motions)) {
      if (!Array.isArray(motions)) fail(`Motion group "${group}" must be an array.`, 'INVALID_MANIFEST');
      motions.forEach((motion, i) => {
        if (!record(motion)) fail(`Motion "${group}" ${i + 1} must have a File.`, 'INVALID_MANIFEST');
        add(motion, 'File', `FileReferences.Motions.${group}[${i}].File`);
        add(motion, 'Sound', `FileReferences.Motions.${group}[${i}].Sound`, true);
      });
    }
  }
  const urls = new Map();
  const ownedURLs = new Set();
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const url of urls.values()) URL.revokeObjectURL(url);
    urls.clear();
    ownedURLs.clear();
  };
  const resolveURL = url => {
    if (disposed) fail('This model package has been disposed. Import the model again.', 'PACKAGE_DISPOSED');
    if (!ownedURLs.has(url)) fail('The model requested a resource outside its imported folder.', 'UNSAFE_PATH');
    return url;
  };
  try {
    for (const {object, key, path} of replacements) {
      if (!urls.has(path)) {
        const file = index.entries.get(path);
        const url = URL.createObjectURL(new Blob([file], {type: mimeType(path)}));
        urls.set(path, url);
        ownedURLs.add(url);
      }
      object[key] = urls.get(path);
    }
    settings.url = `https://local-model.invalid/${manifestPath.split('/').map(encodeURIComponent).join('/')}`;
    return {settings, manifests: [...manifests], manifestPath, name: manifestPath.split('/').at(-1).replace(MODEL_SUFFIX, ''), resolveURL, dispose};
  } catch (error) {
    dispose();
    throw error;
  }
}
