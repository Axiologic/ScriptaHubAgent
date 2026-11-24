export class ScriptaHubToolButton {
    constructor(element, invalidate) {
        this.element = element;
        this.hostContext = {};
        invalidate();
    }

    beforeRender() {}

    afterRender() {
        if (!this.element.isConnected) return;
        this.button?.removeEventListener('click', this.openScriptaHub);
        this.button = this.element.querySelector('button');
        this.syncButtonMetadata();
        this.button?.addEventListener('click', this.openScriptaHub);
    }

    afterUnload() {
        this.button?.removeEventListener('click', this.openScriptaHub);
    }

    updateHostContext(context = {}) {
        this.hostContext = context;
        this.syncButtonMetadata();
    }

    syncButtonMetadata() {
        const label = this.hostContext.pluginLabel || this.element.getAttribute('data-plugin-label') || 'ScriptaHub';
        const tooltip = this.hostContext.pluginTooltip || this.element.getAttribute('data-plugin-tooltip') || label;
        const icon = this.hostContext.pluginIcon || this.element.getAttribute('data-plugin-icon');
        const labelElement = this.element.querySelector('.app-plugin-tool-label');
        const image = this.element.querySelector('img');
        if (labelElement) labelElement.textContent = label;
        if (image && icon) image.src = icon;
        if (this.button) {
            this.button.title = tooltip;
            this.button.setAttribute('aria-label', tooltip);
        }
    }

    openScriptaHub = (event) => {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const descriptor = this.hostContext.pluginToolbarModal;
        const openExpandedModal = globalThis.assistOS?.UI?.openExpandedModal;
        if (!descriptor || typeof openExpandedModal !== 'function') {
            globalThis.assistOS?.showToast?.('ScriptaHub could not be opened.', 'error', 3000);
            return;
        }
        void openExpandedModal({ ...descriptor, title: this.hostContext.pluginLabel || descriptor.title });
    };
}
