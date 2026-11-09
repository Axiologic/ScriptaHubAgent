import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { isMain } from './asset-inventory.mjs';

// Regenerates audio-models.json: the immutable revision, size and SHA-256 of every Kokoro,
// Qwen and Piper model file. Run it deliberately to change the audio models; the image
// builds never resolve a branch or a release by themselves.

const HF = 'https://huggingface.co';
const QWEN_REPOSITORY = 'Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice';
const PIPER_REPOSITORY = 'rhasspy/piper-voices';
const KOKORO_SOURCE = 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/';
const KOKORO_FILES = ['kokoro-v1.0.onnx', 'voices-v1.0.bin'];
const PIPER_ENGINE = 'piper-tts==1.4.2';
const REVISION = /^[0-9a-f]{40}$/;
const HEX64 = /^[0-9a-f]{64}$/;
const headers = { 'user-agent': 'scriptahub-pin-audio-models/1' };

const byPath = (a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);

async function request(fetch, url) {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`);
  return response;
}

// Streams a file through the hash; nothing is kept in memory or on disk.
async function hashRemote(fetch, url) {
  const response = await request(fetch, url);
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; hash.update(chunk); }
  if (!bytes) throw new Error(`Empty download: ${url}`);
  return { bytes, sha256: hash.digest('hex') };
}

async function huggingFaceRevision(fetch, repository, given) {
  if (given) {
    if (!REVISION.test(given)) throw new Error(`Invalid revision for ${repository}: ${given}`);
    return given;
  }
  const { sha } = await (await request(fetch, `${HF}/api/models/${repository}`)).json();
  if (!REVISION.test(sha || '')) throw new Error(`${repository} did not report a commit`);
  return sha;
}

async function huggingFaceTree(fetch, repository, revision) {
  const entries = [];
  for (let url = `${HF}/api/models/${repository}/tree/${revision}?recursive=true`; url;) {
    const response = await request(fetch, url);
    entries.push(...await response.json());
    url = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') || '')?.[1] || null;
  }
  return entries;
}

async function qwen(fetch, revision) {
  const files = [];
  for (const entry of await huggingFaceTree(fetch, QWEN_REPOSITORY, revision)) {
    if (entry.type === 'directory') continue;
    // Hidden names (.gitattributes, .cache) are not model files; the audio fingerprint skips them too.
    if (entry.path.split('/').some(segment => segment.startsWith('.'))) continue;
    const url = `${HF}/${QWEN_REPOSITORY}/resolve/${revision}/${entry.path}`;
    if (entry.lfs) {
      if (!HEX64.test(entry.lfs.oid || '') || !Number.isSafeInteger(entry.lfs.size) || entry.lfs.size <= 0) throw new Error(`Invalid LFS record: ${entry.path}`);
      files.push({ path: entry.path, bytes: entry.lfs.size, sha256: entry.lfs.oid, url });
    } else files.push({ path: entry.path, ...await hashRemote(fetch, url), url });
  }
  if (!files.length) throw new Error(`${QWEN_REPOSITORY} has no files at ${revision}`);
  return { repository: QWEN_REPOSITORY, revision, mode: 'custom', target: 'skills/theatrical-audio/models/qwen-custom', files: files.sort(byPath) };
}

async function kokoro(fetch) {
  const files = [];
  for (const name of KOKORO_FILES) files.push({ path: name, ...await hashRemote(fetch, KOKORO_SOURCE + name), url: KOKORO_SOURCE + name });
  return { source: KOKORO_SOURCE, target: 'skills/theatrical-audio/models/kokoro', files: files.sort(byPath) };
}

// setup_piper.py pins one repository revision, takes the .onnx and .onnx.json of the voice
// from the catalogue and the MODEL_CARD beside them. The catalogue's size and MD5 are
// checked here, and the SHA-256 the runtime verifies is recorded.
async function piper(fetch, revision, voice) {
  const base = `${HF}/${PIPER_REPOSITORY}/resolve/${revision}/`;
  const entry = (await (await request(fetch, `${base}voices.json`)).json())[voice];
  if (!entry) throw new Error(`Voice is absent from the Piper catalogue: ${voice}`);
  const selected = Object.keys(entry.files).filter(key => key.endsWith('.onnx') || key.endsWith('.onnx.json'));
  if (selected.length !== 2) throw new Error('Expected exactly one Piper model and configuration');
  const files = [];
  for (const relative of selected) {
    const response = await request(fetch, base + relative);
    const sha256 = createHash('sha256'), md5 = createHash('md5');
    let bytes = 0;
    for await (const chunk of response.body) { bytes += chunk.length; sha256.update(chunk); md5.update(chunk); }
    const catalogue = entry.files[relative];
    if (bytes !== catalogue.size_bytes || md5.digest('hex') !== catalogue.md5_digest) throw new Error(`Downloaded file differs from the Piper catalogue: ${relative}`);
    files.push({ path: path.posix.basename(relative), bytes, sha256: sha256.digest('hex'), url: base + relative });
  }
  const card = `${path.posix.dirname(selected[0])}/MODEL_CARD`;
  files.push({ path: 'MODEL_CARD', ...await hashRemote(fetch, base + card), url: base + card });
  return { repository: PIPER_REPOSITORY, revision, voice, engine: PIPER_ENGINE,
    target: `skills/theatrical-audio/runtime/piper/models/${voice}`, files: files.sort(byPath) };
}

export async function pinAudioModels({ fetch = globalThis.fetch, qwenRevision, piperRevision, voice } = {}) {
  if (!voice) voice = JSON.parse(await fs.readFile(new URL('./skills-runtime.json', import.meta.url), 'utf8')).piperVoice;
  const qwenPinned = await huggingFaceRevision(fetch, QWEN_REPOSITORY, qwenRevision);
  const piperPinned = await huggingFaceRevision(fetch, PIPER_REPOSITORY, piperRevision);
  return { schemaVersion: 1, engines: {
    kokoro: await kokoro(fetch),
    qwen: await qwen(fetch, qwenPinned),
    piper: await piper(fetch, piperPinned, voice),
  } };
}

if (isMain(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: { 'qwen-revision': { type: 'string' }, 'piper-revision': { type: 'string' }, write: { type: 'string' } }, allowPositionals: false });
    const pinned = await pinAudioModels({ qwenRevision: values['qwen-revision'], piperRevision: values['piper-revision'] });
    const text = JSON.stringify(pinned, null, 2) + '\n';
    if (values.write) await fs.writeFile(path.resolve(values.write), text); else process.stdout.write(text);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
