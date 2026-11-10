import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { requireExecutor } from '../task-execution.mjs';
import { invokeSupervisor } from '../processing-ipc.mjs';

try {
  const chunks=[]; let size=0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 131072) throw Object.assign(new Error('Invalid processing request'),{status:400,code:'invalid'});
    chunks.push(chunk);
  }
  let envelope;
  try { envelope=JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('Invalid processing request'),{status:400,code:'invalid'}); }
  const runtime=process.env.PLOINKY_AGENT_RUNTIME_ROOT || '/Agent';
  const {authInfoFromInvocation}=await import(pathToFileURL(path.join(runtime,'lib/invocation-auth.mjs')).href);
  const tool=process.env.TOOL_NAME;
  const executor=requireExecutor(authInfoFromInvocation(envelope.metadata?.invocation || {}),tool);
  const dataDir=process.env.SCRIPTA_DATA_DIR || path.resolve(import.meta.dirname,'../data');
  const result=await invokeSupervisor(dataDir,{tool,executor,input:envelope.input ?? envelope.arguments ?? {}});
  process.stdout.write(JSON.stringify(result));
  if (result.error) process.exitCode=1;
} catch(error) {
  const status=error.status || 503;
  const message=error.status ? error.message : 'Processing supervisor is unavailable';
  process.stdout.write(JSON.stringify({error:message,status,code:error.code || (status===403?'denied':'unavailable')}));
  process.exitCode=1;
}
