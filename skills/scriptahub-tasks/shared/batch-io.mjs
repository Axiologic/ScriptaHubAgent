import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {constants} from 'node:fs';

export const object = properties => ({type:'object',properties,required:Object.keys(properties),additionalProperties:false});
export const string = {type:'string',minLength:1,pattern:'\\S'};
export const list = (items,minItems=0,extra={}) => ({type:'array',items,minItems,...extra});
export const audit = keys => object({...Object.fromEntries(keys.map(key=>[key,{const:true}])),notes:{type:'string'}});
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
// Validate the exact schema supplied to the worker, then the existing native
// validator. This is deliberately limited to the schema keywords emitted here.
export function schemaErrors(value,schema,at='$') {
  const errors=[],bad=message=>errors.push(at+': '+message);
  if(Object.hasOwn(schema,'const')&&JSON.stringify(value)!==JSON.stringify(schema.const))bad('must equal '+JSON.stringify(schema.const));
  if(schema.enum&&!schema.enum.includes(value))bad('expected one of '+JSON.stringify(schema.enum));
  if(schema.type==='object') {
    if(!value||typeof value!=='object'||Array.isArray(value))return [...errors,at+': expected object'];
    for(const key of schema.required)if(!Object.hasOwn(value,key))bad('missing '+key);
    for(const [key,item] of Object.entries(value)) {
      if(!Object.hasOwn(schema.properties,key))bad('unknown field '+key);
      else errors.push(...schemaErrors(item,schema.properties[key],at+'.'+key));
    }
  } else if(schema.type==='array') {
    if(!Array.isArray(value))return [...errors,at+': expected array'];
    if(value.length<schema.minItems||schema.maxItems!==undefined&&value.length>schema.maxItems)bad('invalid item count');
    if(schema.uniqueItems&&new Set(value.map(item=>JSON.stringify(item))).size!==value.length)bad('duplicate items');
    value.forEach((item,i)=>errors.push(...schemaErrors(item,schema.items,at+'['+i+']')));
  } else if(schema.type==='string') {
    if(typeof value!=='string')bad('expected string');
    else if(value.length<(schema.minLength||0)||schema.pattern&&!new RegExp(schema.pattern,'u').test(value))bad('invalid text');
  } else if(schema.type==='number'&&(typeof value!=='number'||!Number.isFinite(value)||value<schema.minimum||value>schema.maximum))bad('invalid number');
  return errors;
}
async function read(file) {
  const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>32*1024*1024)throw Error('Unsafe batch resource');return await handle.readFile();}
  finally {await handle.close();}
}
async function child(directory,name,{optional=false}={}) {
  const result=path.join(directory,name);
  let stat;
  try {stat=await fs.lstat(result);}
  catch(error){if(optional&&error.code==='ENOENT')return null;throw error;}
  if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Unsafe batch directory');
  return result;
}
export async function batchCommand({command,directory,batchName,batchSha256,replaceSha256,payload,skill,schemaFor,validate}) {
  if(!/^batch-[0-9]{4}\.json$/.test(batchName||''))throw Error('Use --batch with an exact batch-NNNN.json name');
  const dir=await fs.realpath(directory),job=JSON.parse(await read(path.join(dir,'job.json')));
  if(!(job.batchNames||job.batches||[]).includes(batchName))throw Error('Batch does not belong to this job');
  const batches=await child(dir,'batches'),batchPath=path.join(batches,batchName),bytes=await read(batchPath),batch=JSON.parse(bytes);
  const sourceHash=job.sourceSha256||job.sourceHash;
  if(!sourceHash||hash(await read(job.source))!==sourceHash)throw Error('Source changed after job preparation');
  const schema=schemaFor(batch);
  const contract={skill,batch:batchName,batchPath,batchSha256:hash(bytes),sourceSha256:sourceHash,
    allowedSourceUnitIds:skill==='translate-html'?schema.properties.units.items.properties.id.enum:batch.units.map(unit=>unit.id),schema,
    instructions:'Read this batch and its context. Use only this schema and these source IDs. Audit true means you actually reviewed the content. Submit the whole JSON through submit-batch; never patch an analysis file. A rejected submission leaves the existing file unchanged. Continue the native lifecycle after acceptance.'};
  const resultName=skill==='translate-html'?'translations':'analyses';
  const existingDir=await child(dir,resultName,{optional:true});
  const target=path.join(dir,resultName,batchName);
  let previous=null;
  if(existingDir) {
    try {previous=await read(target);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  contract.existing=previous?{path:target,sha256:hash(previous)}:null;
  if(command==='batch-contract')return {status:'contract',...contract};
  if(batchSha256!==contract.batchSha256)throw Error('Batch digest mismatch; request batch-contract again before submitting');
  let value;
  try {value=JSON.parse(payload);}catch{return {status:'rejected',errors:['Input must be one JSON object'],contract};}
  let errors=schemaErrors(value,contract.schema);
  if(!errors.length)try {errors=validate(value,batch);}catch(error){errors=[error.message];}
  if(errors.length)return {status:'rejected',errors,contract};
  const encoded=Buffer.from(JSON.stringify(value,null,2)+'\n');
  if(previous) {
    let accepted=false,same=false;
    try {const prior=JSON.parse(previous);accepted=!schemaErrors(prior,contract.schema).length&&!validate(prior,batch).length;same=JSON.stringify(prior)===JSON.stringify(value);}catch{}
    if(accepted&&same)return {status:'accepted',unchanged:true,path:target,sha256:hash(previous)};
    if(replaceSha256!==undefined&&replaceSha256!==hash(previous))return {status:'rejected',errors:['Existing batch digest mismatch; reread batch-contract'],contract};
    if(accepted&&replaceSha256!==hash(previous))return {status:'rejected',errors:['An accepted batch already exists; preserve it or use its exact --replace-sha256 for an evidenced correction'],contract};
  }
  if(replaceSha256&&!previous)return {status:'rejected',errors:['Existing batch digest mismatch; reread batch-contract'],contract};
  // Remote snapshots reconstruct directories from files. Create the result
  // directory only after accepting the payload.
  if(!existingDir) {
    await fs.mkdir(path.join(dir,resultName),{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  }
  const targetDir=await child(dir,resultName);
  const temp=path.join(targetDir,'.submit-'+randomUUID());
  try {
    await fs.writeFile(temp,encoded,{flag:'wx',mode:0o600});
    // Refuse stale local writers and source/batch changes before installation.
    if(hash(await read(batchPath))!==contract.batchSha256||hash(await read(job.source))!==sourceHash)throw Error('Batch or source changed during submission');
    let current=null;try {current=await read(target);}catch(error){if(error.code!=='ENOENT')throw error;}
    if((current===null)!==(previous===null)||current&&hash(current)!==hash(previous))throw Error('Concurrent batch edit; preserve current analysis and retry');
    await fs.rename(temp,target);
  } finally {await fs.rm(temp,{force:true});}
  return {status:'accepted',path:target,sha256:hash(encoded),batchSha256:contract.batchSha256};
}
export async function readSubmission(stream=process.stdin) {
  const chunks=[];let size=0;
  for await(const chunk of stream) {const bytes=Buffer.from(chunk);size+=bytes.length;if(size>65536)throw Error('Batch submission exceeds 64 KiB');chunks.push(bytes);}
  return Buffer.concat(chunks).toString('utf8');
}

export async function handleBatch(command,directory,values,skill,{schemaFor,validate}) {
  return batchCommand({command,directory,batchName:values.batch,batchSha256:values['batch-sha256'],replaceSha256:values['replace-sha256'],
    payload:command==='submit-batch'?await readSubmission():undefined,skill,schemaFor,validate});
}

// Shared schema structure; each skill supplies its own vocabulary and validator.
export const sourceRefs = batch => list({type:'string',enum:batch.units.map(unit=>unit.id)},1);
export const batchIdentity = batch => ({batch:{const:batch.batch},chapterId:{const:batch.chapterId},segment:{const:batch.segment}});
export function editorialSchema(batch,{themeTypes,revelationTypes,collection,itemKind,auditKey}) {
  const refs=sourceRefs(batch);
  const item=(kind,types,guard=false)=>object({
    id:{type:'string',pattern:'^'+batch.batch.slice(0,-5)+'-'+kind+'-[0-9]{3}$'},
    type:{type:'string',enum:[...types]},statement:string,
    ...(guard?{guardTerms:list(string,1)}:{}),sourceUnitIds:refs
  });
  return object({...batchIdentity(batch),modeSignals:list({type:'string',enum:['fiction','nonfiction']},1,{uniqueItems:true}),
    [collection]:list(item(itemKind,themeTypes),1),protectedRevelations:list(item('revelation',revelationTypes,true)),
    audit:audit(['chapterCovered',auditKey,'revelationsSeparated','factsPreserved'])});
}
