import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { PublicationTransfer, packagePath, publicationError as fail } from './publication-transfer.mjs';
import { publicationTarget, checkPublicationPackage, verifyCatalogueBranch } from './publication-policy.mjs';
import { publicationGit, writePackageFile } from './publication-git.mjs';
import { readPublicationToken } from './publication-access.mjs';
import { publicationConfig } from './publication-config.mjs';
import { requireNoActiveProcessing } from './processing-store.mjs';
import { combineCollections } from './sync.mjs';

const leaseMs = 600000;
const retryMs = 3000;
const refName = branch => 'refs/heads/' + branch;
class BranchMoved extends Error {}
class PublicationConflict extends Error {}

export class TaskPublication extends PublicationTransfer {
  constructor(service, { tokenProvider, gitFactory = publicationGit } = {}) {
    super(service);
    this.tokenProvider = tokenProvider || (config => readPublicationToken(config,{dataDir:service.dataDir}));
    this.gitFactory = gitFactory;
  }
  async preflight(config) {
    publicationConfig(config.publication);
    await this.tokenProvider(config.publication);
    return { configured: true };
  }
  async publish(executor, { executionId }, config) {
    const execution = this.service.execution(executor, executionId);
    const row = this.row(executionId);
    if (row?.receipt) return this.complete(executor, executionId, JSON.parse(row.receipt));
    if (execution.finished_at) return this.service.status(executor, { executionId });
    if (!(execution.state === 'stop_requested' && (row?.commit_id || row?.retry_at != null))) this.running(executor, executionId);
    if (!row) fail('No validated package has been registered', 409);
    const manifest = JSON.parse(row.manifest);
    const target = publicationTarget(manifest.catalogue, manifest.branch);
    const authorized = config.repositories.includes(manifest.catalogue);
    if (!authorized && row.retry_at === null && !row.commit_id) fail('Publication destination is no longer authorized', 403);
    // Verify a first submission before queuing it. An incomplete upload can still be resumed.
    const readPackage = () => new Map(manifest.files.map(entry => [entry.path, this.bytes(executionId,entry)]));
    const packageBytes = row.retry_at === null && !row.commit_id ? readPackage() : null;
    const owner = crypto.randomUUID();
    const key = JSON.stringify([target.remote.toLowerCase(), target.branch]);
    const claim = this.store.transaction(() => {
      const current = this.service.execution(executor,executionId);
      const saved = this.row(executionId);
      if (current.finished_at || saved.receipt) return 'finished';
      requireNoActiveProcessing(this.store, executionId);
      if (!(current.state === 'stop_requested' && (saved.commit_id || saved.retry_at !== null))) this.running(executor,executionId);
      const now = Date.now();
      if (saved.lease_until > now) return 'queued';
      this.store.db.prepare('UPDATE task_publications SET target_key=?,retry_at=COALESCE(retry_at,?) WHERE execution_id=?')
        .run(key, now, executionId);
      const busy = this.store.db.prepare(`SELECT 1 FROM task_publications WHERE target_key=? AND execution_id<>?
        AND lease_until>? LIMIT 1`).get(key,executionId,now);
      if (busy) {
        this.store.db.prepare('UPDATE task_publications SET retry_at=? WHERE execution_id=?').run(now + retryMs,executionId);
        return 'queued';
      }
      this.store.db.prepare('UPDATE task_publications SET lease_owner=?,lease_until=? WHERE execution_id=?')
        .run(owner,now + leaseMs,executionId);
      return 'claimed';
    });
    if (claim === 'finished') {
      const saved = this.row(executionId);
      return saved.receipt ? this.complete(executor,executionId,JSON.parse(saved.receipt)) : this.service.status(executor,{executionId});
    }
    if (claim === 'queued') return this.service.status(executor,{executionId});

    const update = (fields, ...values) => {
      if (this.store.db.prepare(`UPDATE task_publications SET ${fields} WHERE execution_id=? AND lease_owner=?`)
        .run(...values,executionId,owner).changes !== 1) fail('Publication ownership changed',409);
    };
    const clearCommit = () => update('commit_id=NULL,commit_base=NULL,push_state=NULL');
    const defer = () => {
      update('retry_at=?',Date.now() + retryMs);
      return this.service.status(executor,{executionId});
    };
    const stopped = () => this.service.execution(executor,executionId).state === 'stop_requested';
    const finish = message => {
      const state = stopped() ? 'cancelled' : 'failed';
      const detail = state === 'cancelled' ? { result: 'Publication cancelled before a push took effect.' } : { error: message };
      return this.service.finish(executor,{executionId,state,...detail},{publicationOwner:owner});
    };
    const directory = path.join(this.service.dataDir, 'publications', executionId);
    try {
      let saved = this.row(executionId);
      if ((!saved.commit_id || saved.push_state === 'prepared') && (stopped() || !authorized)) {
        clearCommit();
        return finish('Publication destination is no longer authorized');
      }
      const author = publicationConfig(config.publication);
      const token = await this.tokenProvider(author).catch(error => {
        // A token/identity change during lookup can be retried with fresh settings.
        if (error.status === 409) throw new BranchMoved(error.message);
        throw error;
      });
      requireNoActiveProcessing(this.store, executionId);
      // Leave a bounded amount of work per call. The persisted request is resumed
      // automatically, including after a process restart.
      if (!saved.commit_id) {
        update('lease_until=?',Date.now() + leaseMs);
        await fs.rm(directory, { recursive: true, force: true });
      }
      const runGit = await this.gitFactory(directory,token,author);
      const git = async (...args) => {
        update('lease_until=?',Date.now() + leaseMs);
        return runGit(...args);
      };
      const ref = refName(target.branch);
      if (!saved.commit_id) {
        const { commit, head } = await this.prepareCommit(git,directory,manifest,target,packageBytes || readPackage(),() => this.running(executor,executionId));
        update("commit_id=?,commit_base=?,push_state='prepared'",commit,head);
        saved = this.row(executionId);
      }

      const commit = saved.commit_id;
      const parent = saved.push_state === null ? manifest.baseCommit : saved.commit_base;
      const confirm = async () => {
        const refs = await git('ls-remote','origin');
        const head = remoteHead(refs,target.branch);
        if (head === commit) return { head, published: true };
        if (!head || head === parent) return { head, refs, published: false, superseded: false };
        const shallow = await fs.stat(path.join(directory,'.git/shallow')).then(() => true,error => {
          if (error.code === 'ENOENT') return false;
          throw error;
        });
        await git('fetch','--filter=blob:none',...(shallow ? ['--unshallow'] : []),'origin',ref);
        const fetched = await git('rev-parse','FETCH_HEAD');
        if (await ancestor(git,commit,fetched)) return { head: fetched, published: true };
        // Once a competing commit has advanced from our parent, an old normal
        // push cannot take effect. A missing branch or rewrite is inconclusive.
        const superseded = fetched !== parent && (parent === null || await ancestor(git,parent,fetched));
        return { head: fetched, refs, published: false, superseded };
      };
      let confirmed;
      if (saved.push_state === 'prepared') {
        const refs = await git('ls-remote','origin');
        if (remoteHead(refs,target.branch) !== parent || (!parent && refs)) {
          clearCommit();
          if (stopped()) return finish();
          return defer();
        }
        verifyCatalogueBranch(manifest.catalogue,target.branch,refs);
        if (stopped() || !authorized) {
          clearCommit();
          return finish('Publication destination is no longer authorized');
        }
      } else {
        confirmed = await confirm();
        if (!confirmed.published && saved.push_state === 'accepted') return defer();
        if (!confirmed.published && confirmed.superseded) {
          clearCommit();
          if (stopped() || !authorized) return finish('Publication destination is no longer authorized');
          return defer();
        }
        if (!confirmed.published && (confirmed.head !== parent || stopped() || !authorized)) return defer();
      }
      if (!confirmed?.published) {
        if (confirmed) {
          verifyCatalogueBranch(manifest.catalogue,target.branch,confirmed.refs);
          if (!confirmed.head && confirmed.refs) return defer();
        }
        if (await git('rev-parse','HEAD') !== commit || await git('status','--porcelain')) fail('The retained publication checkout changed',409);
        const canPush = this.store.transaction(() => {
          requireNoActiveProcessing(this.store, executionId);
          if (stopped()) return false;
          this.running(executor,executionId);
          // Persist the uncertainty before sending anything to the remote.
          update("push_state='attempting',lease_until=?",Date.now() + leaseMs);
          return true;
        });
        if (!canPush) {
          if (saved.push_state !== 'prepared') return defer();
          clearCommit();
          return finish();
        }
        const pushError = await git('push','--porcelain','origin',`${commit}:${ref}`).then(() => null, error => error);
        if (!pushError) update("push_state='accepted'");
        else if (saved.push_state === 'prepared' && pushError.pushRejected) {
          clearCommit();
          if (stopped()) return finish();
          if (pushError.pushContended) return defer();
          const refs = await git('ls-remote','origin');
          if (remoteHead(refs,target.branch) !== parent) return defer();
          return finish(pushError.message);
        }
        confirmed = await confirm();
        if (!confirmed.published) {
          if (this.row(executionId).push_state !== 'accepted' && confirmed.superseded) {
            clearCommit();
            if (stopped()) return finish();
          }
          return defer();
        }
      }
      const receipt = { executionId, bookId: manifest.bookId, repository: target.remote, branch: target.branch,
        commit, packageDigest: saved.digest, publishedAt: new Date().toISOString() };
      update('receipt=?',JSON.stringify(receipt));
      return this.complete(executor,executionId,receipt);
    } catch (error) {
      const saved = this.row(executionId);
      if (saved.receipt || this.service.execution(executor,executionId).finished_at) throw error;
      const uncertain = saved.commit_id && saved.push_state !== 'prepared';
      if (uncertain || error instanceof BranchMoved || error.status >= 500) return defer();
      if (saved.commit_id) clearCommit();
      if (stopped() || error instanceof PublicationConflict || (row.retry_at !== null && error.status >= 400)) return finish(error.message);
      update('retry_at=NULL');
      throw error;
    } finally {
      this.store.db.prepare('UPDATE task_publications SET lease_until=0,lease_owner=NULL WHERE execution_id=? AND lease_owner=?').run(executionId,owner);
    }
  }

  async prepareCommit(git,directory,manifest,target,packageBytes,requireRunning) {
    const ref = refName(target.branch);
    await git('init', '--initial-branch=' + target.branch);
    await git('check-ref-format',ref);
    await git('remote', 'add', 'origin', target.remote);
    const refs = await git('ls-remote','origin');
    verifyCatalogueBranch(manifest.catalogue,target.branch,refs);
    const head = remoteHead(refs,target.branch);
    if (!head && (manifest.baseCommit || refs)) throw new PublicationConflict('The destination branch disappeared or does not exist');
    const base = manifest.baseCommit;
    if (head) {
      await git('fetch','--filter=blob:none',...(head === base ? ['--depth=1'] : []),'origin',ref);
      if (await git('rev-parse','FETCH_HEAD') !== head) throw new BranchMoved();
      if (base && head !== base) {
        const baseExists = await git('cat-file','-t',base).catch(error => {
          if (error.gitExitCode === 128) return '';
          throw error;
        });
        if (baseExists !== 'commit' || !await ancestor(git,base,head)) {
          throw new PublicationConflict('The destination branch no longer contains the validated baseline');
        }
      }
    }

    const read = async (commit, name) => {
      const item = await git('--literal-pathspecs','ls-tree',commit,'--',name);
      if (!/^100[67][0-7]{2} blob /.test(item)) throw new PublicationConflict('Missing or invalid publication metadata: ' + name);
      const value = await git('show',commit + ':' + name);
      try { return JSON.parse(value); }
      catch { throw new PublicationConflict('Invalid publication metadata: ' + name); }
    };
    const original = base ? await read(base,target.collection) : null;
    if (base && (!original || !Array.isArray(original.books) || original.books.some(book => !book || typeof book.id !== 'string'))) {
      throw new PublicationConflict('The validated baseline catalogue is invalid');
    }
    const originalBook = original?.books.find(book => book.id === manifest.bookId);
    const editable = new Set();
    let previousDocument;
    if (manifest.taskType === 'scriptahub.edit' && originalBook) {
      if (original.schemaVersion === 1) {
        const prefix = target.root + packagePath(originalBook.directory) + '/';
        editable.add(prefix + 'manifest.json');
        editable.add(prefix + 'editions.json');
        previousDocument = { metadata: await read(base,prefix + 'manifest.json'), history: await read(base,prefix + 'editions.json') };
      } else {
        const metadata = target.root + packagePath(originalBook.path);
        editable.add(metadata);
        previousDocument = await read(base,metadata);
      }
    }
    const candidate = checkPublicationPackage(manifest,target,packageBytes,original,previousDocument);
    const paths = [...packageBytes.keys()];
    let bytes = packageBytes;
    if (head !== base) {
      const latest = await read(head,target.collection);
      if (!latest || latest.schemaVersion !== candidate.schemaVersion || !Array.isArray(latest.books)
        || latest.books.some(book => !book || typeof book.id !== 'string')) {
        throw new PublicationConflict('The remote catalogue schema changed after validation');
      }
      const latestBook = latest.books.find(book => book.id === manifest.bookId);
      if (!isDeepStrictEqual(originalBook,latestBook)) {
        throw new PublicationConflict('The current book or catalogue schema changed after validation');
      }
      const packagePaths = paths.filter(name => name !== target.collection);
      const currentBookPaths = originalBook
        ? [target.root + packagePath(originalBook.directory || originalBook.path).replace(/\/book\.json$/,'')]
        : [];
      const tree = async commit => commit
        ? git('--literal-pathspecs','ls-tree','-r','-z',commit,'--',...new Set([...packagePaths,...currentBookPaths]))
        : '';
      if (await tree(base) !== await tree(head)) {
        throw new PublicationConflict('The current book or a resource in its publication package changed after validation');
      }
      const updatedBook = candidate.books.find(book => book.id === manifest.bookId);
      const books = latestBook ? latest.books.map(book => book.id === manifest.bookId ? updatedBook : book) : [...latest.books,updatedBook];
      const collection = { ...latest, books, bookCount: books.length };
      bytes = new Map(packageBytes);
      try {
        if (collection.schemaVersion === 1 && (latest.keywords || candidate.keywords)) collection.keywords = combineCollections(books).keywords;
        bytes.set(target.collection,Buffer.from(JSON.stringify(collection,null,2) + '\n'));
        checkPublicationPackage(manifest,target,bytes,latest,previousDocument);
      } catch (error) {
        throw new PublicationConflict('The updated catalogue is incompatible with the validated publication: ' + error.message);
      }
    }
    if (head) {
      // Keep the index, but materialize only the files in the validated package.
      await git('sparse-checkout','init','--no-cone');
      const patterns = paths.map(name => '/' + name.replace(/[\\*?\[\]!#]/g,'\\$&')).join('\n') + '\n';
      await fs.writeFile(path.join(directory,'.git','info','sparse-checkout'),patterns);
      await git('checkout','-B',target.branch,head);
    }
    for (const [name,content] of bytes) {
      requireRunning();
      if (name !== target.collection && !editable.has(name)) {
        const existing = await fs.lstat(path.join(directory,name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
        if (existing && (!existing.isFile() || !(await fs.readFile(path.join(directory,name))).equals(content))) fail('Publication would overwrite an existing resource: ' + name,409);
      }
      await writePackageFile(directory,name,content);
    }
    await git('--literal-pathspecs','add','--',...paths);
    const changed = (await git('diff','--cached','--name-only','-z')).split('\0').filter(Boolean);
    if (changed.some(name => !bytes.has(name))) fail('Publication diff contains unauthorized files');
    if (!changed.length) throw new PublicationConflict('The publication does not contain any changes');
    await git('commit','-m',`Publish book ${manifest.bookId}`);
    const commit = await git('rev-parse','HEAD');
    for (const [name,content] of bytes) {
      const blob = crypto.createHash('sha1').update(Buffer.from(`blob ${content.length}\0`)).update(content).digest('hex');
      if (await git('rev-parse',commit + ':' + name) !== blob) fail('Git attributes changed a validated file: ' + name,409);
    }
    return { commit, head };
  }

  complete(executor, executionId, receipt) {
    const status = this.service.status(executor,{executionId});
    if (status.state === 'completed') return { ...status, publication: receipt };
    const result = `Published ${receipt.bookId} to ${receipt.repository} (${receipt.branch}), commit ${receipt.commit}.`;
    return { ...this.service.finish(executor,{executionId,state:'completed',result}, { publication: true }), publication: receipt };
  }

  async resume(loadConfig, report = console.error) {
    const rows = this.store.db.prepare(`SELECT p.execution_id,e.executor_agent_id,p.target_key FROM task_publications p
      JOIN task_executions e ON e.id=p.execution_id WHERE e.finished_at IS NULL
      AND (p.retry_at<=? OR (p.retry_at IS NULL AND p.commit_id IS NOT NULL)) AND p.lease_until<=?
      ORDER BY p.retry_at,p.execution_id`).all(Date.now(),Date.now());
    if (!rows.length) return;
    const config = await loadConfig();
    const targets = new Set();
    const eligible = rows.filter(row => {
      if (row.target_key === null) return true;
      if (targets.has(row.target_key)) return false;
      targets.add(row.target_key);
      return true;
    });
    await Promise.all(eligible.map(async row => {
      try { await this.publish(row.executor_agent_id,{executionId:row.execution_id},config); }
      catch (error) { report(`ScriptaHub publication ${row.execution_id}: ${error.message}`); }
    }));
  }
}

async function ancestor(git, commit, head) {
  try { await git('merge-base','--is-ancestor',commit,head); return true; }
  catch (error) {
    if (error.gitExitCode === 1) return false;
    throw error;
  }
}

function remoteHead(refs, branch) {
  const line = refs.split('\n').find(line => line.split('\t')[1] === refName(branch));
  return line ? line.split('\t')[0] : null;
}
