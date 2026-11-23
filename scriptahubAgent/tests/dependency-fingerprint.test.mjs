import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { skillSource } from '../deployment/skill-source.mjs';
import { INPUTS_PATH, gitBlobId, parseDependencyInputs, dependencyFingerprint, checkoutReader, imageReader } from '../deployment/dependency-fingerprint.mjs';

const repo=path.resolve(import.meta.dirname,'../..');
const GOLDEN='b46a273fb33f3535a42f1244c246494d87596d7214588d45b9bdb74877b40016';
const RUNTIME_ONLY=new Set(['run-skill.mjs','verify-skills.mjs','start.mjs','processing-launch.py','processing-protocol.json','processing-runtime-acceptance.mjs']);
const memory=files=>async file=>{if(!Object.hasOwn(files,file))throw new Error('missing '+file);return Buffer.from(files[file]);};
const tmp=async t=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-fingerprint-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;};
const write=async(root,name,text)=>{await fs.mkdir(path.dirname(path.join(root,name)),{recursive:true});await fs.writeFile(path.join(root,name),text);};

test('golden vector: the shared fixture yields the published fingerprint and blob ids',async()=>{
  const files={[INPUTS_PATH]:`${INPUTS_PATH}\nskills/x/external/html/package-lock.json\n`,'skills/x/external/html/package-lock.json':'{}\n'};
  const result=await dependencyFingerprint(memory(files));
  assert.deepEqual(result.inputs,[{path:INPUTS_PATH,blob:'d67c3732bb949e42f387870a4b7b259d7587f9dd'},
    {path:'skills/x/external/html/package-lock.json',blob:'0967ef424bce6791893e9a57bb952f80fd536e93'}]);
  assert.equal(result.fingerprint,GOLDEN);
  assert.equal(gitBlobId(Buffer.from('{}\n')),'0967ef424bce6791893e9a57bb952f80fd536e93');
});

test('input list validation rejects every malformed shape',()=>{
  const ok=[INPUTS_PATH,'skills/a/b.json'];
  assert.deepEqual(parseDependencyInputs(ok.join('\n')+'\n'),ok);
  const bad=(text,pattern)=>assert.throws(()=>parseDependencyInputs(text),pattern,JSON.stringify(text));
  bad('',/empty/);
  bad(ok.join('\r\n')+'\r\n',/LF/);
  bad(ok.join('\n'),/newline/);
  bad(`${INPUTS_PATH}\n\nskills/a\n`,/blank/);
  bad(`${INPUTS_PATH}\nskills/b\nskills/a\n`,/ascending/);
  bad(`${INPUTS_PATH}\n${INPUTS_PATH}\n`,/ascending/);
  bad(`${INPUTS_PATH}\nskills/../x\n`,/Invalid dependency input path/);
  bad(`${INPUTS_PATH}\nskills/./x\n`,/Invalid dependency input path/);
  bad(`${INPUTS_PATH}\n../x\n`,/Invalid dependency input path/);
  bad(`${INPUTS_PATH}\n/skills/x\n`,/Invalid dependency input path/);
  bad(`${INPUTS_PATH}\nskills/a b\n`,/Invalid dependency input path/);
  bad(`${INPUTS_PATH}\nskills//x\n`,/Invalid dependency input path/);
  bad('skills/a\n',/must list/);
});

test('checkout reader refuses linked, directory and escaping inputs; image reader maps the runtime layout',async t=>{
  const root=await tmp(t);
  await write(root,'skills/a/real.json','{}');await write(root,'outside.json','x');
  await fs.symlink(path.join(root,'outside.json'),path.join(root,'skills/a/link.json'));
  await fs.symlink(path.join(root,'skills/a'),path.join(root,'skills/linked-dir'));
  const read=checkoutReader(root);
  assert.equal((await read('skills/a/real.json')).toString(),'{}');
  await assert.rejects(read('skills/a/link.json'),/not a regular file/);
  await assert.rejects(read('skills/linked-dir/real.json'),/link or non-directory/);
  await assert.rejects(read('skills/a'),/not a regular file/);
  await assert.rejects(read('skills/../outside.json'),/Invalid dependency input path/);
  await assert.rejects(read('skills/a/missing.json'),{code:'ENOENT'});
  const image=await tmp(t);
  await write(image,'dependency-inputs.txt','list');await write(image,'skills/a/real.json','img');
  const mapped=imageReader(image);
  assert.equal((await mapped(INPUTS_PATH)).toString(),'list');
  assert.equal((await mapped('skills/a/real.json')).toString(),'img');
  await assert.rejects(mapped('ScriptaHubAgent/README.md'),/outside the image runtime/);
  await assert.rejects(mapped('skills/../x'),/Invalid dependency input path/);
});

test('the real input list is valid, complete and every input is a regular tracked-layout file',async()=>{
  const listed=parseDependencyInputs(await fs.readFile(path.join(repo,INPUTS_PATH),'utf8'));
  const required=new Set(['skills/theatrical-audio/tools/bootstrap.py','skills/theatrical-audio/tools/setup_piper.py',
    'skills/theatrical-audio/runtime/kokoro.requirements.txt','skills/theatrical-audio/runtime/qwen.requirements.txt']);
  for(const name of Object.keys(await skillSource(path.join(repo,'skills'))))if(/^[^/]+\/external\//.test(name))required.add('skills/'+name);
  for(const name of await fs.readdir(path.join(repo,'scriptahubAgent/deployment')))if(!RUNTIME_ONLY.has(name))required.add('scriptahubAgent/deployment/'+name);
  assert.deepEqual(listed,[...required].sort((a,b)=>a<b?-1:a>b?1:0));
  assert.match((await dependencyFingerprint(checkoutReader(repo))).fingerprint,/^[0-9a-f]{64}$/);
});

test('a source edit keeps the fingerprint and a dependency edit changes it',async t=>{
  const root=await tmp(t);
  const sourceOnly=['skills/pdf2html/src/pdf2html/cli.mjs','skills/pdf2html/SKILL.md','scriptahubAgent/deployment/run-skill.mjs'];
  const dependencies=['skills/doc2pdf/external/runtime/package-lock.json','scriptahubAgent/deployment/qwen-linux-x64.requirements.txt','skills/theatrical-audio/tools/bootstrap.py'];
  for(const name of [...parseDependencyInputs(await fs.readFile(path.join(repo,INPUTS_PATH),'utf8')),...sourceOnly])await write(root,name,await fs.readFile(path.join(repo,name)));
  const measure=async()=>(await dependencyFingerprint(checkoutReader(root))).fingerprint;
  const base=await measure();
  for(const name of sourceOnly){await fs.appendFile(path.join(root,name),'\n// edit\n');assert.equal(await measure(),base,name);}
  for(const name of dependencies) {
    const original=await fs.readFile(path.join(root,name));
    await fs.appendFile(path.join(root,name),'\n# edit\n');assert.notEqual(await measure(),base,name);
    await fs.writeFile(path.join(root,name),original);assert.equal(await measure(),base,name);
  }
});

test('the CLI prints the fingerprint of a repository root and fails with a message on bad input',async t=>{
  const cli=path.join(repo,'scriptahubAgent/deployment/dependency-fingerprint.mjs');
  const expected=(await dependencyFingerprint(checkoutReader(repo))).fingerprint;
  assert.equal(execFileSync(process.execPath,[cli,repo],{encoding:'utf8'}).trim(),expected);
  const empty=await tmp(t);
  assert.throws(()=>execFileSync(process.execPath,[cli,empty],{encoding:'utf8',stdio:'pipe'}),error=>error.status===1&&/dependency fingerprint failed/.test(error.stderr));
  assert.throws(()=>execFileSync(process.execPath,[cli],{encoding:'utf8',stdio:'pipe'}),error=>error.status===1&&/Usage/.test(error.stderr));
});
