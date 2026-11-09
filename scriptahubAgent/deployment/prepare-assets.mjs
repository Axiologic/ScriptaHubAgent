import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import { assertPlatform, currentPlatform, expectedAssets, hashFile, isMain, loadInventory } from './asset-inventory.mjs';

// Fills an assets tree. A file that is already present and valid is kept; every other file
// is streamed to disk while it is hashed (models are multi-gigabyte, so nothing is buffered
// whole) and is renamed into place only when its size and SHA-256 match the inventory.

// A checksum failure or a client error is a verdict on the source, never a transient fault.
class AssetRefusal extends Error {}
// Throttling (429) and server errors (5xx) are worth another attempt within the same budget.
class TransientStatus extends Error {
  constructor(status, relative) { super(`Asset download failed (${status}): ${relative}`); this.status = status; }
}

const tryStat = async file => {
  try { return await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
};

async function stream({ fetch, relative, entry, target, timeoutMs }) {
  const partial = `${target}.partial`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${timeoutMs} ms`)), timeoutMs);
  const { signal } = controller;
  try {
    const response = await fetch(entry.url, { signal });
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if (response.status === 429 || response.status >= 500) throw new TransientStatus(response.status, relative);
      throw new AssetRefusal(`Asset download failed (${response.status}): ${relative}`);
    }
    if (!response.body) throw new Error('The response has no body');
    const hash = createHash('sha256');
    let bytes = 0;
    const measure = new Transform({ transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (bytes > entry.bytes) return done(new AssetRefusal(`Asset checksum mismatch: ${relative}`));
      hash.update(chunk); done(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), measure, createWriteStream(partial, { mode: 0o644 }), { signal });
    if (bytes !== entry.bytes || hash.digest('hex') !== entry.sha256) throw new AssetRefusal(`Asset checksum mismatch: ${relative}`);
    await fs.rename(partial, target);
  } finally {
    clearTimeout(timer);
    await fs.rm(partial, { force: true });
  }
}

export async function prepareAssets({ skillsDir, runtimeRoot, platform = currentPlatform(), fetch = globalThis.fetch, deploymentDir,
  attempts = 3, retryDelayMs = 2000, timeoutMs = 3_600_000 }) {
  assertPlatform(platform);
  const inventory = await loadInventory({ skillsDir, ...(deploymentDir ? { deploymentDir } : {}) });
  const expected = expectedAssets({ ...inventory, platform });
  const counts = { kept: 0, downloaded: 0, generated: 0 };
  for (const [relative, entry] of [...expected].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const target = path.join(runtimeRoot, relative);
    const existing = await tryStat(target);
    if (existing?.isSymbolicLink()) throw new Error(`Asset symlink refused: ${relative}`);
    if (existing?.isFile()) {
      const actual = await hashFile(target);
      if (actual.bytes === entry.bytes && actual.sha256 === entry.sha256) { counts.kept++; continue; }
    } else if (existing) throw new Error(`Unexpected asset: ${relative}`);
    await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o755 });
    if (entry.generated) {
      const partial = `${target}.partial`;
      try { await fs.writeFile(partial, entry.generated, { mode: 0o644 }); await fs.rename(partial, target); }
      finally { await fs.rm(partial, { force: true }); }
      counts.generated++; continue;
    }
    if (!entry.url) throw new Error(`Asset missing: ${relative}`);
    for (let attempt = 1; ; attempt++) {
      try { await stream({ fetch, relative, entry, target, timeoutMs }); break; }
      catch (error) {
        if (error instanceof AssetRefusal) throw error;
        if (attempt >= attempts) {
          if (error instanceof TransientStatus) throw error;
          throw new Error(`Asset download failed (${error.cause?.code || error.name}): ${relative}: ${error.message}`);
        }
        if (retryDelayMs) await delay(retryDelayMs * attempt);
      }
    }
    counts.downloaded++;
  }
  return counts;
}

if (isMain(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { skills: { type: 'string' }, runtime: { type: 'string' }, platform: { type: 'string' } }, allowPositionals: false });
    if (!values.skills || !values.runtime) throw new Error('Usage: prepare-assets.mjs --skills DIR --runtime DIR [--platform linux-x64|linux-arm64]');
    const platform = values.platform || currentPlatform();
    const result = await prepareAssets({ skillsDir: path.resolve(values.skills), runtimeRoot: path.resolve(values.runtime), platform });
    console.log(`ScriptaHub assets prepared: ${result.kept} kept, ${result.downloaded} downloaded, ${result.generated} generated (${platform})`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
