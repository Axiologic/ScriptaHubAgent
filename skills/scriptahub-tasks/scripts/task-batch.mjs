import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {constants} from 'node:fs';

const types = new Set(['manuscript','book-proposal','add-book','edit']);
const terminal = new Set(['completed','failed','cancelled']);
const identifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const itemRunId = (batchId,taskId) => 'scripta-' + crypto.createHash('sha256').update(JSON.stringify([batchId,taskId])).digest('hex');

async function directory(root,relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current,part);
    await fs.mkdir(current,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    if (!(await fs.lstat(current)).isDirectory()) throw new Error('Batch directories must not be symlinks');
  }
}
async function readState(filename, limit = 4096) {
  const handle = await fs.open(filename,constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > limit) throw new Error('Invalid batch state');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}

async function ensureHandoff(root, result, fresh) {
  const {task,taskDirectory,claimedPath,handoffPath,processingSettings} = result;
  const keys = ['executionId','runId','taskId','bookId'];
  if (keys.some(key=>!identifier(task[key]))) throw new Error('Invalid claimed task identity');
  const read = async () => {
    const saved = await readState(path.join(root,handoffPath),32768);
    if (keys.some(key=>saved.context?.[key]!==task[key])) throw new Error('Handoff belongs to another execution');
  };
  try { await read(); return; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  // Missing context is bootstrapped only for a new claim in a pristine item directory.
  // A resumed execution may already have pinned sources or results: never reconstruct it.
  if (!fresh) throw new Error('Existing execution is missing its durable handoff; restore it before resuming');
  const entries = await fs.readdir(path.join(root,taskDirectory));
  const stateEntries = await fs.readdir(path.join(root,taskDirectory,'run-state'));
  if (entries.some(name=>name!=='run-state') || stateEntries.length) throw new Error('Cannot initialize a handoff over existing task artifacts');
  const context = Object.fromEntries(keys.map(key=>[key,task[key]]));
  Object.assign(context,{task,taskDirectory,claimedPath,processingSettings,
    repositories:task.repositories || [],serviceState:task.state});
  if (Buffer.byteLength(JSON.stringify(context))>24000) throw new Error('Initial handoff exceeds 24 KB');
  const temporary = path.join(root,handoffPath)+'.'+crypto.randomUUID()+'.tmp';
  try {
    await fs.writeFile(temporary,JSON.stringify({step:'select-task',context,updatedAt:new Date().toISOString()})+'\n',{flag:'wx',mode:0o600});
    // Publish a complete file without replacing a handoff created concurrently.
    await fs.link(temporary,path.join(root,handoffPath)).catch(error=>{if(error.code!=='EEXIST')throw error;});
    await read();
  } finally { await fs.rm(temporary,{force:true}); }
}

// The flow owns traversal. This helper only persists its batch identity and calls
// ScriptaHub's authenticated reservation/claim APIs; it never launches workflows.
export async function runBatchOperation(call,operation,input,{root=process.cwd()}={}) {
  root = await fs.realpath(root);
  await directory(root,'run-state');
  const filename = path.join(root,'run-state/task-batch.json');
  const persist = async replace => {
    const state = {batchId:crypto.randomUUID(),taskType:input.taskType};
    const temp = filename + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fs.writeFile(temp,JSON.stringify(state)+'\n',{flag:'wx',mode:0o600});
      if (replace) await fs.rename(temp,filename);
      else await fs.link(temp,filename).catch(error=>{if(error.code!=='EEXIST')throw error;});
    } finally { await fs.rm(temp,{force:true}); }
  };
  if (operation === 'batch-start') {
    if (!types.has(input.taskType)) throw new Error('Provide manuscript, book-proposal, add-book or edit taskType');
    await persist(false);
  }
  let state = await readState(filename);
  const upgradingBookBatch = operation === 'batch-start' && state.taskType === 'manuscript' && input.taskType === 'add-book';
  if (!identifier(state.batchId) || !types.has(state.taskType) || input.taskType && input.taskType !== state.taskType && !upgradingBookBatch) throw new Error('Batch identity mismatch');
  if (operation === 'batch-close') return call('scriptahub_task_batch_close',{batchId:state.batchId,...(input.retainActive === true ? {retainActive:true} : {})});
  let snapshot = await call('scriptahub_task_batch_snapshot',state);
  if (operation === 'batch-status') return snapshot;
  if (operation === 'batch-defer') {
    const item=snapshot.items?.find(item=>item.taskId===input.taskId && item.executionId===input.executionId && !item.released);
    if (snapshot.closed || !identifier(input.taskId) || !identifier(input.executionId) || !item || !['running','stop_requested'].includes(item.state) || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length>1000) throw new Error('Defer only an identified active item from this open batch with its actual reason');
    return call('scriptahub_task_batch_settle',{batchId:state.batchId,taskId:item.taskId,runId:item.runId,executionId:item.executionId,defer:true,reason:input.reason});
  }
  // A Cron job reuses its run folder, so a batch an earlier run closed is replaced
  // by a new one. An open or paused batch is resumed, never replaced.
  if (operation === 'batch-start' && snapshot.closed === true) {
    await persist(true);
    state = await readState(filename);
    snapshot = await call('scriptahub_task_batch_snapshot',state);
  }
  if (operation === 'batch-start') return snapshot;
  if (operation !== 'batch-next') throw new Error('Unknown batch operation');
  if (!Array.isArray(snapshot.items)) throw new Error('ScriptaHub did not return the reserved batch items');
  if (snapshot.closed) return {batchId:state.batchId,task:null,closed:true};
  for (const item of snapshot.items) {
    if (!identifier(item.taskId)) throw new Error('Invalid reserved task identity');
    if (item.released) continue;
    const runId = itemRunId(state.batchId,item.taskId);
    if (item.runId && item.runId !== runId) throw new Error('Reserved task belongs to a different execution');
    if (terminal.has(item.state)) {
      await call('scriptahub_task_batch_settle',{batchId:state.batchId,taskId:item.taskId,runId});
      continue;
    }
    const taskDirectory = 'tasks/' + item.taskId;
    if (item.deferredExecutionId) continue;
    if (item.publicationPending) {
      if (!identifier(item.executionId)) throw new Error('Invalid pending publication identity');
      return {batchId:state.batchId,publicationPending:true,executionId:item.executionId,taskDirectory};
    }
    await directory(root,taskDirectory);
    const claimed = await call('scriptahub_task_claim',{...state,taskId:item.taskId,runId});
    if (!claimed.task) throw new Error('Reserved task could not be claimed');
    if (claimed.task.taskId!==item.taskId || claimed.task.runId!==runId
      || item.executionId && claimed.task.executionId!==item.executionId) throw new Error('Claimed execution does not match the reserved item');
    await directory(root,taskDirectory+'/run-state');
    const claimedPath = taskDirectory+'/run-state/claimed.json';
    const handoffPath = taskDirectory+'/run-state/handoff.json';
    const result = {...claimed,batchId:state.batchId,taskDirectory,claimedPath,handoffPath};
    await ensureHandoff(root,result,item.state==='queued' && !item.executionId);
    const temporary = path.join(root,claimedPath)+'.'+crypto.randomUUID()+'.tmp';
    try {
      await fs.writeFile(temporary,JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});
      await fs.rename(temporary,path.join(root,claimedPath));
    } finally { await fs.rm(temporary,{force:true}); }
    return result;
  }
  return {...await call('scriptahub_task_batch_close',{batchId:state.batchId,...(snapshot.deferred?.length ? {retainActive:true} : {})}),task:null,...(snapshot.deferred?.length ? {deferred:snapshot.deferred} : {})};
}
