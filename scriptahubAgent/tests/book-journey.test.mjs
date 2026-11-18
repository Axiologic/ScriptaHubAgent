// Integration boundary: real intake, SQLite, transfer, Git push and site rendering.
// AI output is a fixed fixture; this does not claim to exercise an AI workflow.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {DashboardStore} from '../dashboard-store.mjs';
import {TaskExecution} from '../task-execution.mjs';
import {TaskPublication} from '../task-publication.mjs';
import {PublicationAccessStore} from '../publication-access.mjs';
import {publicationGit} from '../publication-git.mjs';
import {sha256} from '../publication-transfer.mjs';
import {createSiteServer} from '../server.mjs';
import {buildSnapshot, combineCollections} from '../sync.mjs';

process.env.SCRIPTA_RECORD_KEY = 'journey-tests-only-key-012345678901234567890';
const exec = promisify(execFile);
const executor = 'agent:test/journey';
const mount = '/base-agent-additional-server/scriptahubAgent/3002/';

for (const language of ['en', 'ro']) test(`HTTP proposal → Git receipt → legacy landing → distinct full/short resources (${language})`, {timeout: 45_000}, async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-journey-'));
  const dataDir = path.join(root, 'data'), seed = path.join(root, 'seed'), remote = path.join(root, 'remote.git');
  const servers = [];
  let store;
  t.after(async () => {
    for (const server of servers.reverse()) {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
    store?.close();
    await fs.rm(root, {recursive:true, force:true});
  });
  const listen = async server => {
    servers.push(server);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    return `http://127.0.0.1:${server.address().port}${mount}`;
  };
  const git = async (cwd, ...args) => (await exec(process.env.SCRIPTA_TEST_GIT || 'git', args, {cwd, env:{...process.env,
    GIT_CONFIG_GLOBAL:'/dev/null', GIT_CONFIG_NOSYSTEM:'1', GIT_AUTHOR_NAME:'Journey Test', GIT_AUTHOR_EMAIL:'test@example.test',
    GIT_COMMITTER_NAME:'Journey Test', GIT_COMMITTER_EMAIL:'test@example.test'}})).stdout.trim();
  await fs.mkdir(seed);
  await git(root, 'init', '--bare', remote);
  await git(seed, 'init', '--initial-branch=main');
  await fs.writeFile(path.join(seed, 'collection.json'), JSON.stringify({schemaVersion:1, bookCount:0, books:[]}));
  await git(seed, 'add', '.'); await git(seed, 'commit', '-m', 'Empty test catalogue');
  await git(seed, 'remote', 'add', 'origin', remote); await git(seed, 'push', 'origin', 'main');
  const baseCommit = await git(seed, 'rev-parse', 'HEAD');
  const intake = await listen(createSiteServer(seed, {dataDir, verifyUser:async req => req.headers['x-test-user'] === 'owner'
    ? {id:'user:owner', email:'owner@example.test', displayName:'Owner'} : null}));
  const submissionId = randomUUID();
  const submit = authenticated => {
    const body = new FormData();
    body.set('metadata', JSON.stringify({submissionId, kind:'book-proposal', language,
      agreementVersion:'2026-09-10', agreementAccepted:true,
      values:{titles:'Journey book', description:'A complete book about community gardens.', audience:'General readers'}}));
    return fetch(intake + 'api/submissions', {method:'POST', body, headers:authenticated ? {'x-test-user':'owner'} : {}});
  };
  assert.equal((await submit(false)).status, 401);
  const accepted = await submit(true);
  assert.equal(accepted.status, 202);
  const receipt = await accepted.json();
  assert.deepEqual(await (await submit(true)).json(), receipt, 'same submission must not create another task');
  store = new DashboardStore(dataDir);
  const service = new TaskExecution(store, dataDir);
  const task = service.claim(executor, {runId:'journey-' + language, taskType:'book-proposal'}).task;
  assert.equal(task.taskId, receipt.task.id);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM tasks').get().n, 1);
  const directory = `books/journey/${task.bookId}`;
  const fullPath = `${directory}/${language}/full_content.html`, shortPath = `${directory}/${language}/short_content.html`;
  const full = '<!doctype html><html><body><h1>Journey book</h1><h2>Full chapter</h2><p>FULL-BOOK-ONLY ' + 'Detailed source material. '.repeat(150) + '</p></body></html>';
  const short = '<!doctype html><html><body><h1>In ten minutes</h1><p>SHORT-SUMMARY-ONLY</p></body></html>';
  const book = {id:task.bookId, directory, title:{[language]:'Journey book'}, keywordIds:[],
    keywords:Object.fromEntries(['en','fr','de','es','pt','it','ro','pl'].map(code => [code, []])),
    editions:{[language]:{book:`${directory}/${language}/book.html`, fullContent:fullPath, shortContent:shortPath}}};
  const files = new Map([
    ['collection.json', Buffer.from(JSON.stringify({schemaVersion:1, bookCount:1, books:[book], keywords:combineCollections([book]).keywords}))],
    [directory + '/manifest.json', Buffer.from(JSON.stringify({id:task.bookId}))],
    [directory + '/editions.json', Buffer.from(JSON.stringify({bookId:task.bookId, currentEdition:'edition-1', editions:[{id:'edition-1'}]}))],
    [book.editions[language].book, Buffer.from('<!doctype html><html><body>Legacy landing</body></html>')],
    [fullPath, Buffer.from(full)], [shortPath, Buffer.from(short)],
  ]);
  const catalogue = 'https://github.com/example/journey/blob/main/collection.json';
  const config = {repositories:[catalogue], publication:{authorName:'Test', authorEmail:'test@example.test'}};
  const access = new PublicationAccessStore(dataDir);
  access.update(state => {state.connection={token:'test-only-token', publication:config.publication, user:{login:'test'}};});
  access.close();
  let pushes = 0;
  const publisher = new TaskPublication(service, {gitFactory:async (...args) => {
    const run = await publicationGit(...args);
    return async (...command) => {
      if (command[0] === 'remote' && command[1] === 'add') command[3] = remote;
      if (command[0] === 'push') pushes++;
      return run(...command);
    };
  }});
  publisher.prepare(executor, {executionId:task.executionId, catalogue, branch:'main', baseCommit,
    files:[...files].map(([path, bytes]) => ({path, size:bytes.length, sha256:sha256(bytes)})),
    validation:{executionId:task.executionId, runId:task.runId, bookId:task.bookId, publicationPermitted:true,
      audit:{autoCorrect:false, status:'passed_with_warnings', errorFindings:0, scope:'html_layout_integrity', nativeScope:'edition_layout_regression', existingFindings:0}}}, config);
  for (const [file, bytes] of files) publisher.upload(executor, {executionId:task.executionId, file, offset:0, data:bytes.toString('base64')});
  assert.throws(() => service.finish(executor, {executionId:task.executionId, state:'completed', result:'Unverified success'}), /Only ScriptaHub/);
  const published = await publisher.publish(executor, {executionId:task.executionId}, config);
  assert.equal(published.state, 'completed');
  assert.equal(await git(remote, 'rev-parse', 'refs/heads/main'), published.publication.commit);
  assert.deepEqual(await publisher.publish(executor, {executionId:task.executionId}, config), published);
  assert.equal(pushes, 1);
  await git(seed, 'pull', '--ff-only', 'origin', 'main');
  const snapshot = await buildSnapshot({config:{schemaVersion:1, repositories:[{id:'journey', baseUrl:intake}]},
    dataDir:path.join(root, 'snapshot'), allowLocal:true});
  const site = await listen(createSiteServer(snapshot.site, {dataDir:path.join(root, 'reader-data')}));
  const landing = await fetch(site + book.editions[language].book);
  assert.equal(landing.status, 200);
  const markup = await landing.text();
  for (const [format, expected, unwanted] of [['read', full, 'SHORT-SUMMARY-ONLY'], ['short', short, 'FULL-BOOK-ONLY']]) {
    const href = markup.match(new RegExp(`data-reading-format="${format}"[^>]*href="([^"]+)"`))?.[1];
    assert.ok(href, `landing must offer ${format}, including when English is unavailable`);
    const reader = new URL(href.replaceAll('&amp;', '&'), landing.url);
    assert.equal(reader.searchParams.get('language'), language);
    assert.equal((await fetch(reader)).status, 200);
    const resource = await fetch(new URL(reader.searchParams.get('html'), reader));
    assert.equal(resource.status, 200);
    const bytes = await resource.text();
    assert.equal(bytes, expected, 'served bytes must match the resource pushed to Git');
    assert.ok(!bytes.includes(unwanted), 'full book and summary must never be swapped');
  }
});
