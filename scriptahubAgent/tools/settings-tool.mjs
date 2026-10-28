import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { publicationAuthentication, publicPublication } from '../publication-auth.mjs';
import { loadSourceConfig, saveSourceConfig, assertSettingsAdmin } from '../settings.mjs';

try {
  const chunks = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    size += chunk.length;
    if (size > 65536) throw new Error('Settings request is too large');
    chunks.push(chunk);
  }
  const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  const { authInfoFromInvocation } = await import(pathToFileURL(path.join(process.env.PLOINKY_AGENT_RUNTIME_ROOT || '/Agent', 'lib/invocation-auth.mjs')).href);
  // AgentServer places only the verified Router grant in this envelope.
  const auth = authInfoFromInvocation(envelope.metadata?.invocation || {}, { invocationToken: envelope.metadata?.invocationToken || '' });
  assertSettingsAdmin(auth);
  const args = envelope.input ?? envelope.arguments ?? {};
  let result;
  if (process.env.TOOL_NAME === 'scriptahub_config_get') {
    const settings = await loadSourceConfig();
    const status = await publicationAuthentication(auth,{action:'status'});
    result = { settings: {...settings,publication:status.publication} };
  }
  else if (process.env.TOOL_NAME === 'scriptahub_config_set') {
    const status = await publicationAuthentication(auth,{action:'status'});
    if (args.publication && !status.connected) throw new Error('Connect GitHub or save a token in Publication before saving the Git identity.');
    result = await saveSourceConfig({schemaVersion:1,repositories:args.repositories,syncIntervalSeconds:args.syncIntervalSeconds,
      publication:args.publication || status.publication});
    result.settings.publication = publicPublication(result.settings);
  }
  else if (process.env.TOOL_NAME === 'scriptahub_publication_auth') result = await publicationAuthentication(auth,args);
  else throw new Error('Unknown settings tool');
  process.stdout.write(JSON.stringify(result));
} catch (error) {
  const message = process.env.TOOL_NAME === 'scriptahub_publication_auth'
    ? (/^(GitHub |Git |Enter |Connect |Start |Provide |Admin |Authenticated |ScriptaHub publication)/.test(error.message) ? error.message : 'Publication connection failed. Check Git access in ScriptaHub Settings.') : error.message;
  process.stdout.write(JSON.stringify({error:message})); process.exitCode = 1;
}
