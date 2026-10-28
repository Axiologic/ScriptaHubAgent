import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { PublicationTransfer, publicationError as fail } from './publication-transfer.mjs';
import { publicationTarget, checkPublicationPackage, verifyCatalogueBranch } from './publication-policy.mjs';
import { publicationGit, writePackageFile } from './publication-git.mjs';
import { readPublicationToken } from './publication-access.mjs';
import { publicationConfig } from './publication-config.mjs';

export class TaskPublication extends PublicationTransfer {
  constructor(service, { tokenProvider, gitFactory = publicationGit } = {}) {
    super(service); this.tokenProvider = tokenProvider || (config => readPublicationToken(config,{dataDir:service.dataDir})); this.gitFactory = gitFactory;
  }
  async preflight(config) {
    publicationConfig(config.publication);
    await this.tokenProvider(config.publication);
    return { configured: true };
  }
  async publish(executor, { executionId }, config) {
    const execution = this.service.execution(executor, executionId);
    let row = this.row(executionId);
    if (row?.receipt) return this.complete(executor, executionId, JSON.parse(row.receipt));
    if (!(execution.state === 'stop_requested' && row?.commit_id)) this.running(executor, executionId);
    if (!row) fail('No validated package has been registered', 409);
    const manifest = JSON.parse(row.manifest);
    if (!config.repositories.includes(manifest.catalogue)) fail('Publication destination is no longer authorized', 403);
    const author = publicationConfig(config.publication);
    const token = await this.tokenProvider(author);
    const target = publicationTarget(manifest.catalogue, manifest.branch);
    const owner = crypto.randomUUID();
    this.store.transaction(() => {
      const current = this.service.execution(executor,executionId);
      if (!(current.state === 'stop_requested' && this.row(executionId)?.commit_id)) this.running(executor,executionId);
      if (this.store.db.prepare('UPDATE task_publications SET lease_owner=?,lease_until=? WHERE execution_id=? AND lease_until<? AND receipt IS NULL')
        .run(owner, Date.now() + 600000, executionId, Date.now()).changes !== 1) fail('Publication is already in progress; retry the same operation later', 409);
    });
    const renew = () => {
      if (this.store.db.prepare('UPDATE task_publications SET lease_until=? WHERE execution_id=? AND lease_owner=?')
        .run(Date.now() + 600000,executionId,owner).changes !== 1) fail('Publication ownership changed', 409);
    };
    const directory = path.join(this.service.dataDir, 'publications', executionId);
    try {
      row = this.row(executionId);
      const packageBytes = new Map(manifest.files.map(entry => [entry.path,this.bytes(executionId,entry)]));
      if (!row.commit_id) {
        await fs.rm(directory, { recursive: true, force: true });
        const gitCommand = await this.gitFactory(directory,token,author);
        const git = async (...args) => { renew(); return gitCommand(...args); };
        await git('init', '--initial-branch=' + target.branch);
        await git('check-ref-format','refs/heads/' + target.branch);
        await git('remote', 'add', 'origin', target.remote);
        const refs = await git('ls-remote', 'origin');
        verifyCatalogueBranch(manifest.catalogue,target.branch,refs);
        const head = remoteHead(refs, target.branch);
        if (head !== manifest.baseCommit || (head === null && refs)) fail('Publication baseline changed; no automatic merge or overwrite is allowed', 409);
        let oldCollection = null;
        if (head) {
          await git('fetch', '--depth=1', 'origin', 'refs/heads/' + target.branch);
          if (await git('rev-parse','FETCH_HEAD') !== head) fail('Publication baseline changed during fetch',409);
          await git('checkout','-B',target.branch,head);
          // Read through Git to avoid following symlinks in a remote checkout.
          oldCollection = JSON.parse(await git('show', head + ':' + target.collection));
        }
        checkPublicationPackage(manifest,target,packageBytes,oldCollection);
        for (const [name,bytes] of packageBytes) {
          this.running(executor,executionId);
          // Existing files may only be retained byte-for-byte, except collection.json.
          if (name !== target.collection) {
            const existing = await fs.lstat(path.join(directory,name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
            if (existing && (!existing.isFile() || !(await fs.readFile(path.join(directory,name))).equals(bytes))) fail('Publication would overwrite an existing resource: ' + name,409);
          }
          await writePackageFile(directory,name,bytes);
        }
        await git('add','--',...manifest.files.map(entry => entry.path));
        const changed = (await git('diff','--cached','--name-only','-z')).split('\0').filter(Boolean);
        if (changed.some(name => !packageBytes.has(name))) fail('Publication diff contains unauthorized files');
        await git('commit','-m',`Publish book ${manifest.bookId}`);
        const commit = await git('rev-parse','HEAD');
        for (const [name,bytes] of packageBytes) {
          const blob = crypto.createHash('sha1').update(Buffer.from(`blob ${bytes.length}\0`)).update(bytes).digest('hex');
          if (await git('rev-parse',commit + ':' + name) !== blob) fail('Git attributes changed a validated file: ' + name,409);
        }
        this.store.db.prepare('UPDATE task_publications SET commit_id=? WHERE execution_id=? AND lease_owner=?').run(commit,executionId,owner);
        row = this.row(executionId);
      }
      const gitCommand = await this.gitFactory(directory,token,author);
      const git = async (...args) => { renew(); return gitCommand(...args); };
      if (await git('rev-parse','HEAD') !== row.commit_id || await git('status','--porcelain')) fail('The retained publication checkout changed',409);
      const refs = await git('ls-remote','origin');
      verifyCatalogueBranch(manifest.catalogue,target.branch,refs);
      let head = remoteHead(refs,target.branch);
      const containsPublication = async remote => {
        if (remote === row.commit_id) return true;
        if (!remote || remote === manifest.baseCommit) return false;
        const shallow = await fs.stat(path.join(directory,'.git/shallow')).then(() => true,error => { if (error.code === 'ENOENT') return false; throw error; });
        await git('fetch',...(shallow ? ['--unshallow'] : []),'origin','refs/heads/' + target.branch);
        // A later remote commit can still contain our already published commit.
        try { await git('merge-base','--is-ancestor',row.commit_id,'FETCH_HEAD'); return true; }
        catch { return false; }
      };
      if (!await containsPublication(head)) {
        if (head !== manifest.baseCommit || (head === null && refs)) fail('Remote changed before publication; inspect it before retrying',409);
        if (this.service.execution(executor,executionId).state === 'stop_requested') {
          this.store.db.prepare('UPDATE task_publications SET commit_id=NULL WHERE execution_id=? AND lease_owner=?').run(executionId,owner);
          fail('Publication stopped before push; acknowledge cancellation through finish',409);
        }
        this.running(executor,executionId);
        try { await git('push','origin',`${row.commit_id}:refs/heads/${target.branch}`); }
        catch (error) {
          // A lost push response is not proof of failure. Reconcile before allowing
          // a terminal failure or cancellation that could contradict publication.
          head = remoteHead(await git('ls-remote','origin','refs/heads/' + target.branch),target.branch);
          if (!await containsPublication(head)) {
            if (head === manifest.baseCommit) this.store.db.prepare('UPDATE task_publications SET commit_id=NULL WHERE execution_id=? AND lease_owner=?').run(executionId,owner);
            throw error;
          }
        }
        head = remoteHead(await git('ls-remote','origin','refs/heads/' + target.branch),target.branch);
        if (!await containsPublication(head)) fail('Push acknowledgement could not be confirmed. Retry publication to reconcile the remote.',502);
      }
      const receipt = { executionId, bookId: manifest.bookId, repository: target.remote, branch: target.branch,
        commit: row.commit_id, packageDigest: row.digest, publishedAt: new Date().toISOString() };
      this.store.db.prepare('UPDATE task_publications SET receipt=? WHERE execution_id=? AND lease_owner=?').run(JSON.stringify(receipt),executionId,owner);
      return this.complete(executor,executionId,receipt);
    } finally {
      this.store.db.prepare('UPDATE task_publications SET lease_until=0,lease_owner=NULL WHERE execution_id=? AND lease_owner=?').run(executionId,owner);
    }
  }
  complete(executor, executionId, receipt) {
    const status = this.service.status(executor,{executionId});
    if (status.state === 'completed') return { ...status, publication: receipt };
    const result = `Published ${receipt.bookId} to ${receipt.repository} (${receipt.branch}), commit ${receipt.commit}.`;
    return { ...this.service.finish(executor,{executionId,state:'completed',result}, { publication: true }), publication: receipt };
  }
}
function remoteHead(refs, branch) {
  const line = refs.split('\n').find(line => line.split('\t')[1] === 'refs/heads/' + branch);
  return line ? line.split('\t')[0] : null;
}
