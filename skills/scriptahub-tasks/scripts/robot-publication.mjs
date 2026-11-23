import {execFile} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {promisify} from 'node:util';

const execute = promisify(execFile);
const commitId = /^[a-f0-9]{40}$/;
const tool = 'scriptahub_task_publish';

export async function publishFromRobot(call, executionId, {executeGit = execute} = {}) {
  const task = await call(tool, {executionId});
  const push = task.push;
  if (!push) return task;
  if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(push.repository)
      || !commitId.test(push.tree) || (push.parent !== null && !commitId.test(push.parent))
      || typeof push.branch !== 'string' || !push.branch
      || !Array.isArray(push.files) || !push.files.length || push.files.length > 500) {
    throw Error('Invalid ScriptaHub publication target');
  }
  const checkout = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-robot-publish-'));
  const runGit = async (args, encoding) => {
    const env = {...process.env, GIT_TERMINAL_PROMPT:'0', GIT_ALLOW_PROTOCOL:'https'};
    try {
      const {stdout} = await executeGit('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'http.followRedirects=false', ...args],
        {cwd:checkout, env, encoding, timeout:120000});
      return stdout;
    } catch (error) {
      const authentication = /authentication|access denied|credential|permission|403|401/i.test(error.stderr ?? '');
      if (/author identity unknown|please tell me who you are|empty ident name/i.test(error.stderr ?? '')) {
        throw Error('Configure the publishing robot’s Git name and email in RoboTeam.');
      }
      const failure = Error(authentication
        ? 'The publishing robot needs GitHub credentials with write access to the content repository. Configure them in RoboTeam.'
        : 'Robot Git ' + args[0] + ' failed for the publication. Retry the same ScriptaHub execution.');
      failure.branchMoved = args[0] === 'push' && /\[rejected\] \((?:fetch first|non-fast-forward)\)/.test(String(error.stdout ?? ''));
      throw failure;
    }
  };
  const git = async (...args) => (await runGit(args, 'utf8')).trim();
  const ref = 'refs/heads/' + push.branch;
  let failure;
  try {
    await git('init');
    await git('check-ref-format', ref);
    if (push.parent) {
      await git('fetch', '--no-tags', push.repository, ref);
      if (await git('rev-parse', 'FETCH_HEAD') !== push.parent) return await call(tool, {executionId, action:'confirm'});
    }
    await git('read-tree', ...(push.parent ? [push.parent] : ['--empty']));
    const artifact = path.join(checkout, 'content');
    for (const entry of push.files) {
      if (typeof entry.path !== 'string' || !entry.path || entry.path.startsWith('/')
          || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 50000000) {
        throw Error('Invalid publication file');
      }
      const file = await fs.open(artifact, 'w', 0o600);
      try {
        for (let offset = 0; offset < entry.size;) {
          const chunk = await call(tool, {executionId, action:'read', tree:push.tree, file:entry.path, offset});
          const size = Math.min(32768, entry.size - offset);
          if (chunk.tree !== push.tree || chunk.offset !== offset || chunk.size !== entry.size
              || typeof chunk.data !== 'string' || chunk.data.length !== 4 * Math.ceil(size / 3)) {
            throw Error('Publication file changed during transfer');
          }
          const bytes = Buffer.from(chunk.data, 'base64');
          if (bytes.length !== size || (await file.write(bytes)).bytesWritten !== size) throw Error('Incomplete publication file');
          offset += size;
        }
      } finally { await file.close(); }
      const blob = await git('hash-object', '-w', '--no-filters', artifact);
      await git('update-index', '--add', '--cacheinfo', '100644', blob, entry.path);
    }
    if (await git('write-tree') !== push.tree) throw Error('Git tree differs from the approved publication');
    let commit, commitObject;
    if (push.commit) {
      if (!commitId.test(push.commit) || typeof push.commitObject !== 'string') throw Error('Invalid retained publication commit');
      commitObject = push.commitObject;
      await fs.writeFile(artifact, Buffer.from(commitObject, 'base64'));
      commit = await git('hash-object', '-t', 'commit', '-w', artifact);
      if (commit !== push.commit) throw Error('Retained publication commit differs from its recorded identity');
    } else {
      commit = await git('commit-tree', push.tree, ...(push.parent ? ['-p', push.parent] : []), '-m', 'Publish ScriptaHub book');
      commitObject = (await runGit(['cat-file', 'commit', commit], 'buffer')).toString('base64');
    }
    const current = await call(tool, {executionId, action:'authorize', tree:push.tree, commitObject});
    if (current.authorizedCommit !== commit) return current;
    // A regular Git push refuses to overwrite a concurrently advanced branch.
    await git('push', '--porcelain', push.repository, commit + ':' + ref);
  } catch (error) {
    failure = error;
  } finally {
    await fs.rm(checkout, {recursive:true, force:true});
  }
  const result = await call(tool, {executionId, action:'confirm'});
  if (failure && !failure.branchMoved && result.state !== 'completed') throw failure;
  return result;
}
