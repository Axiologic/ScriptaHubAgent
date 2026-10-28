import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { publicationError as fail } from './publication-transfer.mjs';
const execute = promisify(execFile);

export async function publicationGit(directory, token, author) {
  const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
  // A fresh repository, fixed configuration and no inherited helpers/hooks prevent
  // package files or host Git configuration from executing code or receiving secrets.
  const env = { PATH: process.env.PATH, LANG: 'C.UTF-8', HOME: directory,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0',
    GIT_CONFIG_COUNT: '4', GIT_CONFIG_KEY_0: 'http.https://github.com/.extraHeader',
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`, GIT_CONFIG_KEY_1: 'credential.helper', GIT_CONFIG_VALUE_1: '',
    GIT_CONFIG_KEY_2: 'http.followRedirects', GIT_CONFIG_VALUE_2: 'false',
    GIT_CONFIG_KEY_3: 'core.hooksPath', GIT_CONFIG_VALUE_3: '/dev/null',
    GIT_AUTHOR_NAME: author.authorName, GIT_COMMITTER_NAME: author.authorName,
    GIT_AUTHOR_EMAIL: author.authorEmail, GIT_COMMITTER_EMAIL: author.authorEmail };
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  return async (...args) => {
    try {
      const { stdout } = await execute('git', args, { cwd: directory, env, timeout: 120000, maxBuffer: 8 * 1024 * 1024 });
      return stdout.trim();
    } catch (error) {
      // Never serialize exec errors: their command/env/stderr can contain credentials.
      let detail = String(error.stderr || '').replaceAll(token, '[redacted]').replaceAll(basic, '[redacted]');
      detail = detail.replace(/https:\/\/[^\s/@]+:[^\s/@]+@/g, 'https://[redacted]@').slice(-1500);
      fail(`Publication Git ${args[0]} failed${detail ? ': ' + detail.trim() : ''}`, 502);
    }
  };
}
export async function writePackageFile(root, name, bytes) {
  let current = root;
  for (const part of name.split('/').slice(0, -1)) {
    current = path.join(current, part);
    try { await fs.mkdir(current, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
    if (!(await fs.lstat(current)).isDirectory()) fail('Publication path contains a symlink or non-directory');
  }
  const filename = path.join(root, name);
  const existing = await fs.lstat(filename).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
  if (existing && !existing.isFile()) fail('Publication file is not a regular file');
  if (existing) await fs.unlink(filename); // Do not follow a baseline hard link.
  await fs.writeFile(filename, bytes, { flag: 'wx', mode: 0o600 });
}
