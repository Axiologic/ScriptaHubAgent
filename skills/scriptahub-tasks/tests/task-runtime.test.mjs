import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { loadClient } from '../scripts/run.mjs';

// Unix socket paths are limited to 104 bytes on macOS, so keep the fixture short.
async function runtimeFixture(context, handler) {
    const directory = await fs.mkdtemp('/tmp/sht-');
    await fs.writeFile(path.join(directory, 'context.json'), JSON.stringify(context));
    const requests = [];
    const server = http.createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const request = { method: req.method, url: req.url, capability: req.headers['x-task-capability'], body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
        requests.push(request);
        const [status, body] = await handler(request);
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(body));
    });
    await new Promise(resolve => server.listen(path.join(directory, 'request.sock'), resolve));
    return { directory, requests, async close() { await new Promise(resolve => server.close(resolve)); await fs.rm(directory, { recursive: true, force: true }); } };
}

const v3 = { version: 3, workingDir: '/workspace/run', resources: [], paths: [], origin: {}, token: 'a'.repeat(64), eventToken: 'a'.repeat(64) };

test('the task client relays service calls through the RoboTeam v3 callback socket', async () => {
    const reply = { content: [{ type: 'text', text: JSON.stringify({ task: null }) }] };
    const fixture = await runtimeFixture(v3, () => [200, reply]);
    try {
        const client = await loadClient(fixture.directory);
        assert.deepEqual(await client.callTool('scriptahub_task_claim', { runId: 'r1' }, { timeoutMs: 5000 }), reply);
        assert.deepEqual(fixture.requests, [{ method: 'POST', url: '/agent-call', capability: v3.token,
            body: { agent: 'scriptahubAgent', tool: 'scriptahub_task_claim', payload: { runId: 'r1' } } }]);
        await client.close();
    } finally { await fixture.close(); }
});

test('the task client reports refused callbacks and rejects an invalid runtime context', async () => {
    const fixture = await runtimeFixture(v3, () => [403, { error: 'Callback refused' }]);
    try {
        const client = await loadClient(fixture.directory);
        await assert.rejects(client.callTool('scriptahub_task_status', { executionId: 'e' }), /Callback refused/);
    } finally { await fixture.close(); }
    for (const context of [{ ...v3, version: 2 }, { ...v3, token: '' }, { ...v3, workingDir: 'relative' }]) {
        const invalid = await runtimeFixture(context, () => [200, {}]);
        try { await assert.rejects(loadClient(invalid.directory), /RoboTeam Ploinky task runtime is required/); }
        finally { await invalid.close(); }
    }
});
