import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import * as core from '../src/core.mjs';
import {handleBatch,schemaErrors,batchCommand} from '../../scriptahub-tasks/shared/batch-io.mjs';
import {schemaFor,validate} from '../src/batch-schema.mjs';
const skill=path.basename(fileURLToPath(new URL('../',import.meta.url)));
const entries={'comprehensive-summary':'comprehensivesummary','marketing-summary':'marketingsummary','short-description':'shortdescription','translate-html':'translatehtml','relevant-keywords':'relevantkeywords'};
async function setup(t) {
  const directory=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'batch-admission-')));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const source=path.join(directory,'book.html'),job=path.join(directory,'job');
  await fs.writeFile(source,'<html lang="en"><head><title>Evidence</title></head><body><main><h1>Evidence and uncertainty</h1><p>People compare available evidence and consider uncertainty before reaching a conclusion about a difficult question.</p><p>Different observations can reveal the strengths and limits of an argument.</p></main></body></html>');
  if(skill==='comprehensive-summary')await fs.writeFile(source,'<html lang="en"><body><main><h1>Evidence</h1><p>'+('People compare available evidence and consider uncertainty before reaching a conclusion. '.repeat(30))+'</p></main></body></html>');
  if(skill==='relevant-keywords')await core.analyze(source,{jobDir:job});
  else await core.prepareJob(source,{jobDir:job,output:path.join(directory,'output.html'),minutes:1,targetLanguage:'ro'});
  const metadata=JSON.parse(await fs.readFile(path.join(job,'job.json'))),name=(metadata.batchNames||metadata.batches)[0];
  const contract=await handleBatch('batch-contract',job,{batch:name},skill,{schemaFor,validate});
  const batch=JSON.parse(await fs.readFile(contract.batchPath));
  function example(schema) {
    if(Object.hasOwn(schema,'const'))return schema.const;
    if(schema.enum)return schema.enum[0];
    if(schema.type==='object')return Object.fromEntries(Object.entries(schema.properties).map(([key,item])=>[key,example(item)]));
    if(schema.type==='array')return Array.from({length:schema.minItems},()=>example(schema.items));
    if(schema.type==='number')return 0.5;
    return 'Supported statement from this batch';
  }
  const value=example(contract.schema);
  if(skill==='relevant-keywords')value.keywords=[{keyword:'Supported statement',unitIds:[batch.units[0].id]}];
  if(value.ideas)value.ideas[0].id=name.slice(0,-5)+'-idea-001';
  if(value.themes)value.themes[0].id=name.slice(0,-5)+'-theme-001';
  if(value.safeHooks)value.safeHooks[0].id=name.slice(0,-5)+'-hook-001';
  if(skill==='translate-html')value.units=batch.units.filter(core.requiresModel).map(unit=>({id:unit.id,translation:unit.source}));
  assert.deepEqual(schemaErrors(value,contract.schema),[]);assert.deepEqual(validate(value,batch),[]);
  const output=path.join(job,skill==='translate-html'?'translations':'analyses',name);
  const submit=(candidate,replaceSha256)=>{
    const payload=typeof candidate==='string'?candidate:JSON.stringify(candidate);
    return new Promise((resolve,reject)=>{
      const child=spawnSync(process.execPath,[fileURLToPath(new URL('../scripts/'+entries[skill]+'.mjs',import.meta.url)),'submit-batch',job,'--batch',name,'--batch-sha256',contract.batchSha256,...(replaceSha256?['--replace-sha256',replaceSha256]:[])],{input:payload,encoding:'utf8'});
      try {resolve({code:child.status,result:JSON.parse(child.stdout)});}catch{reject(Error(child.stderr||child.stdout));}
    });
  };
  return {directory,source,job,name,contract,value,output,submit};
}
test('batch contract binds native schema, exact identity and only current batch IDs',async t=>{
  const f=await setup(t);
  assert.equal(f.contract.skill,skill);
  assert.deepEqual(f.contract.schema,schemaFor(JSON.parse(await fs.readFile(f.contract.batchPath))));
  assert.match(f.contract.sourceSha256,/^[a-f0-9]{64}$/);assert.match(f.contract.batchSha256,/^[a-f0-9]{64}$/);
  const foreign=JSON.stringify(f.value).replaceAll(f.contract.allowedSourceUnitIds[0],'u999999');
  const rejected=await f.submit(foreign);
  assert.equal(rejected.code,1);assert.equal(rejected.result.status,'rejected');
  assert.ok(rejected.result.errors.some(error=>error.includes('expected one of')));
  await assert.rejects(fs.stat(f.output),{code:'ENOENT'});
  await assert.rejects(handleBatch('batch-contract',f.job,{batch:'../job.json'},skill,{schemaFor,validate}),/exact batch/);
  await assert.rejects(handleBatch('batch-contract',f.job,{batch:'batch-9999.json'},skill,{schemaFor,validate}),/does not belong/);
});
test('invalid input never overwrites prior bytes; valid submission is atomic, pretty and idempotent',async t=>{
  const f=await setup(t),original='{"unfinished":true}\n';await fs.writeFile(f.output,original);
  assert.equal((await f.submit('{bad JSON')).result.status,'rejected');
  const bad=structuredClone(f.value);bad.unexpected=true;
  assert.equal((await f.submit(bad)).result.status,'rejected');
  assert.equal(await fs.readFile(f.output,'utf8'),original);
  const sibling=path.join(f.directory,'sibling.json');await fs.writeFile(sibling,'unchanged');
  const accepted=await f.submit(f.value);assert.equal(accepted.code,0);assert.equal(accepted.result.status,'accepted');
  const saved=await fs.readFile(f.output,'utf8');assert.ok(saved.includes('\n  '));assert.deepEqual(JSON.parse(saved),f.value);
  assert.equal((await f.submit(f.value)).result.unchanged,true);
  const different=JSON.parse(JSON.stringify(f.value).replace('Supported statement','Different supported statement'));
  if(skill==='translate-html')different.units[0].translation+=' changed';
  assert.equal((await f.submit(different)).result.status,'rejected');assert.equal(await fs.readFile(f.output,'utf8'),saved);
  assert.equal(await fs.readFile(sibling,'utf8'),'unchanged');
  assert.equal((await f.submit(different,'0'.repeat(64))).result.status,'rejected');
  assert.equal((await f.submit(different,accepted.result.sha256)).result.status,'accepted');
  assert.equal((await f.submit(different,accepted.result.sha256)).result.unchanged,true,'lost acknowledgement retries are idempotent');
  assert.equal((await f.submit(f.value,accepted.result.sha256)).result.status,'rejected','stale correction cannot overwrite newer content');
});
test('source/batch changes and unsafe output paths prevent admission',async t=>{
  const f=await setup(t);
  await assert.rejects(batchCommand({command:'submit-batch',directory:f.job,batchName:f.name,batchSha256:'0'.repeat(64),payload:'{}',skill,schemaFor,validate}),/Batch digest/);
  await fs.appendFile(f.source,'changed');
  await assert.rejects(handleBatch('batch-contract',f.job,{batch:f.name},skill,{schemaFor,validate}),/Source changed/);
});

test('QA regression: atmosphere and foreign revelation citations are rejected before saving',async t=>{
  const f=await setup(t),bad=structuredClone(f.value);bad.themes[0].type='atmosphere';
  const rejected=await f.submit(bad);assert.equal(rejected.code,1);assert.ok(rejected.result.errors.some(error=>error.includes('themes[0].type')));
  const other=structuredClone(f.value);other.protectedRevelations=[{id:f.name.slice(0,-5)+'-revelation-001',type:'twist',statement:'A supported hidden outcome',guardTerms:['a hidden outcome'],sourceUnitIds:['u999999']}];
  assert.equal((await f.submit(other)).result.status,'rejected');
  await assert.rejects(fs.stat(f.output),{code:'ENOENT'});
});

test('stale batch contracts and symbolic-link result paths cannot overwrite content',async t=>{
  const f=await setup(t),bytes=await fs.readFile(f.contract.batchPath);
  await fs.appendFile(f.contract.batchPath,'\n');
  await assert.rejects(f.submit(f.value),/Batch digest mismatch/);
  await fs.writeFile(f.contract.batchPath,bytes);
  const external=path.join(f.directory,'external');await fs.writeFile(external,'preserve');await fs.symlink(external,f.output);
  await assert.rejects(f.submit(f.value),/ELOOP|symbolic|Unsafe/);
  assert.equal(await fs.readFile(external,'utf8'),'preserve');
});

test('frozen reference batch payloads satisfy the live contract and native validator',async()=>{
  const fixtures=new URL('./fixtures/',import.meta.url);let checked=0;
  for(const name of await fs.readdir(fixtures)) {
    if(!name.endsWith('.json'))continue;
    const data=JSON.parse((await fs.readFile(new URL(name,fixtures),'utf8')).replaceAll('__ROOT__','/tmp/frozen-source').replaceAll('__FIXTURE_ROOT__','/tmp/frozen-source'));
    for(const [file,text] of Object.entries(data.files||{})) {
      if(!file.startsWith(skill==='translate-html'?'translations/':'analyses/'))continue;
      const batchText=data.files['batches/'+path.basename(file)];if(!batchText)continue;
      const batch=JSON.parse(batchText),value=JSON.parse(text);
      assert.deepEqual(schemaErrors(value,schemaFor(batch)),[],name+': '+file);
      assert.deepEqual(validate(value,batch),[],name+': '+file);checked++;
    }
  }
  assert.ok(checked>0,'must exercise actual reference batch artifacts');
});
