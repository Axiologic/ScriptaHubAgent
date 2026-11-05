import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const readOrNull = async (file) => {
  try { return await fs.readFile(file); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null; throw error; }
};

const directoryIdentity = async (directory) => {
  try {
    const stat = await fs.stat(directory, { bigint: true });
    return stat.isDirectory() ? `${stat.dev}:${stat.ino}` : null;
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return null;
    throw error;
  }
};

const childDirectories = async (directory) => {
  try { return (await fs.readdir(directory)).map(name => path.join(directory, name)); }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return []; throw error; }
};

// Ploinky commits an agent's route only after its first start is ready, so that
// start finds no route. The mounted /code is then the proof: a bind mount keeps
// the directory's identity, so only the checkout really mounted can match, under
// any folder name. A copy with the same contents is a different directory.
async function unroutedAgentSources(workspace, agent, agentDirectory) {
  const mounted = await directoryIdentity(agentDirectory);
  const roots = [
    ...await childDirectories(path.join(workspace, '.ploinky/repos')),
    ...await childDirectories(workspace),
  ];
  const sources = new Set();
  for (const root of roots) {
    const candidate = path.join(root, agent);
    // An unrelated entry that cannot be read cannot prove it is the mount.
    const identity = await directoryIdentity(candidate).catch(() => null);
    if (mounted && identity === mounted) sources.add(await fs.realpath(candidate));
  }
  return sources;
}

// /code mounts only the agent folder. The selected repository source is
// recorded by Ploinky once the agent is routed; never assume its checkout name
// or workspace location beyond that first start.
export async function repositorySkillsSource({ env = process.env, agentDirectory = fileURLToPath(new URL('../', import.meta.url)) } = {}) {
  if (!env.PLOINKY_WORKSPACE_ROOT) return path.resolve(agentDirectory, '../skills');
  const workspace = await fs.realpath(env.PLOINKY_WORKSPACE_ROOT);
  const identity = /^agent:([^/]+)\/([^/]+)$/.exec(env.PLOINKY_AGENT_ID || '');
  if (!identity) throw new Error('A Ploinky agent identity is required to resolve repository skills');
  const routingBytes = await readOrNull(path.join(workspace, '.ploinky/routing.json'));
  const routes = routingBytes ? Object.values(JSON.parse(routingBytes).routes || {})
    .filter(route => route.repo === identity[1] && route.agent === identity[2]) : [];
  const sources = new Set(routes.length ? routes.map(route => route.hostPath)
    : await unroutedAgentSources(workspace, identity[2], agentDirectory));
  if (sources.size !== 1 || ![...sources][0]) throw new Error('The selected ScriptaHub repository source is unavailable or ambiguous');
  const agent = await fs.realpath([...sources][0]);
  const skills = await fs.realpath(path.join(agent, '../skills'));
  const relative = path.relative(workspace, skills);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error('Repository skills must remain inside the workspace');
  return skills;
}
