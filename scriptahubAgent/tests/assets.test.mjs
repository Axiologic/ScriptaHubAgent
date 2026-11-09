import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expectedAssets, hashFile, loadInventory } from '../deployment/asset-inventory.mjs';
import { prepareAssets } from '../deployment/prepare-assets.mjs';
import { verifyAssets } from '../deployment/verify-assets.mjs';

const run = promisify(execFile);
const deployment = path.join(import.meta.dirname, '../deployment');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const pin = (bytes, extra = {}) => ({ bytes: bytes.length, sha256: sha(bytes), ...extra });
const NATIVE = 'skills/pdf2html/external/native';
const REVISION = 'a'.repeat(40);

// A small inventory with the same shape as the committed one. `served` maps URL -> bytes.
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-assets-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const served = new Map();
  const asset = (url, text) => { const bytes = Buffer.from(text); served.set(url, bytes); return { ...pin(bytes), url }; };
  const base = `https://models.test/${REVISION}/skills/native/`;
  const config = { schemaVersion: 1, skills: ['pdf2html'], nativeAssetSource: { repository: 'https://models.test/', revision: REVISION, path: 'skills/native/' },
    audioEngines: ['kokoro', 'qwen', 'piper'], piperVoice: 'en_US-fixture-medium' };
  const arm = name => { const bytes = Buffer.from(`arm ${name}`); served.set(`${base}${name}`, bytes); return pin(bytes); };
  const integrity = { version: 'fixture', files: {
    'models/layout.onnx': asset('https://models.test/layout.onnx', 'layout model'),
    'models/tableformer/decoder.onnx': asset('https://models.test/decoder.onnx', 'decoder model'),
    'models/modèle.onnx': asset('https://models.test/modele.onnx', 'unicode model'),
    'linux-arm64/docling.node': arm('linux-arm64/docling.node'),
    'linux-arm64/lib/libpdfium.so': arm('linux-arm64/lib/libpdfium.so'),
    'darwin-arm64/docling.node': { bytes: 3, sha256: 'b'.repeat(64) },
  } };
  const noticeBytes = Buffer.from('notice text');
  const notices = [
    { path: '../docling-source/LICENSE', ...pin(noticeBytes) },
    { path: 'licenses/crate-1.0/LICENSE', ...pin(noticeBytes) },
    { path: 'linux-arm64/notices/pdfium-LICENSE', ...pin(noticeBytes) },
  ];
  served.set(`${base}../docling-source/LICENSE`, noticeBytes);
  served.set(`${base}licenses/crate-1.0/LICENSE`, noticeBytes);
  served.set(`${base}linux-arm64/notices/pdfium-LICENSE`, noticeBytes);
  const sources = [{ ...asset('https://eigen.test/eigen.zip', 'eigen archive'), sha1: 'x', path: 'external/native/sources/eigen.zip' }];
  const voice = 'en_US-fixture-medium', piperBase = `https://voices.test/${'c'.repeat(40)}/en/en_US/fixture/medium/`;
  const piperFile = name => { const url = `${piperBase}${name}`; return { path: name, ...asset(url, `piper ${name}`), url }; };
  const audio = { schemaVersion: 1, engines: {
    kokoro: { source: 'https://kokoro.test/', target: 'skills/theatrical-audio/models/kokoro', files: [
      { path: 'kokoro.onnx', ...asset('https://kokoro.test/kokoro.onnx', 'kokoro onnx') }, { path: 'voices.bin', ...asset('https://kokoro.test/voices.bin', 'voices') }] },
    qwen: { repository: 'Qwen/Fixture', revision: 'd'.repeat(40), mode: 'custom', target: 'skills/theatrical-audio/models/qwen-custom', files: [
      { path: 'config.json', ...asset('https://qwen.test/config.json', 'qwen config') },
      { path: 'speech_tokenizer/model.safetensors', ...asset('https://qwen.test/tok.safetensors', 'qwen tokenizer') }] },
    piper: { repository: 'rhasspy/piper-voices', revision: 'c'.repeat(40), voice, engine: 'piper-tts==1.4.2',
      target: `skills/theatrical-audio/runtime/piper/models/${voice}`,
      files: [piperFile(`${voice}.onnx`), piperFile(`${voice}.onnx.json`), piperFile('MODEL_CARD')] },
  } };
  const deploymentDir = path.join(root, 'deployment'), skillsDir = path.join(root, 'skills');
  const write = async (file, value) => { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2)); };
  await write(path.join(deploymentDir, 'skills-runtime.json'), config);
  await write(path.join(deploymentDir, 'native-notices.json'), notices);
  await write(path.join(deploymentDir, 'audio-models.json'), audio);
  await write(path.join(skillsDir, 'pdf2html/external/native/integrity.json'), integrity);
  await write(path.join(skillsDir, 'pdf2html/external/native/sources/sources.json'), sources);
  return { root, served, config, integrity, notices, sources, audio, deploymentDir, skillsDir, write,
    runtime: path.join(root, 'assets/runtime'), build: path.join(root, 'assets/native-build'),
    inventory: platform => ({ config, notices, audio, integrity, sources, platform }) };
}

// Serves the fixture URLs with a call counter. `plan` can override a response per URL and call.
function server(f, plan = () => undefined) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(url);
    const override = plan(url, calls.filter(call => call === url).length);
    if (override) return override instanceof Error ? Promise.reject(override) : override;
    if (!f.served.has(url)) return new Response('not found', { status: 404 });
    assert.ok(init.signal instanceof AbortSignal, 'every download carries a timeout');
    return new Response(f.served.get(url));
  };
  return { fetch, calls };
}

const prepare = (f, platform, options = {}) => prepareAssets({ skillsDir: f.skillsDir, runtimeRoot: f.runtime, platform, deploymentDir: f.deploymentDir, retryDelayMs: 0, ...options });
const verify = (f, platform, options = {}) => verifyAssets({ skillsDir: f.skillsDir, runtimeRoot: f.runtime, nativeBuildRoot: f.build, platform, deploymentDir: f.deploymentDir, ...options });

async function x64Build(f, { revision = REVISION } = {}) {
  const files = {};
  for (const name of ['docling.node', 'lib/libpdfium.so']) {
    const bytes = Buffer.from(`compiled ${name}`);
    await f.write(path.join(f.build, 'linux-x64', name), bytes);
    files[name] = pin(bytes);
  }
  await f.write(path.join(f.build, 'linux-x64/notices/docling-LICENSE'), 'notice');
  await f.write(path.join(f.build, 'receipt.json'), { platform: 'linux-x64', sourceRevision: revision, files });
}

test('the expected asset set is built per platform from the committed inventories', async t => {
  const f = await fixture(t);
  const arm = expectedAssets(f.inventory('linux-arm64'));
  const x64 = expectedAssets(f.inventory('linux-x64'));
  assert.ok(arm.has(`${NATIVE}/linux-arm64/docling.node`) && arm.has(`${NATIVE}/linux-arm64/lib/libpdfium.so`));
  assert.ok(![...x64.keys()].some(name => name.includes('/linux-arm64/docling.node') || name.includes('darwin')), 'amd64 natives come from the build stage, never from the inventory');
  assert.equal(arm.get(`${NATIVE}/linux-arm64/docling.node`).url, `https://models.test/${REVISION}/skills/native/linux-arm64/docling.node`);
  assert.equal(arm.get(`${NATIVE}/models/layout.onnx`).url, 'https://models.test/layout.onnx');
  assert.ok(arm.has('skills/pdf2html/external/docling-source/LICENSE'), 'the ../docling-source notice resolves inside the runtime root');
  assert.ok(arm.has(`${NATIVE}/licenses/crate-1.0/LICENSE`) && arm.has(`${NATIVE}/sources/eigen.zip`));
  assert.ok(arm.has('skills/theatrical-audio/models/qwen-custom/speech_tokenizer/model.safetensors'));
  const receipt = arm.get('skills/theatrical-audio/runtime/piper/models/en_US-fixture-medium/download.json');
  assert.equal(receipt.url, null);
  const parsed = JSON.parse(receipt.generated.toString());
  assert.deepEqual(Object.keys(parsed), ['voice', 'repository', 'revision', 'sha256', 'modelCard', 'engine']);
  assert.deepEqual(Object.keys(parsed.sha256), ['en_US-fixture-medium.onnx', 'en_US-fixture-medium.onnx.json', 'MODEL_CARD'], 'receipt keys are file names, not catalogue paths');
  assert.equal(parsed.sha256.MODEL_CARD, sha('piper MODEL_CARD'));
  assert.equal(receipt.generated.toString(), JSON.stringify(parsed, null, 2) + '\n');
  assert.deepEqual(receipt, { ...receipt, ...pin(receipt.generated) });
});

test('platforms other than linux-x64 and linux-arm64 are refused', async t => {
  const f = await fixture(t);
  for (const platform of ['darwin-arm64', 'linux-riscv64']) {
    assert.throws(() => expectedAssets(f.inventory(platform)), /Unsupported asset platform/);
    const common = ['--skills', f.skillsDir, '--runtime', f.runtime, '--platform', platform];
    await assert.rejects(run(process.execPath, [path.join(deployment, 'verify-assets.mjs'), ...common, '--native-build', f.build]),
      error => error.code === 1 && /Unsupported asset platform/.test(error.stderr));
    await assert.rejects(run(process.execPath, [path.join(deployment, 'prepare-assets.mjs'), ...common]),
      error => error.code === 1 && /Unsupported asset platform/.test(error.stderr));
  }
});

test('inventory validation refuses empty engines, empty files, unsafe paths and hidden names', async t => {
  const f = await fixture(t);
  const build = change => { const copy = structuredClone({ config: f.config, notices: f.notices, audio: f.audio, integrity: f.integrity, sources: f.sources, platform: 'linux-arm64' }); change(copy); return copy; };
  assert.throws(() => expectedAssets(build(i => { i.audio.engines.kokoro.files = []; })), /no files/);
  assert.throws(() => expectedAssets(build(i => { i.audio.engines.kokoro.files[0].bytes = 0; })), /Invalid asset inventory entry/);
  assert.throws(() => expectedAssets(build(i => { i.audio.engines.kokoro.files[0].sha256 = 'abc'; })), /Invalid asset inventory entry/);
  assert.throws(() => expectedAssets(build(i => { i.audio.engines.kokoro.files[0].path = '../../etc/x'; })), /Invalid asset path/);
  assert.throws(() => expectedAssets(build(i => { i.audio.engines.kokoro.files[0].path = '/etc/passwd'; })), /Invalid asset path/);
  assert.throws(() => expectedAssets(build(i => { i.audio.engines.kokoro.files[0].path = 'sub/.cache/x'; })), /Invalid asset path/);
  assert.throws(() => expectedAssets(build(i => { i.audio.engines.kokoro.target = 'skills/pdf2html/scripts'; })), /Invalid asset path/);
  assert.throws(() => expectedAssets(build(i => { i.audio.engines.kokoro.target = 'skills/theatrical-audio/../pdf2html/x'; })), /Invalid asset path/);
  assert.throws(() => expectedAssets(build(i => { i.audio.engines.kokoro.files.push({ ...i.audio.engines.kokoro.files[0] }); })), /Duplicate asset path/);
  assert.throws(() => expectedAssets(build(i => { i.audio.engines.kokoro.files.push({ ...i.audio.engines.kokoro.files[0], path: 'kokoro.onnx/inner' }); })), /Duplicate asset path/);
  assert.throws(() => expectedAssets(build(i => { delete i.audio.engines.qwen; })), /engines differ/);
  assert.throws(() => expectedAssets(build(i => { i.audio.engines.extra = i.audio.engines.qwen; })), /engines differ/);
  assert.throws(() => expectedAssets(build(i => { i.audio.engines.piper.voice = 'other'; })), /voice differs/);
  assert.throws(() => expectedAssets(build(i => { i.audio.engines.piper.files.pop(); })), /piper voice files/);
  assert.throws(() => expectedAssets(build(i => { i.audio.engines.kokoro.files[0].url = 'http://plain.test/x'; })), /Invalid asset inventory entry/);
  // Notices may step out of native/ into the sibling docling-source, never out of external/.
  assert.ok(expectedAssets(build(() => {})).has('skills/pdf2html/external/docling-source/LICENSE'));
  assert.throws(() => expectedAssets(build(i => { i.notices[0].path = '../../etc/x'; })), /Invalid asset path/);
  assert.throws(() => expectedAssets(build(i => { i.notices[0].path = '../../../etc/x'; })), /Invalid asset path/);
  assert.throws(() => expectedAssets(build(i => { i.notices[0].path = '/etc/x'; })), /Invalid asset path/);
  assert.throws(() => expectedAssets(build(i => { i.sources[0].path = 'external/native/../../../x'; })), /Invalid asset path/);
  assert.throws(() => expectedAssets(build(i => { i.sources[0].path = 'external/runtime/x.zip'; })), /Invalid asset path/);
  assert.throws(() => expectedAssets(build(i => { i.integrity.files['models/../../x'] = i.integrity.files['models/layout.onnx']; })), /Invalid asset path/);
});

test('hashFile streams the file and reports its size and SHA-256', async t => {
  const f = await fixture(t);
  const file = path.join(f.root, 'blob');
  const bytes = Buffer.alloc(3 * 1024 * 1024 + 17, 7);
  await fs.writeFile(file, bytes);
  assert.deepEqual(await hashFile(file), pin(bytes));
});

test('prepare downloads each missing file once, verifies it, and is idempotent', async t => {
  const f = await fixture(t);
  const first = server(f);
  const result = await prepare(f, 'linux-arm64', { fetch: first.fetch });
  const expected = expectedAssets(f.inventory('linux-arm64'));
  const remote = [...expected.values()].filter(entry => entry.url).length;
  assert.deepEqual(result, { kept: 0, downloaded: remote, generated: 1 });
  assert.equal(first.calls.length, remote);
  assert.deepEqual(await verify(f, 'linux-arm64', { exact: true }), { files: expected.size, bytes: [...expected.values()].reduce((sum, entry) => sum + entry.bytes, 0) });
  assert.equal(await fs.readFile(path.join(f.runtime, `${NATIVE}/models/modèle.onnx`), 'utf8'), 'unicode model', 'a unicode path is written and verified');
  const second = server(f, () => new Error('no network on the second run'));
  assert.deepEqual(await prepare(f, 'linux-arm64', { fetch: second.fetch }), { kept: expected.size, downloaded: 0, generated: 0 });
  assert.equal(second.calls.length, 0);
  assert.deepEqual((await fs.readdir(path.join(f.runtime, NATIVE, 'models'))).filter(name => name.endsWith('.partial')), []);
});

test('prepare keeps valid files, replaces damaged ones and refuses a link or a directory in the way', async t => {
  const f = await fixture(t);
  await prepare(f, 'linux-arm64', { fetch: server(f).fetch });
  const model = path.join(f.runtime, NATIVE, 'models/layout.onnx');
  await fs.writeFile(model, 'tampered');
  const repair = server(f);
  assert.deepEqual(await prepare(f, 'linux-arm64', { fetch: repair.fetch }), { kept: expectedAssets(f.inventory('linux-arm64')).size - 1, downloaded: 1, generated: 0 });
  assert.deepEqual(repair.calls, ['https://models.test/layout.onnx']);
  await fs.rm(model);
  await fs.symlink('/etc/hostname', model);
  await assert.rejects(prepare(f, 'linux-arm64', { fetch: server(f).fetch }), /Asset symlink refused: skills\/pdf2html\/external\/native\/models\/layout\.onnx/);
  await fs.rm(model);
  await fs.mkdir(model);
  await assert.rejects(prepare(f, 'linux-arm64', { fetch: server(f).fetch }), /Unexpected asset: skills\/pdf2html\/external\/native\/models\/layout\.onnx/);
});

test('a checksum mismatch, a truncated or an oversized body is refused once and leaves no partial file', async t => {
  for (const [label, body] of [['different bytes', 'LAYOUT MODEL'], ['truncated', 'layout'], ['oversized', 'layout model plus more']]) {
    const f = await fixture(t);
    const s = server(f, (url, call) => url === 'https://models.test/layout.onnx' ? new Response(body) : undefined);
    await assert.rejects(prepare(f, 'linux-arm64', { fetch: s.fetch }), /Asset checksum mismatch: skills\/pdf2html\/external\/native\/models\/layout\.onnx/, label);
    assert.equal(s.calls.filter(url => url === 'https://models.test/layout.onnx').length, 1, `${label} is never retried`);
    const leftovers = (await fs.readdir(path.join(f.runtime, NATIVE, 'models'), { recursive: true })).filter(name => name.includes('layout'));
    assert.deepEqual(leftovers, [], `${label} leaves nothing behind`);
  }
});

test('an HTTP error is final; a network fault is retried up to three attempts, also in mid-stream', async t => {
  let f = await fixture(t);
  let s = server(f, url => url === 'https://models.test/layout.onnx' ? new Response('gone', { status: 404 }) : undefined);
  await assert.rejects(prepare(f, 'linux-arm64', { fetch: s.fetch }), /Asset download failed \(404\): skills\/pdf2html\/external\/native\/models\/layout\.onnx/);
  assert.equal(s.calls.filter(url => url === 'https://models.test/layout.onnx').length, 1);

  f = await fixture(t);
  const broken = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('lay')); controller.error(new Error('connection reset')); } }));
  s = server(f, (url, call) => url === 'https://models.test/layout.onnx' && call === 1 ? new TypeError('fetch failed') : url === 'https://models.test/layout.onnx' && call === 2 ? broken() : undefined);
  await prepare(f, 'linux-arm64', { fetch: s.fetch });
  assert.equal(s.calls.filter(url => url === 'https://models.test/layout.onnx').length, 3);
  assert.equal(await fs.readFile(path.join(f.runtime, NATIVE, 'models/layout.onnx'), 'utf8'), 'layout model');
  assert.deepEqual((await fs.readdir(path.join(f.runtime, NATIVE, 'models'))).filter(name => name.endsWith('.partial')), []);

  f = await fixture(t);
  s = server(f, url => url === 'https://models.test/layout.onnx' ? new TypeError('fetch failed') : undefined);
  await assert.rejects(prepare(f, 'linux-arm64', { fetch: s.fetch }), /Asset download failed \(.*\): skills\/pdf2html\/external\/native\/models\/layout\.onnx/);
  assert.equal(s.calls.filter(url => url === 'https://models.test/layout.onnx').length, 3);
});

test('a download that stalls is aborted by the per-file timeout and is not left behind', async t => {
  const f = await fixture(t);
  const stalled = () => new Response(new ReadableStream({ start(controller) { controller.enqueue(Buffer.from('lay')); } }));
  const s = server(f, url => url === 'https://models.test/layout.onnx' ? stalled() : undefined);
  await assert.rejects(prepare(f, 'linux-arm64', { fetch: s.fetch, timeoutMs: 100, attempts: 2 }), /Asset download failed/);
  assert.equal(s.calls.filter(url => url === 'https://models.test/layout.onnx').length, 2);
  assert.deepEqual((await fs.readdir(path.join(f.runtime, NATIVE, 'models'))).filter(name => name.includes('layout')), []);
});

test('verify reports the first missing, damaged or truncated file by its runtime path', async t => {
  const f = await fixture(t);
  await prepare(f, 'linux-arm64', { fetch: server(f).fetch });
  const layout = path.join(f.runtime, NATIVE, 'models/layout.onnx');
  const original = await fs.readFile(layout);
  await fs.rm(layout);
  await assert.rejects(verify(f, 'linux-arm64'), /^Error: Asset missing: skills\/pdf2html\/external\/native\/models\/layout\.onnx$/);
  const flipped = Buffer.from(original); flipped[0] ^= 1;
  await fs.writeFile(layout, flipped);
  await assert.rejects(verify(f, 'linux-arm64'), /^Error: Asset checksum mismatch: skills\/pdf2html\/external\/native\/models\/layout\.onnx$/);
  await fs.writeFile(layout, original.subarray(0, 4));
  await assert.rejects(verify(f, 'linux-arm64'), /Asset checksum mismatch: skills\/pdf2html\/external\/native\/models\/layout\.onnx/);
  await fs.writeFile(layout, original);
  await fs.rm(path.join(f.runtime, 'skills/theatrical-audio/models/qwen-custom/speech_tokenizer/model.safetensors'));
  await assert.rejects(verify(f, 'linux-arm64'), /Asset missing: skills\/theatrical-audio\/models\/qwen-custom\/speech_tokenizer\/model\.safetensors/);
});

test('--exact refuses files outside the inventory and every symlink; the default check does not', async t => {
  const f = await fixture(t);
  await prepare(f, 'linux-arm64', { fetch: server(f).fetch });
  await verify(f, 'linux-arm64', { exact: true });
  const extra = path.join(f.runtime, NATIVE, 'integrity.json');
  await fs.writeFile(extra, '{}');
  await verify(f, 'linux-arm64');
  await assert.rejects(verify(f, 'linux-arm64', { exact: true }), /^Error: Unexpected asset: skills\/pdf2html\/external\/native\/integrity\.json$/);
  await fs.rm(extra);
  await fs.writeFile(path.join(f.runtime, 'bin-python.partial'), 'x');
  await assert.rejects(verify(f, 'linux-arm64', { exact: true }), /Unexpected asset: bin-python\.partial/);
  await fs.rm(path.join(f.runtime, 'bin-python.partial'));
  await fs.mkdir(path.join(f.runtime, 'bin'));
  await fs.symlink('/usr/bin/env', path.join(f.runtime, 'bin/python'));
  await assert.rejects(verify(f, 'linux-arm64', { exact: true }), /^Error: Asset symlink refused: bin\/python$/);
  await fs.rm(path.join(f.runtime, 'bin'), { recursive: true });
  const model = path.join(f.runtime, NATIVE, 'models/layout.onnx');
  const bytes = await fs.readFile(model);
  await fs.rm(model);
  await fs.writeFile(path.join(f.root, 'elsewhere'), bytes);
  await fs.symlink(path.join(f.root, 'elsewhere'), model);
  await assert.rejects(verify(f, 'linux-arm64'), /Asset symlink refused: skills\/pdf2html\/external\/native\/models\/layout\.onnx/);
});

test('an AMD64 build is accepted only with its source-bound receipt, matching binaries and notices', async t => {
  const f = await fixture(t);
  await prepare(f, 'linux-x64', { fetch: server(f).fetch });
  await assert.rejects(verify(f, 'linux-x64'), /Asset missing: native-build\/receipt\.json/);
  await x64Build(f);
  const ok = await verify(f, 'linux-x64', { exact: true });
  assert.ok(ok.files > expectedAssets(f.inventory('linux-x64')).size);

  await x64Build(f, { revision: 'b'.repeat(40) });
  await assert.rejects(verify(f, 'linux-x64'), /Native build source or platform does not match the declared runtime/);
  await x64Build(f);
  const receipt = JSON.parse(await fs.readFile(path.join(f.build, 'receipt.json'), 'utf8'));
  await fs.writeFile(path.join(f.build, 'receipt.json'), JSON.stringify({ ...receipt, platform: 'linux-arm64' }));
  await assert.rejects(verify(f, 'linux-x64'), /source or platform/);
  await fs.writeFile(path.join(f.build, 'receipt.json'), JSON.stringify(receipt));
  await fs.writeFile(path.join(f.build, 'linux-x64/docling.node'), 'tampered');
  await assert.rejects(verify(f, 'linux-x64'), /Native build checksum mismatch: docling\.node/);
  await x64Build(f);
  await fs.writeFile(path.join(f.build, 'linux-x64/lib/libpdfium.so'), Buffer.from('compiled lib/libpdfium.so').fill(1));
  await assert.rejects(verify(f, 'linux-x64'), /Native build checksum mismatch: lib\/libpdfium\.so/);
  await x64Build(f);
  await fs.rm(path.join(f.build, 'linux-x64/lib/libpdfium.so'));
  await assert.rejects(verify(f, 'linux-x64'), /Asset missing: native-build\/linux-x64\/lib\/libpdfium\.so/);
  await x64Build(f);
  await fs.rm(path.join(f.build, 'linux-x64/notices'), { recursive: true });
  await assert.rejects(verify(f, 'linux-x64'), /Asset missing: native-build\/linux-x64\/notices\//);
  await x64Build(f);
  await f.write(path.join(f.build, 'linux-x64/run.sh'), '#!/bin/sh');
  await verify(f, 'linux-x64');
  await assert.rejects(verify(f, 'linux-x64', { exact: true }), /Unexpected asset: native-build\/linux-x64\/run\.sh/);
  await fs.rm(path.join(f.build, 'linux-x64/run.sh'));
  await f.write(path.join(f.runtime, `${NATIVE}/linux-x64/docling.node`), 'planted');
  await assert.rejects(verify(f, 'linux-x64', { exact: true }), /Unexpected asset: skills\/pdf2html\/external\/native\/linux-x64\/docling\.node/);
});

test('an ARM64 assets tree has an empty or absent native build', async t => {
  const f = await fixture(t);
  await prepare(f, 'linux-arm64', { fetch: server(f).fetch });
  await verify(f, 'linux-arm64', { exact: true });
  await fs.mkdir(f.build, { recursive: true });
  await verify(f, 'linux-arm64', { exact: true });
  await f.write(path.join(f.build, 'receipt.json'), '{}');
  await assert.rejects(verify(f, 'linux-arm64'), /Unexpected asset: native-build\/receipt\.json/);
});

test('the command line verifies a tree and reports the first error with a non-zero exit', async t => {
  const f = await fixture(t);
  await prepare(f, 'linux-arm64', { fetch: server(f).fetch });
  // The CLIs read the inventories next to themselves, so run copies placed beside the fixture inventories.
  const copy = path.join(f.root, 'cli');
  await fs.mkdir(copy);
  for (const name of ['asset-inventory.mjs', 'verify-assets.mjs']) await fs.copyFile(path.join(deployment, name), path.join(copy, name));
  for (const name of ['skills-runtime.json', 'native-notices.json', 'audio-models.json']) await fs.copyFile(path.join(f.deploymentDir, name), path.join(copy, name));
  const args = ['--skills', f.skillsDir, '--runtime', f.runtime, '--native-build', f.build, '--platform', 'linux-arm64', '--exact'];
  const ok = await run(process.execPath, [path.join(copy, 'verify-assets.mjs'), ...args]);
  assert.match(ok.stdout, /^ScriptaHub assets verified: \d+ files, \d+ bytes \(linux-arm64\)\n$/);
  await fs.rm(path.join(f.runtime, NATIVE, 'models/layout.onnx'));
  await assert.rejects(run(process.execPath, [path.join(copy, 'verify-assets.mjs'), ...args]), error => error.code === 1 && /Asset missing: skills\/pdf2html\/external\/native\/models\/layout\.onnx/.test(error.stderr) && error.stdout === '');
  await assert.rejects(run(process.execPath, [path.join(copy, 'verify-assets.mjs'), '--skills', f.skillsDir]), error => error.code === 1 && /Usage/.test(error.stderr));
});

// pin-audio-models.mjs against a scripted upstream: no network.
function upstream({ md5 = text => createHash('md5').update(text).digest('hex'), lfsOid = sha('qwen weights'), bodies = {} } = {}) {
  const calls = [];
  const qwenSha = 'e'.repeat(40), piperSha = 'f'.repeat(40), voice = 'en_US-fixture-medium';
  const dir = 'en/en_US/fixture/medium';
  const text = { 'config.json': 'qwen config', ...bodies,
    [`${dir}/${voice}.onnx`]: 'piper onnx', [`${dir}/${voice}.onnx.json`]: 'piper json', [`${dir}/MODEL_CARD`]: 'card' };
  const json = (value, init = {}) => new Response(JSON.stringify(value), init);
  const fetch = async (url, init) => {
    calls.push(url);
    assert.ok(init?.headers?.['user-agent'], 'upstream requests identify the tool');
    const u = new URL(url);
    if (u.pathname === '/api/models/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice') return json({ sha: qwenSha });
    if (u.pathname === '/api/models/rhasspy/piper-voices') return json({ sha: piperSha });
    if (u.pathname === `/api/models/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice/tree/${qwenSha}`) {
      assert.equal(u.searchParams.get('recursive'), 'true');
      if (!u.searchParams.has('cursor')) return json([{ type: 'directory', path: 'speech_tokenizer' }, { type: 'file', path: '.gitattributes', size: 9 }],
        { headers: { link: `<${url}&cursor=2>; rel="next"` } });
      return json([{ type: 'file', path: 'config.json', size: 11 }, { type: 'file', path: 'speech_tokenizer/model.safetensors', size: 100, lfs: { oid: lfsOid, size: 1234567 } },
        { type: 'file', path: 'speech_tokenizer/.cache/x', size: 1 }]);
    }
    if (u.pathname === `/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice/resolve/${qwenSha}/config.json`) return new Response(text['config.json']);
    if (u.pathname.startsWith('/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/')) return new Response(`kokoro ${u.pathname.split('/').pop()}`);
    if (u.pathname === `/rhasspy/piper-voices/resolve/${piperSha}/voices.json`) return json({ [voice]: { files: Object.fromEntries(Object.keys(text).filter(key => key.startsWith(dir) && !key.endsWith('MODEL_CARD'))
      .map(key => [key, { size_bytes: text[key].length, md5_digest: md5(text[key]) }])) } });
    const piperPath = u.pathname.replace(`/rhasspy/piper-voices/resolve/${piperSha}/`, '');
    if (text[piperPath] !== undefined && u.pathname.includes(piperSha)) return new Response(text[piperPath]);
    return new Response('missing', { status: 404 });
  };
  return { fetch, calls, qwenSha, piperSha, voice };
}

test('pinning records immutable revisions, sizes and SHA-256 for Kokoro, Qwen and Piper', async t => {
  const f = await fixture(t);
  const u = upstream();
  const pinned = await (await import('../deployment/pin-audio-models.mjs')).pinAudioModels({ fetch: u.fetch, voice: u.voice });
  assert.deepEqual(Object.keys(pinned), ['schemaVersion', 'engines']);
  assert.deepEqual(Object.keys(pinned.engines), ['kokoro', 'qwen', 'piper']);
  const { kokoro, qwen, piper } = pinned.engines;
  assert.deepEqual(kokoro.files.map(file => file.path), ['kokoro-v1.0.onnx', 'voices-v1.0.bin']);
  assert.deepEqual(kokoro.files[0], { path: 'kokoro-v1.0.onnx', ...pin(Buffer.from('kokoro kokoro-v1.0.onnx')),
    url: 'https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.1/kokoro-v1.0.onnx' });
  assert.equal(qwen.revision, u.qwenSha);
  assert.equal(qwen.mode, 'custom');
  assert.equal(qwen.target, 'skills/theatrical-audio/models/qwen-custom');
  assert.deepEqual(qwen.files.map(file => file.path), ['config.json', 'speech_tokenizer/model.safetensors'], 'directories and hidden entries are skipped; the second page is followed');
  assert.deepEqual(qwen.files[1], { path: 'speech_tokenizer/model.safetensors', bytes: 1234567, sha256: sha('qwen weights'),
    url: `https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice/resolve/${u.qwenSha}/speech_tokenizer/model.safetensors` });
  assert.ok(!u.calls.some(url => url.endsWith('model.safetensors')), 'LFS files are not downloaded: their recorded oid is the SHA-256');
  assert.equal(qwen.files[0].sha256, sha('qwen config'));
  assert.equal(piper.revision, u.piperSha);
  assert.equal(piper.engine, 'piper-tts==1.4.2');
  assert.equal(piper.target, `skills/theatrical-audio/runtime/piper/models/${u.voice}`);
  assert.deepEqual(piper.files.map(file => file.path), ['MODEL_CARD', `${u.voice}.onnx`, `${u.voice}.onnx.json`]);
  assert.equal(piper.files[0].sha256, sha('card'));
  // The output is a valid inventory for the helpers.
  const config = { ...f.config, piperVoice: u.voice };
  const expected = expectedAssets({ config, notices: f.notices, audio: pinned, integrity: f.integrity, sources: f.sources, platform: 'linux-arm64' });
  assert.ok(expected.has(`skills/theatrical-audio/runtime/piper/models/${u.voice}/download.json`));
});

test('pinning honours given revisions and refuses a catalogue mismatch, a bad revision or a bad LFS record', async t => {
  const { pinAudioModels } = await import('../deployment/pin-audio-models.mjs');
  const u = upstream();
  const given = { qwenRevision: u.qwenSha, piperRevision: u.piperSha, voice: u.voice };
  await pinAudioModels({ fetch: u.fetch, ...given });
  assert.ok(!u.calls.some(url => url === 'https://huggingface.co/api/models/rhasspy/piper-voices' || url.endsWith('CustomVoice')), 'no revision lookup when the revisions are given');
  await assert.rejects(pinAudioModels({ fetch: u.fetch, ...given, qwenRevision: 'main' }), /Invalid revision/);
  await assert.rejects(pinAudioModels({ fetch: upstream({ md5: () => '0'.repeat(32) }).fetch, ...given }), /differs from the Piper catalogue/);
  await assert.rejects(pinAudioModels({ fetch: upstream({ lfsOid: 'short' }).fetch, ...given }), /Invalid LFS record/);
  await assert.rejects(pinAudioModels({ fetch: u.fetch, ...given, voice: 'en_US-unknown-medium' }), /absent from the Piper catalogue/);
  await assert.rejects(pinAudioModels({ fetch: async () => new Response('', { status: 503 }), ...given }), /Request failed \(503\)/);
});

// The committed inventories, not fixtures.
const repository = path.join(import.meta.dirname, '../..');
const committed = async platform => ({ ...await loadInventory({ skillsDir: path.join(repository, 'skills'), deploymentDir: deployment }), platform });

test('the committed audio inventory is complete, immutable and consistent with the runtime configuration', async () => {
  const { config, audio } = await committed('linux-arm64');
  assert.deepEqual(Object.keys(audio.engines).sort(), config.audioEngines.slice().sort());
  assert.equal(audio.engines.piper.voice, config.piperVoice);
  for (const engine of ['qwen', 'piper']) assert.match(audio.engines[engine].revision, /^[0-9a-f]{40}$/);
  for (const [name, engine] of Object.entries(audio.engines)) {
    assert.ok(engine.files.length > 0, name);
    for (const file of engine.files) {
      assert.match(file.sha256, /^[0-9a-f]{64}$/, `${name}/${file.path}`);
      assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0, `${name}/${file.path}`);
      assert.ok(!file.path.split('/').some(segment => segment.startsWith('.')), file.path);
      assert.match(file.url, /^https:\/\//);
      if (engine.revision) assert.ok(file.url.includes(engine.revision), `${name}/${file.path} is fetched at the pinned revision`);
    }
  }
  assert.deepEqual(audio.engines.kokoro.files.map(file => file.path), ['kokoro-v1.0.onnx', 'voices-v1.0.bin']);
  assert.ok(audio.engines.qwen.files.some(file => file.path === 'model.safetensors') && audio.engines.qwen.files.some(file => file.path === 'speech_tokenizer/model.safetensors'));
});

test('the committed inventories expand for both platforms, and every expected file is outside the skill source fingerprint', async t => {
  const { skillSource } = await import('../deployment/skill-source.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-fingerprint-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const arm = expectedAssets(await committed('linux-arm64')), x64 = expectedAssets(await committed('linux-x64'));
  assert.ok([...arm.keys()].some(name => name.endsWith('linux-arm64/docling.node')) && ![...x64.keys()].some(name => name.includes('/linux-arm64/docling.node') || name.includes('/linux-arm64/lib/')));
  assert.equal([...arm.keys()].filter(name => name.includes('/native/models/')).length, 6);
  assert.equal([...x64.keys()].filter(name => name.includes('/native/licenses/')).length, 389);
  await fs.mkdir(path.join(root, 'pdf2html/scripts'), { recursive: true });
  await fs.writeFile(path.join(root, 'pdf2html/scripts/convert.mjs'), 'source');
  const before = await skillSource(root);
  for (const relative of new Set([...arm.keys(), ...x64.keys(),
    'skills/pdf2html/external/native/linux-x64/docling.node', 'skills/pdf2html/external/native/linux-x64/lib/libpdfium.so', 'skills/pdf2html/external/native/linux-x64/notices/docling-LICENSE'])) {
    assert.ok(relative.startsWith('skills/'), relative);
    const file = path.join(root, relative.slice('skills/'.length));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, 'asset');
  }
  assert.deepEqual(await skillSource(root), before, 'downloaded assets never change the source record the robot is compared with');
});

test('the audio models are handed to the setup programs as prepared directories, never downloaded by the robot', async () => {
  const lines = (await fs.readFile(path.join(deployment, 'prepare-skills.mjs'), 'utf8')).split('\n');
  const start = lines.findIndex(line => line.includes('for(const engine of config.audioEngines)'));
  const loop = lines.slice(start, lines.findIndex((line, index) => index > start && line === '}') + 1).join('\n');
  const [piperBranch, bootstrapBranch] = loop.split('else await');
  assert.match(piperBranch, /setup_piper\.py.*--download/s, 'Piper keeps --download, which installs its Python package from a receipt that is already in place');
  assert.match(bootstrapBranch, /bootstrap\.py/);
  assert.doesNotMatch(bootstrapBranch, /--download/);
  assert.match(bootstrapBranch, /'--models-dir',path\.join\(audio,'models',engine==='qwen' \? 'qwen-custom' : 'kokoro'\)/);
  const audio = JSON.parse(await fs.readFile(path.join(deployment, 'audio-models.json'), 'utf8')).engines;
  assert.equal(audio.qwen.target, 'skills/theatrical-audio/models/qwen-custom');
  assert.equal(audio.kokoro.target, 'skills/theatrical-audio/models/kokoro');
});
