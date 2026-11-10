import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { run } from '../src/pdf2html/process.mjs';

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'qpdf-test-'));
  const previousTmp = process.env.TMPDIR;
  process.env.TMPDIR = root;
  const command = path.join(root, 'qpdf'), input = path.join(root, 'input.pdf');
  fs.writeFileSync(input, 'sentinel');
  fs.writeFileSync(command, `#!${process.execPath}\n${String.raw`
const fs=require('fs');
const mode=process.argv[2];
if(mode==='types') { const dir=fs.readdirSync(process.env.TMPDIR).find(name=>name.startsWith('pdf2html-qpdf-'));process.stdout.write(JSON.stringify({out:fs.fstatSync(1).isFile(),err:fs.fstatSync(2).isFile(),files:fs.readdirSync(require('path').join(process.env.TMPDIR,dir)).sort(),input:fs.readFileSync(process.argv[3],'utf8'),cwd:process.cwd(),env:process.env.TEST_VALUE})); }
if(mode==='binary') process.stdout.write(Buffer.from([0,255,128,65]));
if(mode==='warning') {process.stderr.write('operation succeeded with warnings');process.exitCode=3;}
if(mode==='error') {process.stderr.write('broken');process.exitCode=3;}
if(mode==='stdout' || mode==='stderr') {process[mode].write(Buffer.alloc(10000));setInterval(()=>{},1000);}
if(mode==='hang') {process.on('SIGTERM',()=>{});process.stdout.write('ready');setInterval(()=>{},1000);}
`}`);
  fs.chmodSync(command, 0o700);
  t.after(() => { if (previousTmp === undefined) delete process.env.TMPDIR; else process.env.TMPDIR = previousTmp; fs.rmSync(root, { recursive: true, force: true }); });
  return { root, command, input };
}
const leftovers = () => new Set(fs.readdirSync(os.tmpdir()).filter(name => name.startsWith('pdf2html-qpdf-')));

test('QPDF uses regular output files, preserves input, cwd, environment and binary bytes', async t => {
  const f = await fixture(t), before = leftovers();
  const value = JSON.parse((await run(f.command, ['types', f.input], { cwd: f.root, env: { ...process.env, TEST_VALUE: 'value' } })).stdout);
  assert.deepEqual(value, { out: true, err: true, files: ['error.json','output.json'], input: 'sentinel', cwd: fs.realpathSync(f.root), env: 'value' });
  assert.deepEqual((await run(f.command, ['binary'], { encoding: 'buffer' })).stdout, Buffer.from([0,255,128,65]));
  assert.equal(fs.readFileSync(f.input, 'utf8'), 'sentinel'); assert.deepEqual(leftovers(), before);
});

test('warning exit and nonzero errors preserve output and cause', async t => {
  const f = await fixture(t);
  assert.equal((await run(f.command, ['warning'])).warning, true);
  await assert.rejects(run(f.command, ['error']), error => error.cause.code === 3 && error.cause.stderr === 'broken');
  await assert.rejects(run(path.join(f.root, 'missing', 'qpdf'), []), error => error.cause.code === 'ENOENT');
});

test('limits apply independently to both streams and leave no capture directories', async t => {
  const f = await fixture(t), before = leftovers();
  for (const stream of ['stdout','stderr']) await assert.rejects(run(f.command, [stream], { maxBuffer: 100 }), error => error.cause.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER');
  assert.deepEqual(leftovers(), before);
});

test('timeout and abort terminate an uncooperative child, and pre-abort does not spawn', async t => {
  const f = await fixture(t), before = leftovers(), controller = new AbortController();
  await assert.rejects(run(f.command, ['hang'], { timeout: 500 }), error => error.cause.killed && error.cause.signal === 'SIGKILL');
  setTimeout(() => controller.abort(), 500);
  await assert.rejects(run(f.command, ['hang'], { signal: controller.signal }), error => error.cause.code === 'ABORT_ERR' && error.cause.signal === 'SIGKILL');
  await assert.rejects(run(f.command, ['types', f.input], { signal: controller.signal }), error => error.cause.code === 'ABORT_ERR');
  assert.deepEqual(leftovers(), before);
});

test('concurrent captures are separate and cleanup failures are reported', async t => {
  const f = await fixture(t), before = leftovers();
  const values = await Promise.all(Array.from({length: 3}, () => run(f.command, ['binary'], { encoding: 'buffer' })));
  for (const value of values) assert.deepEqual(value.stdout, Buffer.from([0,255,128,65]));
  assert.deepEqual(leftovers(), before);
  const original = fs.rmdirSync; let retained;
  fs.rmdirSync = function(directory, ...args) { if (path.basename(directory).startsWith('pdf2html-qpdf-')) { retained = directory; throw new Error('injected cleanup failure'); } return original.call(this, directory, ...args); };
  try { await assert.rejects(run(f.command, ['binary']), error => /cleanup failed/.test(error.cause.message)); }
  finally { fs.rmdirSync = original; if (retained) fs.rmSync(retained, { recursive: true, force: true }); }
});
