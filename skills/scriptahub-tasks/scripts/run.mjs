import {uploadBlockSize} from './callback-budget.mjs';
import {withExecutionLock} from './anchored-files.mjs';
import fs from 'node:fs/promises';
import {runBatchOperation} from './task-batch.mjs';
import {sharedEditorial} from './shared-editorial.mjs';
import {prepareReadingRoutes} from './prepare-reading-routes.mjs';
import {publishFromRobot} from './robot-publication.mjs';
import {runRemoteSkill,runRemoteSequence,releaseIncompleteRemote,discardTranslationJob,guardRemoteBackups} from './remote-skill.mjs';
import {localRenderingFiles} from './publication-files.mjs';
import {insideRun,preflight,writeHandoff,verifyPackage,requirePreflight} from './workflow-checks.mjs';
import {completeCreateBookPhase} from './create-book-completion.mjs';
import { constants } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import http from 'node:http';
import { fileURLToPath } from 'node:url';

const operations = { claim: 'scriptahub_task_claim', status: 'scriptahub_task_status', finish: 'scriptahub_task_finish' };
export function chooseRepository({ repositories, candidates } = {}) {
    if (!Array.isArray(repositories) || !Array.isArray(candidates) || !candidates.length) throw new Error('Provide configured repositories and matching candidates');
    const unique = [...new Set(candidates)];
    for (const candidate of unique) {
        if (typeof candidate !== 'string' || !repositories.includes(candidate)) throw new Error('Candidate is outside the configured repository list');
        const url = new URL(candidate);
        if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/collection.json')) throw new Error('Invalid catalogue URL');
    }
    return { repository: unique[crypto.randomInt(unique.length)], candidates: unique };
}
export function unwrap(response) {
    const encoded=Array.isArray(response?.content);
    const message = encoded ? response.content.filter(item => item.type === 'text').map(item => item.text).join('\n') : response?.isError ? response.message : undefined;
    let result=response;
    if(encoded && !message) throw new Error('Invalid ScriptaHub response');
    if (message) { try { result=JSON.parse(message); } catch { if(response?.isError) throw new Error(message); throw new Error('Invalid ScriptaHub response'); } }
    if (response?.isError || !result || result.error || result.ok === false) {
        throw Object.assign(new Error(result?.error || message || 'ScriptaHub rejected the task operation'), {
            ...(Number.isInteger(result?.status)?{status:result.status}:{}),
            ...(typeof result?.code==='string'?{code:result.code}:{}),
            ...(result?.admissionRejected===true?{admissionRejected:true}:{}),
        });
    }
    return result;
}

// RoboTeam's task runtime (context version 3) exposes a callback socket and a capability token.
// The RoboTeam controller relays each agent call with its own service identity; the robot holds no credentials.
export async function loadClient(directory = '/workspace/ploinky-runtime') {
    const setup = JSON.parse(await fs.readFile(path.join(directory, 'context.json'), 'utf8'));
    if (setup.version !== 3 || !path.isAbsolute(setup.workingDir || '') || typeof setup.token !== 'string' || !setup.token) throw new Error('A RoboTeam Ploinky task runtime is required');
    const agent = process.env.SCRIPTA_TASK_AGENT || 'scriptahubAgent';
    const socketPath = path.join(directory, 'request.sock');
    const callTool = (tool, payload = {}, { timeoutMs = 90000 } = {}) => new Promise((resolve, reject) => {
        const req = http.request({ socketPath, path: '/agent-call', method: 'POST',
            headers: { 'content-type': 'application/json', 'x-task-capability': setup.token } }, res => {
            const chunks = []; let size = 0;
            res.on('data', chunk => { size += chunk.length; if (size > 4 * 1024 * 1024) req.destroy(new Error('Task callback response is too large')); else chunks.push(chunk); });
            res.once('end', () => {
                try {
                    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
                    if (res.statusCode < 200 || res.statusCode >= 300) throw new Error(value?.error || 'Task callback refused');
                    resolve(value);
                } catch (error) { reject(error); }
            });
            res.once('error', reject);
        });
        req.setTimeout(timeoutMs, () => req.destroy(new Error('Task callback timed out')));
        req.once('error', reject);
        req.end(JSON.stringify({ agent, tool, payload }));
    });
    return { callTool, async close() {} };
}

export async function downloadDocument(call, input) {
    const { executionId, index, destination } = input;
    if (typeof destination !== 'string' || !destination || path.isAbsolute(destination)) throw new Error('Use a relative destination inside the working directory');
    const root = await fs.realpath(process.cwd());
    const target = path.resolve(root, destination);
    if (!target.startsWith(root + path.sep)) throw new Error('Destination must stay inside the working directory');
    let directory = root;
    for (const part of path.relative(root, path.dirname(target)).split(path.sep).filter(Boolean)) {
        directory = path.join(directory, part);
        await fs.mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
        const stat = await fs.lstat(directory);
        if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Destination directories must not be symlinks');
    }
    if (await fs.lstat(target).then(() => true, error => error.code === 'ENOENT' ? false : Promise.reject(error))) throw new Error('Destination already exists');
    const temporary = target + '.' + crypto.randomUUID() + '.partial';
    const handle = await fs.open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY, 0o600);
    const hash = crypto.createHash('sha256');
    let offset = 0, expected, total;
    try {
        while (true) {
            const chunk = await call('scriptahub_task_document_read', { executionId, index, offset, length: 196608 });
            if (chunk.encoding !== 'base64' || !/^[a-f0-9]{64}$/.test(chunk.sha256 || '')
                || !Number.isSafeInteger(chunk.size) || chunk.size < 1 || chunk.size > 50000000
                || chunk.offset !== offset || typeof chunk.data !== 'string' || chunk.data.length > 262144) throw new Error('Invalid document chunk');
            expected ??= chunk.sha256; total ??= chunk.size;
            const bytes = Buffer.from(chunk.data, 'base64');
            if (expected !== chunk.sha256 || total !== chunk.size || bytes.length < 1
                || chunk.nextOffset !== offset + bytes.length || chunk.nextOffset > total
                || chunk.eof !== (chunk.nextOffset === total)) throw new Error('Document changed during download');
            await handle.writeFile(bytes); hash.update(bytes); offset = chunk.nextOffset;
            if (chunk.eof) break;
        }
        if (offset !== total || hash.digest('hex') !== expected) throw new Error('Downloaded document checksum mismatch');
        await handle.sync();
        // link creates the final file without overwriting an existing destination.
        await fs.link(temporary, target);
        return { path: target, sha256: expected, size: offset };
    } finally { await handle.close(); await fs.rm(temporary, { force: true }); }
}

// Transfer validated bytes, never a server-side filesystem path or Git credential.
export async function publishPackage(call, input, {hook=async()=>{},stageOnly=false}={}) {
    return withExecutionLock(process.cwd(),input.executionId,async base=>{
    await guardRemoteBackups(base,input.executionId);
    await hook('guarded');
    const run = await fs.realpath(process.cwd());
    const localPath = async value => {
        if (typeof value !== 'string' || !value || path.isAbsolute(value)) throw new Error('Use paths relative to this run');
        const filename = path.resolve(run,value);
        if (!filename.startsWith(run + path.sep)) throw new Error('Package paths must stay inside this run');
        let current = run;
        for (const part of path.relative(run,filename).split(path.sep)) {
            current = path.join(current,part);
            if ((await fs.lstat(current)).isSymbolicLink()) throw new Error('Package paths must not contain symlinks');
        }
        return filename;
    };
    const readEvidence = async value => {
        const filename = await localPath(value);
        if ((await fs.stat(filename)).size > 100000) throw new Error('Publication evidence is too large');
        return await fs.readFile(filename);
    };
    const inventoryBytes = await readEvidence(input.inventory);
    const inventory = JSON.parse(inventoryBytes);
    const validation = JSON.parse(await readEvidence(input.validation));
    if (inventory.executionId !== input.executionId || inventory.publicationPermitted !== true || !Array.isArray(inventory.files)) throw new Error('Inventory does not approve this execution');
    if (validation.inventorySha256 && validation.inventorySha256 !== crypto.createHash('sha256').update(inventoryBytes).digest('hex')) {
        throw new Error('Approved inventory differs from the final validation');
    }
    if (validation.destination && (validation.destination.catalogue !== input.catalogue || validation.destination.branch !== input.branch
        || validation.destination.baseCommit !== inventory.baseCommit)) throw new Error('Publication destination differs from the final validation');
    const root = await localPath(input.packageRoot);
    const files = inventory.files.map(({path: file,sha256,size}) => ({path:file,sha256,size}));
    for (const entry of files) {
        if (typeof entry.path !== 'string' || entry.path.startsWith('/') || /[\\\0]/.test(entry.path) || entry.path.split('/').some(part => !part || part === '.' || part === '..')) throw new Error('Invalid inventory path');
        const filename = await localPath(path.relative(run,path.join(root,entry.path)));
        const stat = await fs.stat(filename);
        if (!stat.isFile() || stat.size !== entry.size || stat.size > 50000000) throw new Error('Inventory size mismatch: ' + entry.path);
        if (crypto.createHash('sha256').update(await fs.readFile(filename)).digest('hex') !== entry.sha256) throw new Error('Inventory checksum mismatch: ' + entry.path);
    }
    await call('scriptahub_task_package_prepare',{executionId:input.executionId,catalogue:input.catalogue,branch:input.branch,...(inventory.baseCommit === null ? {} : {baseCommit:inventory.baseCommit}),files,validation});
    for (const entry of files) {
        const filename = await localPath(path.relative(run,path.join(root,entry.path)));
        const handle = await fs.open(filename,constants.O_RDONLY | constants.O_NOFOLLOW);
        try {
            let offset = 0;
            while (offset < entry.size) {
                const buffer = Buffer.alloc(uploadBlockSize('scriptahub_task_package_upload',{executionId:input.executionId,file:entry.path,offset},entry.size-offset));
                const {bytesRead} = await handle.read(buffer,0,buffer.length,offset);
                if (bytesRead !== buffer.length) throw new Error('Package changed during transfer');
                const result = await call('scriptahub_task_package_upload',{executionId:input.executionId,file:entry.path,offset,data:buffer.toString('base64')});
                if (result.nextOffset !== offset + bytesRead) throw new Error('Invalid package upload acknowledgement');
                offset += bytesRead;
            }
        } finally { await handle.close(); }
    }
    return stageOnly ? {status:'staged'} : publishFromRobot(call,input.executionId);
    });
}

async function uploadModerationArtifact(call, {executionId, taskDirectory, file}) {
    if (!/^tasks\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(taskDirectory || '')
        || typeof file !== 'string' || !file.startsWith(taskDirectory + '/')) throw new Error('Use an artifact inside this task');
    return withExecutionLock(process.cwd(),executionId,async () => {
        const names = new Set([file]);
        const files = new Map();
        let total = 0;
        for (const name of names) {
            if (!name.startsWith(taskDirectory + '/') || name.split('/').some(part => !part || part.startsWith('.'))) {
                throw new Error('Invalid moderation artifact path');
            }
            const filename = await insideRun(name).catch(error => {
                if (name !== file && error.code === 'ENOENT') return null;
                throw error;
            });
            if (!filename) continue;
            const {size} = await fs.stat(filename);
            total += size;
            if (files.size >= 500 || size > 50000000 || total > 512000000) throw new Error('Moderation artifact inventory is too large');
            const bytes = await fs.readFile(filename);
            if (bytes.length !== size) throw new Error('Moderation artifact changed during preparation');
            files.set(name,bytes);
            if (/\.(?:html?|xhtml|css|svg)$/i.test(name)) {
                for (const dependency of localRenderingFiles(name,bytes.toString('utf8'))) {
                    if (dependency.startsWith(taskDirectory + '/')) names.add(dependency);
                }
            }
        }
        const tool = 'scriptahub_task_moderate';
        const payload = {executionId,stage:'artifact'};
        const inventory = [...files].map(([name,bytes]) => ({
            path:name,sha256:crypto.createHash('sha256').update(bytes).digest('hex'),size:bytes.length
        }));
        const prepared = await call(tool,{...payload,action:'prepare',file,files:inventory});
        if (prepared.status === 'passed' || ['failed','cancelled','completed','stop_requested'].includes(prepared.state)) return prepared;
        const {artifactId} = prepared;
        if (!/^[a-f0-9]{64}$/.test(artifactId || '')) throw new Error('Invalid moderation artifact receipt');
        for (const [name,bytes] of files) {
            for (let offset=0;offset<bytes.length;) {
                const chunk = {...payload,action:'upload',artifactId,file:name,offset};
                const block = bytes.subarray(offset,offset+uploadBlockSize(tool,chunk,bytes.length-offset));
                const response = await call(tool,{...chunk,data:block.toString('base64')});
                offset += block.length;
                if (response.nextOffset !== offset) throw new Error('Invalid moderation upload acknowledgement');
            }
        }
        return {artifactId,...await call(tool,{...payload,action:'next',artifactId})};
    });
}

export async function moderateContent(call,input) {
    const {executionId,stage,action,position,digest,verdict,category,taskDirectory,artifactId} = input;
    if (stage === 'artifact' && action === 'prepare') return uploadModerationArtifact(call,input);
    const payload = {executionId,stage,action,position,digest,verdict,category,artifactId};
    if (action !== 'image') return call('scriptahub_task_moderate',payload);
    if (!/^tasks\/[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(taskDirectory || '')
      || !Number.isSafeInteger(position) || position<0 || !/^[a-f0-9]{64}$/.test(digest || '')
      || !['submission','package','artifact'].includes(stage)
      || (stage === 'artifact' && !/^[a-f0-9]{64}$/.test(artifactId || ''))) throw new Error('Invalid review image destination');
    const directory = taskDirectory + '/moderation/' + stage;
    let current = await fs.realpath(process.cwd());
    for (const part of directory.split('/')) {
        current = path.join(current,part);
        await fs.mkdir(current,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
        if (!(await fs.lstat(current)).isDirectory()) throw new Error('Invalid review image directory');
    }
    const image = directory + '/' + position + '-' + digest + '.png';
    const temp = image + '.' + crypto.randomUUID();
    let offset = 0;
    const file = await fs.open(temp,'wx',0o600);
    try {
        try {
            let size;
            do {
                const chunk = await call('scriptahub_task_moderate',{...payload,offset});
                const bytes = Buffer.from(chunk.data || '', 'base64');
                size ??= chunk.size;
                if (!bytes.length || chunk.size !== size || !Number.isSafeInteger(size)
                  || chunk.nextOffset !== offset+bytes.length || chunk.nextOffset>size) throw new Error('Invalid moderation image chunk');
                await file.writeFile(bytes);
                offset = chunk.nextOffset;
            } while (offset < size);
        } finally { await file.close(); }
        await fs.rename(temp,image);
        return {image};
    } finally { await fs.rm(temp,{force:true}); }
}

export async function retryPublication(call,input,{root=process.cwd(),stderr=process.stderr}={}) {
    try { await guardRemoteBackups(await fs.realpath(root),input.executionId); }
    catch (error) {
      stderr.write('Local processing conflict remains: '+error.message+'\n');
      return call('scriptahub_task_publish',{executionId:input.executionId,action:'confirm'});
    }
    return withExecutionLock(root,input.executionId,()=>publishFromRobot(call,input.executionId));
}

async function main() {
  let client;
  try {
    const operation = process.argv[2];
    if (process.argv.length !== 3 || (!operations[operation] && !['batch-start', 'batch-status', 'batch-next', 'batch-close', 'batch-defer', 'exec', 'exec-sequence', 'release-incomplete', 'discard-translation-job', 'download', 'choose', 'moderate-content', 'stage-publication', 'publish', 'retry-publication', 'preflight', 'handoff', 'verify-package', 'prepare-reading-routes', 'shared-editorial', 'complete-phase'].includes(operation))) throw new Error('Use batch-start, batch-status, batch-next, batch-close, batch-defer, exec, exec-sequence, preflight, claim, status, moderate-content, download, choose, handoff, shared-editorial, prepare-reading-routes, verify-package, complete-phase, stage-publication, publish, retry-publication or finish');
    const chunks = [];
    let size = 0;
    for await (const chunk of process.stdin) {
        size += chunk.length;
        if (operation !== 'handoff' && size > 65536) throw new Error('Task input is too large');
        chunks.push(chunk);
    }
    const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Provide a JSON object');
    if (['handoff','verify-package'].includes(operation)) {
        const result = operation === 'handoff' ? await writeHandoff(input) : await verifyPackage(input);
        process.stdout.write(JSON.stringify(result) + '\n'); return;
    }
    if (operation === 'shared-editorial') {
        process.stdout.write(JSON.stringify(await sharedEditorial(input)) + '\n');
        return;
    }
    if (operation === 'prepare-reading-routes') {
        process.stdout.write(JSON.stringify(await prepareReadingRoutes(input)) + '\n');
        return;
    }
    if (operation === 'choose') {
        process.stdout.write(JSON.stringify(chooseRepository(input)) + '\n');
        return;
    }
    if (operation === 'claim' || operation === 'batch-next') await requirePreflight();
    client = await loadClient();
    const call = async (tool, args) => unwrap(await client.callTool(tool, args, { timeoutMs: ['scriptahub_task_publish','scriptahub_task_moderate'].includes(tool) ? 600000 : 90000 }));
    if (operation === 'claim' || operation === 'batch-next') await preflight(await call('scriptahub_skills_preflight',{}));
    if (operation === 'exec') { process.exitCode = await runRemoteSkill(input,call); return; }
    if (operation === 'exec-sequence') { process.exitCode = await runRemoteSequence(input,call); return; }
    if (operation === 'discard-translation-job') { process.stdout.write(JSON.stringify(await discardTranslationJob(input,call))+'\n'); return; }
    if (operation === 'release-incomplete') { const exitCode = await releaseIncompleteRemote(input,call); process.stdout.write(JSON.stringify({released:true,executionId:input.executionId,originalExitCode:exitCode})+'\n'); return; }
    if (operation === 'preflight') { const receipt = await call('scriptahub_skills_preflight',{}); await preflight(receipt); process.stdout.write(JSON.stringify(receipt)+'\n'); return; }
    const result = operation.startsWith('batch-') ? await runBatchOperation(call,operation,input)
      : operation === 'complete-phase' ? await completeCreateBookPhase(input,call)
      : operation === 'download' ? await downloadDocument(call,input)
      : operation === 'moderate-content' ? await moderateContent(call,input)
      : operation === 'stage-publication' ? await publishPackage(call,input,{stageOnly:true})
      : operation === 'publish' ? await publishPackage(call,input)
      : operation === 'retry-publication' ? await retryPublication(call,input)
      : await call(operations[operation],input);
    process.stdout.write(JSON.stringify(result) + '\n');
  } catch (error) {
    console.error(error.code === 'ENOENT' && String(error.path || '').startsWith('/workspace/ploinky-runtime/') ? 'The RoboTeam Ploinky task runtime is unavailable' : error.message);
    process.exitCode = 1;
  } finally { await client?.close(); }
}

if (process.argv[1] && await fs.realpath(process.argv[1]) === await fs.realpath(fileURLToPath(import.meta.url))) await main();
