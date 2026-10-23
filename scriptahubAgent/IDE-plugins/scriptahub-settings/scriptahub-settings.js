import { callAgentTool, ensureSuccess, parseToolResult } from '/explorer/services/infrastructure/explorerApi.js';
async function callSettings(name, args = {}) {
  const raw = await callAgentTool('scriptahubAgent', name, args, { raw: true });
  ensureSuccess(raw);
  const result = parseToolResult(raw) || {};
  if (result.error || result.ok === false) throw new Error(result.error || 'Settings request failed');
  return result;
}
export class ScriptaHubSettings {
  constructor(element, invalidate) { this.element = element; this.invalidate = invalidate; this.invalidate(); }
  beforeRender() {}
  afterRender() {
    this.repositories = this.element.querySelector('#scriptaRepositories');
    this.interval = this.element.querySelector('#scriptaSyncInterval');
    this.status = this.element.querySelector('#scriptaSettingsStatus');
    this.controls = this.element.querySelector('#scriptaSettingsControls');
    this.addButton = this.element.querySelector('[data-local-action="addRepository"]');
    this.items = [];
    void this.loadSettings();
  }
  message(text, error = false) { this.status.textContent = text; this.status.classList.toggle('error', error); }
  apply(settings) {
    this.items = settings.repositories.map(url => ({ url, draft: url, editing: false }));
    this.interval.value = settings.syncIntervalSeconds ?? 60;
    this.renderRepositories();
  }
  renderRepositories(focusItem) {
    const doc = this.element.ownerDocument;
    this.repositories.replaceChildren();
    this.addButton.disabled = this.items.length >= 100;
    if (!this.items.length) {
      const empty = doc.createElement('li');
      empty.className = 'scripta-repository-empty';
      empty.textContent = 'No repositories yet. Add one to load books into your catalogue.';
      this.repositories.append(empty);
    }
    for (const item of this.items) {
      const row = doc.createElement('li');
      row.className = 'scripta-repository';
      const content = doc.createElement('div');
      content.className = 'scripta-repository-content';
      const title = doc.createElement('strong');
      let name = item.url;
      try {
        const url = new URL(item.url);
        const parts = url.pathname.split('/').filter(Boolean);
        name = ['github.com', 'raw.githubusercontent.com'].includes(url.hostname) ? parts.slice(0, 2).join(' / ') : url.hostname;
      } catch { /* An unsaved item does not have a URL yet. */ }
      title.textContent = item.isNew ? 'New repository' : name;
      content.append(title);
      const actions = doc.createElement('div');
      actions.className = 'scripta-repository-actions';
      const button = (label, action, danger = false) => {
        const control = doc.createElement('button');
        control.type = 'button';
        control.className = 'gray-button' + (danger ? ' scripta-delete' : '');
        control.textContent = label;
        control.setAttribute('aria-label', `${label} ${title.textContent}`);
        control.addEventListener('click', action);
        actions.append(control);
      };
      if (item.editing) {
        const label = doc.createElement('label');
        label.className = 'form-item';
        const text = doc.createElement('span');
        text.textContent = 'Catalogue URL';
        const input = doc.createElement('input');
        input.className = 'form-input';
        input.type = 'url';
        input.required = true;
        input.maxLength = 4096;
        input.placeholder = 'https://github.com/owner/repo/blob/main/collection.json';
        input.spellcheck = false;
        input.value = item.draft;
        input.setAttribute('aria-describedby', 'scriptaSourcesHelp');
        input.addEventListener('input', () => { item.draft = input.value; });
        const done = () => {
          input.value = input.value.trim();
          if (!input.reportValidity()) return;
          item.url = item.draft = input.value;
          item.editing = false;
          item.isNew = false;
          this.renderRepositories(item);
        };
        const cancel = () => {
          if (item.isNew) this.items.splice(this.items.indexOf(item), 1);
          else { item.draft = item.url; item.editing = false; }
          this.renderRepositories(item);
          if (item.isNew) this.addButton.focus();
        };
        input.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (event.key === 'Enter') done(); else cancel();
          }
        });
        label.append(text, input);
        content.append(label);
        button('Done', done);
        button('Cancel', cancel);
      } else {
        const url = doc.createElement('p');
        url.className = 'scripta-repository-url';
        url.textContent = item.url;
        content.append(url);
        button('Edit', () => { item.editing = true; this.renderRepositories(item); });
        button('Delete', () => {
          this.items.splice(this.items.indexOf(item), 1);
          this.renderRepositories();
          this.addButton.focus();
          this.message('Repository removed from the list. Save changes to apply.');
        }, true);
      }
      row.append(content, actions);
      this.repositories.append(row);
      if (item === focusItem) (row.querySelector('input') || row.querySelector('button'))?.focus();
    }
  }
  addRepository() {
    if (this.items.length >= 100) return;
    const item = { url: '', draft: '', editing: true, isNew: true };
    this.items.push(item);
    this.renderRepositories(item);
    this.message('');
  }
  async loadSettings() {
    this.controls.disabled = true;
    this.message('Loading repositories…');
    try {
      this.apply((await callSettings('scriptahub_config_get')).settings);
      this.message('');
      this.controls.disabled = false;
    }
    catch (error) { this.message(error.message, true); }
  }
  async saveSettings() {
    for (const input of this.controls.querySelectorAll('input')) {
      input.value = input.value.trim();
      if (!input.reportValidity()) return;
    }
    this.controls.disabled = true;
    this.message('Validating catalogues…');
    try {
      const repositories = this.items.map(item => (item.editing ? item.draft : item.url).trim());
      const result = await callSettings('scriptahub_config_set', { repositories, syncIntervalSeconds: Number(this.interval.value) });
      this.apply(result.settings);
      this.message(`Settings saved. ${result.bookCount} books validated; the catalogue is refreshing.`);
    } catch (error) { this.message(error.message, true); }
    finally { this.controls.disabled = false; }
  }
  closeModal() { assistOS.UI.closeModal(this.element, null); }
}
