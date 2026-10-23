import test from 'node:test';
import assert from 'node:assert/strict';
import {File} from 'node:buffer';
import {createModelPackage, discoverModelManifests, MAX_MODEL_PACKAGE_BYTES} from '../dist/model-package.js';

function file(path, content = 'asset') {
  const value = new File([content], path.split('/').at(-1));
  Object.defineProperty(value, 'webkitRelativePath', {value: path});
  return value;
}
function manifest(references = {}) {
  return {Version: 3, FileReferences: {Moc: 'avatar.moc3', Textures: ['textures/body.png'], ...references}, Groups: [{Target: 'Parameter', Name: 'EyeBlink', Ids: ['ParamEyeLOpen']}]};
}
function packageFiles(settings = manifest(), path = 'Avatar/avatar.model3.json') {
  const dir = path.slice(0, path.lastIndexOf('/') + 1);
  return [file(path, JSON.stringify(settings)), file(`${dir}avatar.moc3`, 'moc-data'), file(`${dir}textures/body.png`, 'texture-data')];
}

test('rewrites all nested assets, preserves metadata, and produces usable blobs', async () => {
  const original = manifest({Physics:'physics.json', Pose:'pose.json', DisplayInfo:'display.json', UserData:'userdata.json', MotionSync:'sync.json', Expressions:[{Name:'Happy', File:'expressions/happy.json'}], Motions:{Idle:[{File:'motions/idle.json', Sound:'../shared/hello%20world.wav', FadeInTime:.2}], Tap:[{File:'motions/idle.json', Sound:''}]}});
  const files = packageFiles(original, 'Bundle/models/avatar.model3.json');
  for (const path of ['physics.json','pose.json','display.json','userdata.json','sync.json','expressions/happy.json','motions/idle.json']) files.push(file(`Bundle/models/${path}`, path));
  files.push(file('Bundle/shared/hello world.wav', 'sound-data'));
  const result = await createModelPackage(files);
  try {
    const refs = result.settings.FileReferences;
    const urls = [refs.Moc, ...refs.Textures, refs.Physics, refs.Pose, refs.DisplayInfo, refs.UserData, refs.MotionSync, refs.Expressions[0].File, refs.Motions.Idle[0].File, refs.Motions.Idle[0].Sound];
    urls.forEach(url => assert.match(url, /^blob:/));
    assert.equal(await (await fetch(refs.Moc)).text(), 'moc-data');
    assert.equal(await (await fetch(refs.Motions.Idle[0].Sound)).text(), 'sound-data');
    assert.equal((await fetch(refs.Textures[0])).headers.get('content-type'), 'image/png');
    assert.equal(refs.Motions.Idle[0].File, refs.Motions.Tap[0].File, 'one URL per physical asset');
    assert.equal('Sound' in refs.Motions.Tap[0], false, 'empty optional sounds are omitted');
    assert.equal(refs.Motions.Idle[0].FadeInTime, .2);
    assert.deepEqual(result.settings.Groups, original.Groups);
    assert.equal(original.FileReferences.Moc, 'avatar.moc3');
    assert.equal(result.name, 'avatar');
    assert.equal(result.manifestPath, 'Bundle/models/avatar.model3.json');
    assert.equal(result.settings.url, 'https://local-model.invalid/Bundle/models/avatar.model3.json');
    assert.equal(result.resolveURL(refs.Moc), refs.Moc, 'the instance resolver preserves owned blob URLs unchanged');
    assert.equal(new URL(refs.Moc, result.settings.url).href, refs.Moc);
    assert.throws(() => result.resolveURL('https://example.com/external.moc3'), {code:'UNSAFE_PATH'});
    assert.throws(() => result.resolveURL('blob:https://example.com/not-owned'), {code:'UNSAFE_PATH'});
  } finally { result.dispose(); }
});

test('multiple manifests require explicit selection and resolve from the selected directory', async () => {
  const files = [...packageFiles(manifest(), 'Models/A/avatar.model3.json'), ...packageFiles(manifest(), 'Models/B/avatar.model3.json')];
  assert.deepEqual(discoverModelManifests(files), ['Models/A/avatar.model3.json','Models/B/avatar.model3.json']);
  await assert.rejects(createModelPackage(files), error => error.code === 'MANIFEST_SELECTION_REQUIRED' && error.manifests.length === 2);
  const result = await createModelPackage(files, 'Models/B/avatar.model3.json');
  assert.equal(result.manifestPath, 'Models/B/avatar.model3.json');
  result.dispose();
  await assert.rejects(createModelPackage(files, 'Models/C/avatar.model3.json'), {code:'MANIFEST_NOT_FOUND'});
});

test('plain File names and UTF-8 BOM manifests work without a folder prefix', async () => {
  const settings = manifest({Textures:['body.png']});
  const result = await createModelPackage([new File(['\uFEFF'+JSON.stringify(settings)], 'avatar.model3.json'), new File(['moc'], 'avatar.moc3'), new File(['png'], 'body.png')]);
  assert.equal(result.name, 'avatar');result.dispose();
});

test('reports missing required and declared optional assets before allocating URLs', async t => {
  const allocate = t.mock.method(URL, 'createObjectURL');
  await assert.rejects(createModelPackage(packageFiles().filter(f => !f.name.endsWith('.moc3'))), {code:'MISSING_ASSET',field:'FileReferences.Moc'});
  await assert.rejects(createModelPackage(packageFiles(manifest({Physics:'missing.json'}))), {code:'MISSING_ASSET',field:'FileReferences.Physics'});
  assert.equal(allocate.mock.calls.length, 0);
});

test('rejects network URLs, absolute paths, encoded traversal and package-root escapes', async () => {
  for (const path of ['https://example.com/a.moc3','//example.com/a.moc3','blob:example','data:application/octet-stream,x','C:\\avatar.moc3','/avatar.moc3','../../escape.moc3','..\\..\\escape.moc3','%2e%2e/%2e%2e/escape.moc3','avatar.moc3?url=x','avatar.moc3#fragment','%00avatar.moc3']) {
    await assert.rejects(createModelPackage(packageFiles(manifest({Moc:path}))), {code:'UNSAFE_PATH'}, path);
  }
  await assert.rejects(createModelPackage([file('../avatar.model3.json', '{}')]), {code:'UNSAFE_PATH'});
});

test('allows relative parent paths that remain inside the chosen root', async () => {
  const files = packageFiles(manifest({Moc:'../shared/avatar.moc3',Textures:['./textures\\body.png']}), 'Bundle/model/avatar.model3.json');
  files.push(file('Bundle/shared/avatar.moc3', 'shared-model'));
  const result = await createModelPackage(files);
  assert.equal(await (await fetch(result.settings.FileReferences.Moc)).text(), 'shared-model');result.dispose();
});

test('rejects duplicate, normalized duplicate and case-ambiguous package paths', () => {
  for (const paths of [['A/model.model3.json','A/model.model3.json'],['A/x/./model.model3.json','A/x/model.model3.json'],['A/model.model3.json','A/MODEL.model3.json']]) {
    assert.throws(() => discoverModelManifests(paths.map(path => file(path,'{}'))), {code:'AMBIGUOUS_PATH'});
  }
});

test('rejects empty, legacy, oversized and malformed exports with useful errors', async () => {
  assert.throws(() => discoverModelManifests([]), {code:'EMPTY_PACKAGE'});
  assert.throws(() => discoverModelManifests([file('old.model.json','{}')]), {code:'LEGACY_MODEL'});
  assert.throws(() => discoverModelManifests([file('texture.png')]), {code:'MANIFEST_NOT_FOUND'});
  const oversized = file('large.model3.json','{}');Object.defineProperty(oversized,'size',{value:MAX_MODEL_PACKAGE_BYTES+1});
  await assert.rejects(createModelPackage([oversized]), {code:'PACKAGE_TOO_LARGE'});
  await assert.rejects(createModelPackage([file('avatar.model3.json','{broken')]), {code:'INVALID_MANIFEST'});
  await assert.rejects(createModelPackage(packageFiles({...manifest(),Version:2})), {code:'INVALID_MANIFEST'});
  await assert.rejects(createModelPackage(packageFiles(manifest({Textures:[]}))), {code:'INVALID_MANIFEST'});
  await assert.rejects(createModelPackage(packageFiles(manifest({Motions:{Idle:[{}]}}))), /non-empty relative file path/);
});

test('dispose revokes owned URLs exactly once and prevents further asset reads', async t => {
  const revoke = t.mock.method(URL,'revokeObjectURL');
  const result = await createModelPackage(packageFiles());
  const url = result.settings.FileReferences.Moc;
  result.dispose();result.dispose();
  assert.equal(revoke.mock.calls.length, 2);
  assert.throws(() => result.resolveURL(url), {code:'PACKAGE_DISPOSED'});
  await assert.rejects(fetch(url));
});

test('partial URL allocation failures revoke URLs already created', async t => {
  const original = URL.createObjectURL.bind(URL);
  let count = 0;
  t.mock.method(URL,'createObjectURL', blob => {if (++count === 2) throw new Error('allocation failed');return original(blob);});
  const revoke = t.mock.method(URL,'revokeObjectURL');
  await assert.rejects(createModelPackage(packageFiles()), /allocation failed/);
  assert.equal(revoke.mock.calls.length, 1);
});
