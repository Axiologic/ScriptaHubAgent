import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// /code mounts only the agent folder. The selected repository source is
// recorded by Ploinky; never assume its checkout name or workspace location.
export async function repositorySkillsSource({ env = process.env, agentDirectory = fileURLToPath(new URL('../', import.meta.url)) } = {}) {
  if (!env.PLOINKY_WORKSPACE_ROOT) return path.resolve(agentDirectory, '../skills');
  const workspace = await fs.realpath(env.PLOINKY_WORKSPACE_ROOT);
  const identity = /^agent:([^/]+)\/([^/]+)$/.exec(env.PLOINKY_AGENT_ID || '');
  if (!identity) throw new Error('A Ploinky agent identity is required to resolve repository skills');
  const routing = JSON.parse(await fs.readFile(path.join(workspace, '.ploinky/routing.json'), 'utf8'));
  const sources = new Set(Object.values(routing.routes || {})
    .filter(route => route.repo === identity[1] && route.agent === identity[2])
    .map(route => route.hostPath));
  if (sources.size !== 1 || ![...sources][0]) throw new Error('The selected ScriptaHub repository source is unavailable or ambiguous');
  const agent = await fs.realpath([...sources][0]);
  const skills = await fs.realpath(path.join(agent, '../skills'));
  const relative = path.relative(workspace, skills);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error('Repository skills must remain inside the workspace');
  return skills;
}
