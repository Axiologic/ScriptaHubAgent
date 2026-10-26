import path from 'node:path';
import { pathToFileURL } from 'node:url';

const runtime = process.env.PLOINKY_AGENT_RUNTIME_ROOT || '/Agent';
let modules;
function agentModules() {
  modules ??= Promise.all([
    import(pathToFileURL(path.join(runtime, 'lib/invocationAuth.mjs')).href),
    import(pathToFileURL(path.join(runtime, 'client/AgentMcpClient.mjs')).href),
  ]);
  return modules;
}

export function parseToolResult(response) {
  const result = Array.isArray(response?.content)
    ? JSON.parse(response.content.filter(item => item.type === 'text').map(item => item.text).join('\n'))
    : response;
  if (response?.isError || !result || result.error || result.ok === false) throw new Error(result?.error || 'Agent call failed');
  return result;
}

export async function verifyRouterUser(req, url, body, { verifier, createClient } = {}) {
  if (typeof req.headers['x-ploinky-auth-info'] !== 'string') return null;
  if (!verifier || !createClient) {
    try {
      const [runtimeVerifier, clientModule] = await agentModules();
      verifier ||= runtimeVerifier;
      createClient ||= clientModule.createAgentClient;
    } catch { throw Object.assign(new Error('Identity service is unavailable'), { status: 503 }); }
  }
  let checked;
  try { checked = verifier.verifyHttpRouteAuthInfoFromHeaders(req.headers, {
    method: req.method, path: url.pathname, query: url.search, body,
  }); } catch { return null; }
  const actor = checked?.payload?.actor;
  if (!checked?.ok || actor?.kind !== 'user' || actor.id !== checked.payload.sub || !actor.id.startsWith('user:')) return null;
  const token = checked.authInfo?.delegations?.identity?.token;
  if (!token) return null;
  let client;
  try {
    client = await createClient('userPersistoAgent', { userDelegationToken: token });
    const profile = parseToolResult(await client.callTool('userpersisto_profile_get', {}, { timeoutMs: 30000 }));
    const user = profile.user;
    if (user?.id !== actor.id.slice(5) || user.status !== 'active' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email || '')) return null;
    return { id: actor.id, email: user.email, displayName: user.displayName || user.username || '',
      roles: profile.roles || [], capabilities: profile.capabilities || [],
      installationAdministratorId: profile.installationAdministratorId ? `user:${profile.installationAdministratorId}` : null };
  } catch { throw Object.assign(new Error('Identity service is unavailable'), { status: 503 }); }
  finally { await client?.close(); }
}

export async function callAgent(agent, tool, args) {
  const [, clientModule] = await agentModules();
  const client = await clientModule.createAgentClient(agent);
  try { return parseToolResult(await client.callTool(tool, args, { timeoutMs: 30000 })); }
  finally { await client.close(); }
}
