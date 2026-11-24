import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ScriptaHubToolButton } from '../IDE-plugins/scriptahub-tool-button/scriptahub-tool-button.js';

test('toolbar launcher uses the host modal descriptor and removes its click listener on unload', async () => {
    const config = JSON.parse(await readFile(new URL('../IDE-plugins/scriptahub-tool-button/config.json', import.meta.url)));
    const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
    assert.equal(config.toolbarModal.url, `${manifest.routerAccess.entryPath}index.html`);
    assert.ok(manifest.routerAccess.httpRoutes.some(route => route.path === config.toolbarModal.url));
    assert.equal(config.toolbarModal.agentRef, 'ScriptaHubAgent/scriptahubAgent');
    const listeners = new Set();
    const button = { setAttribute() {}, addEventListener: (_, fn) => listeners.add(fn), removeEventListener: (_, fn) => listeners.delete(fn) };
    const label = {};
    const image = {};
    const element = { isConnected: true, getAttribute() {}, querySelector: selector => selector === 'button' ? button : selector === 'img' ? image : label };
    let renders = 0;
    let opened;
    const previous = globalThis.assistOS;
    globalThis.assistOS = { UI: { openExpandedModal: descriptor => { opened = descriptor; } } };
    try {
        const presenter = new ScriptaHubToolButton(element, () => { renders += 1; });
        presenter.updateHostContext({ pluginLabel: 'ScriptaHub', pluginIcon: '/resolved/icon.svg', pluginToolbarModal: config.toolbarModal });
        presenter.beforeRender();
        presenter.afterRender();
        presenter.beforeRender();
        presenter.afterRender();
        assert.equal(renders, 1);
        assert.equal(listeners.size, 1);
        [...listeners][0]({ preventDefault() {}, stopPropagation() {} });
        assert.deepEqual(opened, { ...config.toolbarModal, title: 'ScriptaHub' });
        assert.equal(image.src, '/resolved/icon.svg');
        presenter.afterUnload();
        assert.equal(listeners.size, 0);
    } finally {
        if (previous === undefined) delete globalThis.assistOS;
        else globalThis.assistOS = previous;
    }
});
