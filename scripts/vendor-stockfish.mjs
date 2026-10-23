import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Retrieve only the selected engine and its corresponding source, never the
// 205 MB npm package containing every engine flavor. No npm lifecycle scripts.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'dist/vendor/stockfish/manifest.json'), 'utf8'));
const verifyOnly = process.argv.includes('--verify');
const hash = data => createHash('sha256').update(data).digest('hex');

for (const artifact of manifest.artifacts) {
  const target = path.join(root, artifact.path);
  let existing;
  try { existing = await readFile(target); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing) {
    if (hash(existing) !== artifact.sha256) {
      throw new Error(`${artifact.path} differs from the pinned upstream artifact; inspect it before replacing it.`);
    }
    console.log(`Verified ${artifact.path} (${existing.length} bytes)`);
    continue;
  }
  if (verifyOnly) throw new Error(`Missing ${artifact.path}`);
  const response = await fetch(artifact.url);
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${artifact.url}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (hash(data) !== artifact.sha256) throw new Error(`Upstream checksum mismatch: ${artifact.url}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, data, { flag: 'wx' });
  console.log(`Vendored ${artifact.path} (${data.length} bytes)`);
}
