import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { publicationConfig } from './publication-config.mjs';
import { PublicationAccessStore, publicationIdentity } from './publication-access.mjs';
import { resolveSources, buildSnapshot } from './sync.mjs';

export const SUMMARY_READING_MINUTES = 10;
function sourceSettings(config) {
  const { summaryReadingMinutes, publication, ...settings } = config;
  return settings;
}

export function settingsFile(dataDir = process.env.SCRIPTA_DATA_DIR || path.join(import.meta.dirname, 'data')) {
  return path.join(dataDir, 'sources.json');
}
export async function loadSourceConfig({ configPath = process.env.SCRIPTA_CONFIG || path.join(import.meta.dirname, 'sources.json'), dataDir, includePublication = false } = {}) {
  let config;
  try { config = sourceSettings(JSON.parse(await fs.readFile(settingsFile(dataDir), 'utf8'))); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    config = sourceSettings(JSON.parse(await fs.readFile(configPath, 'utf8')));
  }
  return {...config, publication:includePublication ? publicationIdentity(dataDir) : null};
}
export function validateSourceConfig(config) {
  if (!config || config.schemaVersion !== 1 || !Array.isArray(config.repositories) || config.repositories.length > 100) throw new Error('Provide up to 100 catalogue URLs');
  if (!Number.isSafeInteger(config.syncIntervalSeconds) || config.syncIntervalSeconds < 1 || config.syncIntervalSeconds > 2147483) throw new Error('Refresh interval must be an integer between 1 and 2147483 seconds');
  for (const value of config.repositories) {
    if (typeof value !== 'string' || value.length > 4096) throw new Error('Each source must be a collection.json URL');
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/collection.json')) throw new Error('Use HTTPS collection.json URLs, including GitHub blob links');
  }
  return { schemaVersion: 1, syncIntervalSeconds: config.syncIntervalSeconds, repositories: [...config.repositories], publication: publicationConfig(config.publication) };
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
  if (validated.publication) {
    const access = new PublicationAccessStore(dataDir);
    try {
      access.update(state => {
        if (!state.connection || (state.connection.expiresAt && state.connection.expiresAt <= Date.now())) throw new Error('Connect GitHub or save a token before saving the Git identity');
        state.connection.publication = validated.publication;
        state.generation++;
      });
    } finally { access.close(); }
  }
  const file = settingsFile(dataDir);
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const staging = file + '.' + crypto.randomUUID() + '.tmp';
  try {
    await fs.writeFile(staging, JSON.stringify(sourceSettings(validated), null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    await fs.rename(staging, file);
  } finally { await fs.rm(staging, { force: true }); }
  return { settings: {...validated, publication:publicationIdentity(dataDir)}, bookCount };
}
export function assertSettingsAdmin(authInfo) {
  if (!Array.isArray(authInfo?.user?.roles) || !authInfo.user.roles.includes('admin')) throw new Error('Admin access is required');
}
