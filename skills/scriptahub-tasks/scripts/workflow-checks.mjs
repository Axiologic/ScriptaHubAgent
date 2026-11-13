import {withExecutionLock} from './anchored-files.mjs';
import {guardRemoteBackups} from './remote-skill.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
export async function insideRun(value, { directory = false } = {}) {
  const root = await fs.realpath(process.cwd());
  if (typeof value !== 'string' || !value || path.isAbsolute(value)) throw new Error('Use a path relative to this run');
  const target = path.resolve(root,value);
  if (!target.startsWith(root + path.sep)) throw new Error('Path leaves this run');
  let current = root;
  for (const part of path.relative(root,target).split(path.sep)) {
    current = path.join(current,part);
    if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Run paths must not contain symlinks');
  }
  const stat = await fs.stat(target);
  if (directory ? !stat.isDirectory() : !stat.isFile()) throw new Error('Unexpected artifact type');
  return target;
}
async function jsonArtifact(value) {
  const filename = await insideRun(value);
  if ((await fs.stat(filename)).size > 16*1024*1024) throw new Error('JSON artifact is too large');
  return JSON.parse(await fs.readFile(filename,'utf8'));
}
async function atomicJson(relative, value) {
  const root = await fs.realpath(process.cwd());
  const parts = relative.split('/'); let current = root;
  for (const part of parts.slice(0,-1)) {
    current = path.join(current,part); await fs.mkdir(current,{mode:0o700}).catch(e=>{if(e.code!=='EEXIST')throw e;});
    if (!(await fs.lstat(current)).isDirectory()) throw new Error('Output parent is not a real directory');
  }
  const target = path.join(root,relative), temp = target+'.'+crypto.randomUUID()+'.tmp';
  const bytes = Buffer.from(JSON.stringify(value,null,2)+'\n');
  try { await fs.writeFile(temp,bytes,{flag:'wx',mode:0o600});await fs.rename(temp,target); }
  finally {await fs.rm(temp,{force:true});}
  return {path:relative,sha256:hash(bytes)};
}
function itemArtifact(directory = '.',name) {
  if (directory !== '.' && !/^tasks\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(directory)) throw new Error('Invalid task directory');
  return (directory === '.' ? '' : directory + '/') + 'run-state/' + name;
}
export async function writeHandoff(input) {
  const steps = ['claim-edit','apply-edit','validate-edit','submit-edit','prepare-manuscript','process-content','review-correct','validate-final','publish-result'];
  if (!steps.includes(input.step) || !input.context || typeof input.context !== 'object' || Array.isArray(input.context)) throw new Error('Provide the step and a context object');
  for (const key of ['executionId','runId','taskId','bookId']) if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.context[key] || '')) throw new Error('Invalid handoff identity: '+key);
  const handoffPath = itemArtifact(input.directory,'handoff.json');
  let old = null;
  try { old = await jsonArtifact(handoffPath); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  for (const key of ['executionId','runId','taskId','bookId']) if (old && old.context[key] !== input.context[key]) throw new Error('Handoff belongs to another execution');
  const text = JSON.stringify(input.context);
  if (Buffer.byteLength(text)>24000) throw new Error('Keep handoff context under 24 KB; reference large inventories and reports by path');
  const rejectSecrets = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key,child] of Object.entries(value)) {
      if (/^(token|accessToken|password|secret|secretKey|authorization|cookie|credential)$/i.test(key)) throw new Error('Secrets must not enter a handoff');
      rejectSecrets(child);
    }
  };
  rejectSecrets(input.context);
  return atomicJson(handoffPath,{step:input.step,context:input.context,updatedAt:new Date().toISOString()});
}
export async function preflight(receipt) {
  if (!receipt || receipt.ok !== true || typeof receipt.runtimeId !== 'string' || typeof receipt.platform !== 'string' || !receipt.sourceDigests || !Array.isArray(receipt.checks) || !receipt.checks.length || receipt.checks.some(check => check.status !== 'passed') || !Number.isFinite(Date.parse(receipt.checkedAt))) throw new Error('ScriptaHub runtime preflight failed');
  await atomicJson('run-state/preflight.json',receipt);
  return receipt;
}
export async function verifyPackage(input,{hook=async()=>{}}={}) {
  return withExecutionLock(process.cwd(),input.executionId,async base=>{
  await guardRemoteBackups(base,input.executionId);
  await hook('guarded');
  const root=await insideRun(input.packageRoot,{directory:true}), inventory=await jsonArtifact(input.inventory);
  if(inventory.executionId!==input.executionId || !Array.isArray(inventory.files) || !inventory.files.length)throw new Error('Inventory belongs to another execution or has no files');
  const names=new Set();let bytes=0;
  for(const entry of inventory.files){
    if(typeof entry.path!=='string'||/[\\\0]/.test(entry.path)||entry.path.startsWith('/')||entry.path.split('/').some(p=>!p||p==='.'||p==='..'||p.toLowerCase()==='.git')||names.has(entry.path))throw new Error('Unsafe or duplicate inventory path');
    names.add(entry.path);
    const file=await insideRun(path.relative(process.cwd(),path.join(root,entry.path)));
    const value=await fs.readFile(file);
    if(value.length!==entry.size||hash(value)!==entry.sha256)throw new Error('Inventory differs from package: '+entry.path);
    bytes+=value.length;
  }
  const runGit=async args=>(await execute('git',['-c','core.hooksPath=/dev/null','-c','credential.helper=',...args],{cwd:root,timeout:30000,maxBuffer:8*1024*1024,env:{PATH:process.env.PATH,HOME:os.homedir(),GIT_TERMINAL_PROMPT:'0',GIT_ALLOW_PROTOCOL:'https',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'}})).stdout.trim();
  if(inventory.baseCommit!==null && !/^[a-f0-9]{40}$/.test(inventory.baseCommit || ''))throw new Error('Invalid base commit');
  if(inventory.baseCommit){
    const checkout=await fs.lstat(path.join(root,'.git')).catch(error=>{if(error.code!=='ENOENT')throw error;return null;});
    if(checkout && await runGit(['rev-parse','HEAD'])!==inventory.baseCommit)throw new Error('Package checkout baseline changed');
  }
  // Remote reads remain credential-free and restricted to the actual configured catalogue.
  const catalogue=new URL(input.catalogue);
  if(catalogue.protocol!=='https:'||catalogue.username||catalogue.password||catalogue.port||catalogue.search||catalogue.hash)throw new Error('Invalid catalogue destination');
  const match=/^\/([\w.-]+)\/([\w.-]+)\/(?:blob\/)?(.+)$/.exec(catalogue.pathname);
  if(!['github.com','raw.githubusercontent.com'].includes(catalogue.hostname)||!match||!input.branch||!match[3].startsWith(input.branch+'/')||!/^refs\/heads\/[A-Za-z0-9][A-Za-z0-9._/-]*$/.test('refs/heads/'+input.branch))throw new Error('Catalogue/branch mismatch');
  const collectionPath=match[3].slice(input.branch.length+1);
  if(!names.has(collectionPath))throw new Error('Inventory must contain the catalogue update');
  const collection=JSON.parse(await fs.readFile(path.join(root,collectionPath),'utf8'));
  if(![1,2].includes(collection.schemaVersion)||!Array.isArray(collection.books)||collection.bookCount!==collection.books.length||new Set(collection.books.map(b=>b.id)).size!==collection.books.length||!collection.books.some(b=>b.id===input.bookId))throw new Error('Catalogue structure or task identity is invalid');
  const remote=`https://github.com/${match[1]}/${match[2]}.git`;
  const refs=await runGit(['ls-remote',remote]);
  const head=refs.split('\n').find(line=>line.split('\t')[1]==='refs/heads/'+input.branch)?.split('\t')[0]||null;
  if(!head&&(refs||inventory.baseCommit))throw new Error('The selected destination branch is missing');
  // Keep the validated baseline pinned. ScriptaHub checks whether the current
  // remote tip can accept the package when it actually publishes.
  const report={ok:true,executionId:input.executionId,bookId:input.bookId,fileCount:names.size,bytes,baseCommit:inventory.baseCommit,checkedAt:new Date().toISOString()};
  if(input.audit){
    const audit=await jsonArtifact(input.audit);
    if(!['passed','passed_with_warnings'].includes(audit.status)||!Array.isArray(audit.findings)||audit.findings.some(f=>f.severity==='error'))throw Error('Independent book audit has not passed');
    let scope=audit.scope;
    if(audit.scope==='edition_layout_regression') {
      const claimed=await jsonArtifact(itemArtifact(input.directory,'claimed.json'));
      const generated=['scriptahub.book-proposal','scriptahub.fork'].includes(claimed.task?.type);
      if(claimed.task?.executionId!==input.executionId||claimed.task?.bookId!==input.bookId)throw Error('HTML audit belongs to another task');
      if(generated) {
        if(audit.autoCorrect!==false||audit.errorFindings!==0||audit.existingFindings!==0)throw Error('Generated HTML must pass all integrity checks; baseline defects cannot be accepted as warnings');
        scope='html_layout_integrity';
      } else if(claimed.task?.type!=='scriptahub.edit')throw Error('An uploaded manuscript requires its source-based audit');
      if(!audit.candidate?.file||!names.has(path.relative(root,audit.candidate.file).split(path.sep).join('/')))throw Error('HTML audit candidate is outside the verified package');
      const candidate=await insideRun(path.relative(process.cwd(),audit.candidate.file));
      if(hash(await fs.readFile(candidate))!==audit.candidate.sha256)throw Error('HTML changed after its independent audit');
    } else {
      if(audit.scope!=='layout_and_structure')throw Error('Independent book audit has not passed');
      if(!Array.isArray(audit.documents)||!audit.documents.length||audit.documents.some(doc=>!names.has(path.relative(root,doc.file).split(path.sep).join('/'))))throw Error('Audit documents are outside the verified package');
    }
    report.audit={scope,...(scope==='html_layout_integrity'?{nativeScope:audit.scope,existingFindings:0}:{}),status:audit.status,errorFindings:0,warningFindings:audit.findings.length};
  }
  await atomicJson(itemArtifact(input.directory,'package-check.json'),report);
  return report;
  });
}

export async function requirePreflight(now = Date.now()) {
  let report;
  try { report = await jsonArtifact('run-state/preflight.json'); }
  catch { throw new Error('Run preflight successfully before claiming a manuscript'); }
  const age = now - Date.parse(report.checkedAt);
  if (report.ok !== true || !Number.isFinite(age) || age < 0 || age > 15 * 60 * 1000
      || typeof report.runtimeId !== 'string' || typeof report.platform !== 'string' || !report.sourceDigests || !Array.isArray(report.checks) || report.checks.length < 1 || report.checks.some(check => check.status !== 'passed')) {
    throw new Error('Run preflight successfully before claiming a manuscript');
  }
}
