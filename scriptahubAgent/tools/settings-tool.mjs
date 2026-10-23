import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadSourceConfig, saveSourceConfig, assertSettingsAdmin } from '../settings.mjs';

try {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const { authInfoFromInvocation } = await import(pathToFileURL(path.join(process.env.PLOINKY_AGENT_RUNTIME_ROOT || '/Agent', 'lib/invocation-auth.mjs')).href);
  // AgentServer places only the verified Router grant in this envelope.
  const auth = authInfoFromInvocation(envelope.metadata?.invocation || {}, { invocationToken: envelope.metadata?.invocationToken || '' });
  assertSettingsAdmin(auth);
  const args = envelope.input ?? envelope.arguments ?? {};
  let result;
  if (process.env.TOOL_NAME === 'scriptahub_config_get') result = { settings: await loadSourceConfig() };
  else if (process.env.TOOL_NAME === 'scriptahub_config_set') result = await saveSourceConfig({ schemaVersion: 1, repositories: args.repositories, syncIntervalSeconds: args.syncIntervalSeconds });
  else throw new Error('Unknown settings tool');
  process.stdout.write(JSON.stringify(result));
} catch (error) { process.stdout.write(JSON.stringify({ error: error.message })); process.exitCode = 1; }
