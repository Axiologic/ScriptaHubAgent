import fs from 'node:fs/promises';
import { createReadStream, realpathSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// The downloaded model and native files of the ScriptaHub skills runtime. Every file is
// pinned by size and SHA-256 in an inventory that is committed with the sources:
// integrity.json (Docling models and ARM64 natives), native-notices.json, sources.json
// (Eigen archive) and audio-models.json (Kokoro, Qwen, Piper). Nothing is trusted from
// the place the files were fetched or copied from.

const deploymentDirectory = path.dirname(fileURLToPath(import.meta.url));
const PLATFORMS = new Set(['linux-x64', 'linux-arm64']);
const NATIVE = 'skills/pdf2html/external/native';
const PDF_EXTERNAL = 'skills/pdf2html/external';
const HEX64 = /^[0-9a-f]{64}$/;

// True when this module is the program being run; symlinked directories (macOS /var) must not hide it.
export const isMain = metaUrl => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === fileURLToPath(metaUrl); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false; throw error; }
};

export const currentPlatform = () => `${process.platform}-${process.arch}`;

export function assertPlatform(platform) {
  if (!PLATFORMS.has(platform)) throw new Error(`Unsupported asset platform: ${platform}`);
  return platform;
}

export async function hashFile(file) {
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(file)) { bytes += chunk.length; hash.update(chunk); }
  return { bytes, sha256: hash.digest('hex') };
}

const invalidPath = value => new Error(`Invalid asset path: ${String(value)}`);

// A computed path must stay inside the given root (itself inside the runtime root) after
// normalization. A path that is absolute or still climbs out is refused.
function place(root, relative, fence = root) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0') || relative.includes('\\') || path.posix.isAbsolute(relative)) throw invalidPath(relative);
  const resolved = path.posix.normalize(path.posix.join(root, relative));
  if (!resolved.startsWith(`${fence}/`) || resolved.split('/').includes('..')) throw invalidPath(relative);
  return resolved;
}

// Files below an inventory-chosen directory must not climb and must not be hidden (hidden
// names are skipped by the audio fingerprint and by the Hugging Face cache metadata).
function below(root, relative) {
  const resolved = place(root, relative);
  if (relative.split('/').some(segment => segment === '..' || segment.startsWith('.'))) throw invalidPath(relative);
  return resolved;
}

function pinned(entry, label) {
  if (!entry || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0 || !HEX64.test(entry.sha256 || ''))
    throw new Error(`Invalid asset inventory entry: ${label}`);
  return { bytes: entry.bytes, sha256: entry.sha256 };
}

function remote(entry, label) {
  if (typeof entry.url !== 'string' || !/^https:\/\//.test(entry.url)) throw new Error(`Invalid asset inventory entry: ${label}`);
  return entry.url;
}

// Piper's own setup program verifies this receipt before it installs the voice.
export function piperReceipt(engine, byName) {
  const names = Object.keys(byName);
  const onnx = names.find(name => name.endsWith('.onnx'));
  const onnxConfig = names.find(name => name.endsWith('.onnx.json'));
  if (!onnx || !onnxConfig || !byName.MODEL_CARD || names.length !== 3 || names.some(name => name.includes('/'))) throw new Error('Invalid asset inventory entry: piper voice files');
  const sha256 = { [onnx]: byName[onnx].sha256, [onnxConfig]: byName[onnxConfig].sha256, MODEL_CARD: byName.MODEL_CARD.sha256 };
  return Buffer.from(JSON.stringify({ voice: engine.voice, repository: engine.repository, revision: engine.revision,
    sha256, modelCard: 'MODEL_CARD', engine: engine.engine }, null, 2) + '\n');
}

export function expectedAssets({ platform, config, notices, audio, integrity, sources }) {
  assertPlatform(platform);
  const result = new Map();
  const add = (relative, entry, url, generated = null) => {
    if (result.has(relative)) throw new Error(`Duplicate asset path: ${relative}`);
    result.set(relative, { bytes: entry.bytes, sha256: entry.sha256, url, generated });
  };
  const source = config.nativeAssetSource;
  const remoteNative = name => `${source.repository}${source.revision}/${source.path}${name}`;

  for (const [name, entry] of Object.entries(integrity.files || {})) {
    if (name.startsWith('models/')) add(place(NATIVE, name), pinned(entry, name), remote(entry, name));
    else if (platform === 'linux-arm64' && name.startsWith('linux-arm64/')) add(place(NATIVE, name), pinned(entry, name), remoteNative(name));
  }
  for (const notice of notices) add(place(NATIVE, notice.path, PDF_EXTERNAL), pinned(notice, notice.path), remoteNative(notice.path));
  for (const entry of sources) {
    add(place('skills/pdf2html', entry.path, NATIVE), pinned(entry, entry.path), remote(entry, entry.path));
  }

  const engines = audio?.engines || {};
  const wanted = [...config.audioEngines].sort(), found = Object.keys(engines).sort();
  if (JSON.stringify(wanted) !== JSON.stringify(found)) throw new Error('Audio inventory engines differ from skills-runtime.json');
  for (const [name, engine] of Object.entries(engines)) {
    const prefix = 'skills/theatrical-audio/';
    if (typeof engine.target !== 'string' || !engine.target.startsWith(prefix)) throw invalidPath(engine.target);
    const target = place('skills/theatrical-audio', engine.target.slice(prefix.length));
    if (target !== engine.target) throw invalidPath(engine.target);
    if (!Array.isArray(engine.files) || !engine.files.length) throw new Error(`Audio inventory has no files: ${name}`);
    const byName = {};
    for (const file of engine.files) {
      const entry = pinned(file, `${name}/${file?.path}`);
      const relative = below(target, file.path);
      add(relative, entry, remote(file, `${name}/${file.path}`));
      byName[file.path] = entry;
    }
    if (name === 'piper') {
      if (engine.voice !== config.piperVoice) throw new Error('Audio inventory voice differs from skills-runtime.json');
      const generated = piperReceipt(engine, byName);
      add(below(target, 'download.json'), { bytes: generated.length, sha256: createHash('sha256').update(generated).digest('hex') }, null, generated);
    }
  }
  // A file may not also be the directory of another file.
  const directories = new Set();
  for (const relative of result.keys()) for (let dir = path.posix.dirname(relative); dir !== '.'; dir = path.posix.dirname(dir)) directories.add(dir);
  for (const relative of result.keys()) if (directories.has(relative)) throw new Error(`Duplicate asset path: ${relative}`);
  return result;
}

export async function loadInventory({ skillsDir, deploymentDir = deploymentDirectory }) {
  const json = async file => JSON.parse(await fs.readFile(file, 'utf8'));
  const native = path.join(skillsDir, 'pdf2html/external/native');
  return {
    config: await json(path.join(deploymentDir, 'skills-runtime.json')),
    notices: await json(path.join(deploymentDir, 'native-notices.json')),
    audio: await json(path.join(deploymentDir, 'audio-models.json')),
    integrity: await json(path.join(native, 'integrity.json')),
    sources: await json(path.join(native, 'sources/sources.json')),
  };
}
