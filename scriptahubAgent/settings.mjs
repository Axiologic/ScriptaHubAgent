import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { resolveSources, buildSnapshot } from './sync.mjs';

export function settingsFile(dataDir = process.env.SCRIPTA_DATA_DIR || path.join(import.meta.dirname, 'data')) {
  return path.join(dataDir, 'sources.json');
}
export async function loadSourceConfig({ configPath = process.env.SCRIPTA_CONFIG || path.join(import.meta.dirname, 'sources.json'), dataDir } = {}) {
  try { return JSON.parse(await fs.readFile(settingsFile(dataDir), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return JSON.parse(await fs.readFile(configPath, 'utf8'));
}
export function validateSourceConfig(config) {
  if (!config || config.schemaVersion !== 1 || !Array.isArray(config.repositories) || config.repositories.length > 100) throw new Error('Provide up to 100 catalogue URLs');
  if (!Number.isSafeInteger(config.syncIntervalSeconds) || config.syncIntervalSeconds < 1 || config.syncIntervalSeconds > 2147483) throw new Error('Refresh interval must be an integer between 1 and 2147483 seconds');
  for (const value of config.repositories) {
    if (typeof value !== 'string' || value.length > 4096) throw new Error('Each source must be a collection.json URL');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/collection.json')) throw new Error('Use HTTPS collection.json URLs, including GitHub blob links');
  }
  return { schemaVersion: 1, syncIntervalSeconds: config.syncIntervalSeconds, repositories: [...config.repositories] };
}
export async function saveSourceConfig(config, { dataDir, resolve = resolveSources } = {}) {
  const validated = validateSourceConfig(config);
  const resolved = await resolve(validated);
  // Build in a disposable directory to check duplicate identities, paths and metadata
  // before replacing settings. The running server owns activation of its snapshot.
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'scriptahub-settings-'));
  let bookCount;
  try { ({ bookCount } = await buildSnapshot({ config: validated, resolved, dataDir: temporary })); }
  finally { await fs.rm(temporary, { recursive: true, force: true }); }
  const file = settingsFile(dataDir);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const staging = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    await fs.writeFile(staging, JSON.stringify(validated, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.rename(staging, file);
  } finally { await fs.rm(staging, { force: true }); }
  return { settings: validated, bookCount };
}
export function assertSettingsAdmin(authInfo) {
  if (!Array.isArray(authInfo?.user?.roles) || !authInfo.user.roles.includes('admin')) throw new Error('Admin access is required');
}
