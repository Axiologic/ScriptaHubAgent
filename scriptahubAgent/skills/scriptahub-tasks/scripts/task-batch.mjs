import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import {constants} from 'node:fs';

const types = new Set(['manuscript','edit']);
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
async function readState(filename) {
  const handle = await fs.open(filename,constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if ((await handle.stat()).size > 4096) throw new Error('Invalid batch state');
    return JSON.parse(await handle.readFile('utf8'));
  } finally { await handle.close(); }
}

// The flow owns traversal. This helper only persists its batch identity and calls
// ScriptaHub's authenticated reservation/claim APIs; it never launches workflows.
export async function runBatchOperation(call,operation,input,{root=process.cwd()}={}) {
  root = await fs.realpath(root);
  await directory(root,'run-state');
  const filename = path.join(root,'run-state/task-batch.json');
  if (operation === 'batch-start') {
    if (!types.has(input.taskType)) throw new Error('Provide manuscript or edit taskType');
    const state = {batchId:crypto.randomUUID(),taskType:input.taskType};
    const temp = filename + '.' + crypto.randomUUID() + '.tmp';
    try {
      await fs.writeFile(temp,JSON.stringify(state)+'\n',{flag:'wx',mode:0o600});
      await fs.link(temp,filename).catch(error=>{if(error.code!=='EEXIST')throw error;});
    } finally { await fs.rm(temp,{force:true}); }
  }
  const state = await readState(filename);
  if (!identifier(state.batchId) || !types.has(state.taskType) || input.taskType && input.taskType !== state.taskType) throw new Error('Batch identity mismatch');
  if (operation === 'batch-close') return call('scriptahub_task_batch_close',{batchId:state.batchId});
  const snapshot = await call('scriptahub_task_batch_snapshot',state);
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
    await directory(root,taskDirectory);
    const claimed = await call('scriptahub_task_claim',{...state,taskId:item.taskId,runId});
    if (!claimed.task) throw new Error('Reserved task could not be claimed');
    await directory(root,taskDirectory+'/run-state');
    const claimedPath = taskDirectory+'/run-state/claimed.json';
    const result = {...claimed,batchId:state.batchId,taskDirectory,claimedPath};
    const temporary = path.join(root,claimedPath)+'.'+crypto.randomUUID()+'.tmp';
    try {
      await fs.writeFile(temporary,JSON.stringify(result)+'\n',{flag:'wx',mode:0o600});
      await fs.rename(temporary,path.join(root,claimedPath));
    } finally { await fs.rm(temporary,{force:true}); }
    return result;
  }
  return {...await call('scriptahub_task_batch_close',{batchId:state.batchId}),task:null};
}
