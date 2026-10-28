import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { DashboardStore } from '../dashboard-store.mjs';
import { TaskExecution, requireExecutor } from '../task-execution.mjs';
import { loadSourceConfig, validateSourceConfig } from '../settings.mjs';
import { TaskPublication } from '../task-publication.mjs';

let store;
try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 131072) throw new Error('Task request is too large');
    chunks.push(chunk);
  }
  const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  const runtime = process.env.PLOINKY_AGENT_RUNTIME_ROOT || '/Agent';
  const { authInfoFromInvocation } = await import(pathToFileURL(path.join(runtime, 'lib/invocation-auth.mjs')).href);
  const auth = authInfoFromInvocation(envelope.metadata?.invocation || {});
  const tool = process.env.TOOL_NAME;
  const executor = requireExecutor(auth, tool);
  const dataDir = process.env.SCRIPTA_DATA_DIR || path.resolve(import.meta.dirname, '../data');
  const configuredTools = new Set(['scriptahub_task_claim','scriptahub_task_package_prepare','scriptahub_task_publish']);
  const config = configuredTools.has(tool) ? validateSourceConfig(await loadSourceConfig({ dataDir, includePublication:true })) : null;
  store = new DashboardStore(dataDir);
  const service = new TaskExecution(store, dataDir);
  const methods = { scriptahub_task_claim: 'claim', scriptahub_task_status: 'status', scriptahub_task_document_read: 'document', scriptahub_task_finish: 'finish' };
  const args = envelope.input ?? envelope.arguments ?? {};
  const publisher = new TaskPublication(service);
  let result;
  if (tool === 'scriptahub_task_claim') {
    await publisher.preflight(config);
    result = service.claimConfigured(executor, args, config);
  } else if (tool === 'scriptahub_task_package_prepare') result = publisher.prepare(executor,args,config);
  else if (tool === 'scriptahub_task_package_upload') result = publisher.upload(executor,args);
  else if (tool === 'scriptahub_task_publish') result = await publisher.publish(executor,args,config);
  else result = await service[methods[tool]](executor,args);
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  const unavailable = ['ENOENT', 'EACCES', 'ELOOP', 'ENOTDIR'].includes(error.code);
  const message = unavailable ? 'Source document is unavailable' : error.status ? error.message : 'Task operation failed';
  process.stdout.write(JSON.stringify({ error: message, status: unavailable ? 404 : error.status || 500 }));
  process.exitCode = 1;
} finally { store?.close(); }
