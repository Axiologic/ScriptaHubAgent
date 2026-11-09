import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { assertPlatform, currentPlatform, expectedAssets, hashFile, isMain, loadInventory } from './asset-inventory.mjs';

// Read-only check of an assets tree against the committed inventories. The tree may come
// from any image: --exact refuses every file, link or special entry outside the inventory,
// so an assets image cannot carry code or inventory files into the robot.
const HEX64 = /^[0-9a-f]{64}$/;
const BUILT = ['docling.node', 'lib/libpdfium.so'];

const tryStat = async file => {
  try { return await fs.lstat(file); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
};

async function walk(root) {
  const found = [];
  async function visit(relative) {
    for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isSymbolicLink()) throw new Error(`Asset symlink refused: ${name}`);
      if (entry.isDirectory()) await visit(name);
      else found.push({ name, regular: entry.isFile() });
    }
  }
  if (await tryStat(root)) await visit('');
  return found;
}

// Same rule as install-built-native.mjs: the receipt is bound to the declared source and
// platform, and each compiled binary must match the size and hash it records.
async function verifyNative({ config, nativeBuildRoot, platform, exact }) {
  const label = name => `native-build/${name}`;
  if (platform !== 'linux-x64') {
    const entries = await tryStat(nativeBuildRoot) ? await fs.readdir(nativeBuildRoot) : [];
    if (entries.length) throw new Error(`Unexpected asset: ${label(entries.sort()[0])}`);
    return { files: 0, bytes: 0 };
  }
  const receiptFile = path.join(nativeBuildRoot, 'receipt.json');
  const receiptStat = await tryStat(receiptFile);
  if (!receiptStat) throw new Error(`Asset missing: ${label('receipt.json')}`);
  if (receiptStat.isSymbolicLink()) throw new Error(`Asset symlink refused: ${label('receipt.json')}`);
  const receipt = JSON.parse(await fs.readFile(receiptFile, 'utf8'));
  if (receipt.platform !== platform || receipt.sourceRevision !== config.nativeAssetSource.revision)
    throw new Error('Native build source or platform does not match the declared runtime');
  let files = 1, bytes = receiptStat.size;
  for (const name of BUILT) {
    const recorded = receipt.files?.[name];
    if (!recorded || !Number.isSafeInteger(recorded.bytes) || recorded.bytes <= 0 || !HEX64.test(recorded.sha256 || ''))
      throw new Error(`Native build receipt has no record of ${name}`);
    const file = path.join(nativeBuildRoot, platform, name);
    const stat = await tryStat(file);
    if (!stat) throw new Error(`Asset missing: ${label(`${platform}/${name}`)}`);
    if (stat.isSymbolicLink()) throw new Error(`Asset symlink refused: ${label(`${platform}/${name}`)}`);
    if (!stat.isFile()) throw new Error(`Asset missing: ${label(`${platform}/${name}`)}`);
    const actual = await hashFile(file);
    if (JSON.stringify(actual) !== JSON.stringify({ bytes: recorded.bytes, sha256: recorded.sha256 })) throw new Error(`Native build checksum mismatch: ${name}`);
    files++; bytes += actual.bytes;
  }
  const notices = (await walk(path.join(nativeBuildRoot, platform, 'notices'))).filter(entry => entry.regular);
  if (!notices.length) throw new Error(`Asset missing: ${label(`${platform}/notices/`)}`);
  if (exact) {
    const allowed = new Set(['receipt.json', ...BUILT.map(name => `${platform}/${name}`)]);
    for (const entry of await walk(nativeBuildRoot)) {
      if (!entry.regular || !(allowed.has(entry.name) || entry.name.startsWith(`${platform}/notices/`))) throw new Error(`Unexpected asset: ${label(entry.name)}`);
    }
  }
  return { files, bytes };
}

export async function verifyAssets({ skillsDir, runtimeRoot, nativeBuildRoot, platform = currentPlatform(), exact = false, deploymentDir }) {
  assertPlatform(platform);
  const inventory = await loadInventory({ skillsDir, ...(deploymentDir ? { deploymentDir } : {}) });
  const expected = expectedAssets({ ...inventory, platform });
  let files = 0, bytes = 0;
  for (const [relative, entry] of [...expected].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const file = path.join(runtimeRoot, relative);
    const stat = await tryStat(file);
    if (!stat) throw new Error(`Asset missing: ${relative}`);
    if (stat.isSymbolicLink()) throw new Error(`Asset symlink refused: ${relative}`);
    if (!stat.isFile()) throw new Error(`Asset missing: ${relative}`);
    const actual = await hashFile(file);
    if (actual.bytes !== entry.bytes || actual.sha256 !== entry.sha256) throw new Error(`Asset checksum mismatch: ${relative}`);
    files++; bytes += actual.bytes;
  }
  const native = await verifyNative({ config: inventory.config, nativeBuildRoot, platform, exact });
  if (exact) {
    for (const entry of await walk(runtimeRoot)) if (!entry.regular || !expected.has(entry.name)) throw new Error(`Unexpected asset: ${entry.name}`);
  }
  return { files: files + native.files, bytes: bytes + native.bytes };
}

if (isMain(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      skills: { type: 'string' }, runtime: { type: 'string' }, 'native-build': { type: 'string' },
      platform: { type: 'string' }, exact: { type: 'boolean' } }, allowPositionals: false });
    if (!values.skills || !values.runtime || !values['native-build']) throw new Error('Usage: verify-assets.mjs --skills DIR --runtime DIR --native-build DIR [--platform linux-x64|linux-arm64] [--exact]');
    const platform = values.platform || currentPlatform();
    const result = await verifyAssets({ skillsDir: path.resolve(values.skills), runtimeRoot: path.resolve(values.runtime),
      nativeBuildRoot: path.resolve(values['native-build']), platform, exact: Boolean(values.exact) });
    console.log(`ScriptaHub assets verified: ${result.files} files, ${result.bytes} bytes (${platform})`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
