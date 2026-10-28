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
    this.repositoryCount = this.element.querySelector('#scriptaRepositoryCount');
    this.interval = this.element.querySelector('#scriptaSyncInterval');
    this.publicationStatus = this.element.querySelector('#scriptaPublicationStatus');
    this.tabs = [...this.element.querySelectorAll('[data-scripta-tab]')];
    for (const tab of this.tabs) {
      tab.addEventListener('click', () => this.selectTab(tab.dataset.scriptaTab));
      tab.addEventListener('keydown', event => {
        const index = this.tabs.indexOf(tab);
        const next = event.key === 'ArrowRight' ? (index + 1) % this.tabs.length
          : event.key === 'ArrowLeft' ? (index + this.tabs.length - 1) % this.tabs.length
          : event.key === 'Home' ? 0 : event.key === 'End' ? this.tabs.length - 1 : null;
        if (next === null) return;
        event.preventDefault(); this.selectTab(this.tabs[next].dataset.scriptaTab); this.tabs[next].focus();
      });
    }
    this.gitName = this.element.querySelector('#scriptaGitName');
    this.gitEmail = this.element.querySelector('#scriptaGitEmail');
    this.githubStatus = this.element.querySelector('#scriptaGithubStatus');
    this.authBusy = false; this.closed = false;
    for (const radio of this.element.querySelectorAll('[name=scriptaGitMethod]')) radio.addEventListener('change', () => {
      this.methodChosen = true; this.setAuthMethod(radio.value);
      if (radio.value === 'github') void this.ensureGithubAuthorization();
    });
    this.gitToken = this.element.querySelector('#scriptaGitToken');
    for (const input of [this.gitName, this.gitEmail, this.gitToken]) {
      input.addEventListener('change', () => void this.savePublication());
      input.addEventListener('keydown', event => {
        if (event.key === 'Enter') { event.preventDefault(); void this.savePublication(); }
      });
    }
    this.status = this.element.querySelector('#scriptaSettingsStatus');
    this.controls = this.element.querySelector('#scriptaSettingsControls');
    this.addButton = this.element.querySelector('[data-local-action="addRepository"]');
    this.items = [];
    void this.loadSettings();
  }
  message(text, error = false) { this.status.textContent = text; this.status.classList.toggle('error', error); }
  apply(settings, {publication = true} = {}) {
    this.items = settings.repositories.map(url => ({ url, draft: url, editing: false }));
    this.interval.value = settings.syncIntervalSeconds ?? 60;
    if (publication) {
      this.publicationConfigured = Boolean(settings.publication);
      this.publicationStatus.textContent = settings.publication ? 'Access configured' : 'Access not configured';
      this.publicationStatus.dataset.state = settings.publication ? 'configured' : 'unconfigured';
      this.publicationStatus.title = 'Configuration status; Git permissions are checked when publishing.';
      this.gitName.value = settings.publication?.authorName || '';
      this.gitEmail.value = settings.publication?.authorEmail || '';
      this.gitToken.value = '';
    }
    this.renderRepositories();
  }
  selectTab(name) {
    for (const tab of this.tabs) {
      const selected = tab.dataset.scriptaTab === name;
      tab.classList.toggle('active',selected);
      tab.setAttribute('aria-selected',String(selected));
      tab.tabIndex = selected ? 0 : -1;
      this.element.querySelector('#' + tab.getAttribute('aria-controls')).hidden = !selected;
    }
    if (name === 'publication' && !this.authLoaded && !this.authBusy) void this.loadPublicationAuth();
  }
  renderRepositories(focusItem) {
    const doc = this.element.ownerDocument;
    this.repositories.replaceChildren();
    this.repositoryCount.textContent = String(this.items.length);
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
          if (!input.checkValidity()) {
        const panel = input.closest('[role=tabpanel]');
        const tab = this.tabs.find(tab => tab.getAttribute('aria-controls') === panel?.id);
        if (tab) this.selectTab(tab.dataset.scriptaTab);
        input.reportValidity(); return;
      }
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
    this.repositories.setAttribute('aria-busy','true');
    this.message('Loading repositories…');
    try {
      this.apply((await callSettings('scriptahub_config_get')).settings);
      this.message('');
      this.controls.disabled = false;
    }
    catch (error) {
      this.repositories.replaceChildren();
      const failed = this.element.ownerDocument.createElement('li');
      failed.className = 'scripta-repository-empty';
      failed.textContent = 'Configured repositories could not be loaded.';
      this.repositories.append(failed);
      this.message(error.message, true);
    }
    finally { this.repositories.setAttribute('aria-busy','false'); }
  }
  async saveSettings() {
    const panel = this.element.querySelector('#scriptaRepositoriesPanel');
    for (const input of panel.querySelectorAll('input')) {
      input.value = input.value.trim();
      if (!input.checkValidity()) { input.reportValidity(); return; }
    }
    this.controls.disabled = true;
    this.message('Validating catalogues…');
    try {
      const repositories = this.items.map(item => (item.editing ? item.draft : item.url).trim());
      const result = await callSettings('scriptahub_config_set', { repositories, syncIntervalSeconds: Number(this.interval.value) });
      if (this.closed) return;
      this.apply(result.settings, {publication:false});
      this.message(`Settings saved. ${result.bookCount} books validated; the catalogue is refreshing.`);
    } catch (error) { if (!this.closed) this.message(error.message, true); }
    finally { if (!this.closed) this.controls.disabled = false; }
  }
  async savePublication() {
    if (this.closed) return;
    if (this.authBusy) { this.publicationSavePending = true; return; }
    const hasToken = this.selectedAuthMethod() === 'token' && Boolean(this.gitToken.value);
    if (!hasToken && (!this.gitConnected || this.authPending)) return;
    for (const input of [this.gitName, this.gitEmail]) {
      input.value = input.value.trim();
      if (!input.value && !hasToken) return;
      if (!input.checkValidity()) { input.reportValidity(); return; }
    }
    if (!hasToken && this.savedGitName === this.gitName.value && this.savedGitEmail === this.gitEmail.value) return;
    this.message(hasToken ? 'Validating and saving token…' : 'Saving Git identity…');
    const result = await this.authenticate(hasToken ? 'token' : 'connect');
    if (result?.authorized) this.message('Publication access saved.');
  }
  selectedAuthMethod() {
    return this.element.querySelector('[name=scriptaGitMethod]:checked')?.value || 'token';
  }
  setAuthMethod(method) {
    const value = method === 'github' ? 'github' : 'token';
    for (const radio of this.element.querySelectorAll('[name=scriptaGitMethod]')) radio.checked = radio.value === value;
    this.element.querySelector('#scriptaTokenPanel').hidden = value !== 'token';
    this.element.querySelector('#scriptaGithubPanel').hidden = value !== 'github';
    clearTimeout(this.authTimer);
    if (value !== 'github') this.clearGithubWatch();
    this.updateGithubControls();
  }
  async loadPublicationAuth() {
    const result = await this.authenticate('status');
    if (result && this.selectedAuthMethod() === 'github') await this.ensureGithubAuthorization();
  }
  async ensureGithubAuthorization() {
    if (this.closed || this.authBusy || this.selectedAuthMethod() !== 'github') return;
    if (!this.authLoaded && !await this.authenticate('status')) return;
    if (!this.authPending && !(this.gitConnected && this.connectionMethod === 'github')) await this.authenticate('begin');
    else this.scheduleGithubPoll();
  }
  scheduleGithubPoll() {
    clearTimeout(this.authTimer);
    if (!this.authPending || this.closed || this.selectedAuthMethod() !== 'github') return;
    this.authTimer = setTimeout(() => { if (this.element.isConnected) void this.authenticate('poll'); },Math.max(5,this.authInterval || 5)*1000);
  }
  updateGithubControls() {
    this.element.querySelector('#scriptaGithubSpinner').hidden = !this.authBusy;
    this.element.querySelector('#scriptaDisconnectGit').disabled = Boolean(this.authBusy);
    this.element.querySelector('#scriptaGithubDisconnect').disabled = Boolean(this.authBusy);
    const button = this.element.querySelector('#scriptaGithubContinue');
    button.disabled = Boolean(this.authBusy || this.githubContinueLoading) || !this.authPending;
    button.setAttribute('aria-busy',String(Boolean(this.githubContinueLoading)));
    this.element.querySelector('#scriptaGithubContinueSpinner').hidden = !this.githubContinueLoading;
  }
  async authenticate(action, {keepDisabled = false} = {}) {
    if (this.authBusy || this.closed) return;
    clearTimeout(this.authTimer); this.authBusy = true;
    if (action === 'token') this.gitToken.readOnly = true;
    this.updateGithubControls();
    try {
      const result = await callSettings('scriptahub_publication_auth', {action,
        ...(['token','connect','poll'].includes(action) ? {authorName:this.gitName.value.trim(), authorEmail:this.gitEmail.value.trim()} : {}),
        ...(action === 'token' ? {token:this.gitToken.value} : {})});
      if (this.closed) return;
      this.authLoaded = true;
      this.savedGitName = result.publication?.authorName || '';
      this.savedGitEmail = result.publication?.authorEmail || '';
      if (action === 'token' || action === 'disconnect') this.gitToken.value = '';
      this.gitConnected = result.connected; this.connectionMethod = result.method;
      this.authPending = Boolean(result.pending); this.authInterval = result.pending?.interval;
      this.githubUserCode = result.pending?.userCode || ''; this.githubVerificationUri = '';
      this.publicationConfigured = Boolean(result.publication);
      this.publicationStatus.textContent = result.publication ? 'Access configured' : 'Access not configured';
      this.publicationStatus.dataset.state = result.publication ? 'configured' : 'unconfigured';
      if (!this.methodChosen && result.method) this.setAuthMethod(result.method);
      this.element.querySelector('#scriptaDisconnectGit').hidden = !result.connected && !result.pending;
      this.element.querySelector('#scriptaGithubDisconnect').hidden = !(result.connected && result.method === 'github');
      this.element.querySelector('#scriptaTokenStoredNotice').hidden = !result.connected;
      if (!this.gitName.value) this.gitName.value = result.publication?.authorName || result.user?.login || result.user?.name || '';
      if (!this.gitEmail.value) this.gitEmail.value = result.publication?.authorEmail || result.user?.email || '';
      this.githubStatus.textContent = result.pending ? 'Waiting for GitHub authorization…'
        : result.connected && result.method === 'github' ? `Connected${result.user?.login ? ' as ' + result.user.login : ''}.`
        : 'Not connected.';
      this.element.querySelector('#scriptaGithubAuth').dataset.state = result.connected && result.method === 'github' ? 'connected' : 'disconnected';
      this.element.querySelector('#scriptaGithubPending').hidden = !result.pending;
      this.element.querySelector('#scriptaGithubCode').textContent = this.githubUserCode;
      if (result.pending) {
        const url = new URL(result.pending.verificationUri);
        if (url.href !== 'https://github.com/login/device') throw new Error('Invalid GitHub verification destination');
        this.githubVerificationUri = url.href;
      } else this.clearGithubWatch();
      this.scheduleGithubPoll();
      if (action !== 'status' && action !== 'poll') this.message(result.authorized ? 'Publication access saved.' : action === 'disconnect' ? 'Stored credentials cleared.' : '');
      if (result.needsIdentity) this.message('Enter a Git author name and email; they are saved automatically after editing.');
      return result;
    } catch (error) {
      if (!this.closed) {
        if (action === 'poll' || action === 'begin') {
          this.authPending = false; this.clearGithubWatch();
          this.element.querySelector('#scriptaGithubPending').hidden = true;
          this.githubStatus.textContent = error.message;
        }
        this.message(error.message,true);
      }
    } finally {
      this.authBusy = false;
      if (action === 'token') this.gitToken.readOnly = false;
      if (!this.closed) {
        this.updateGithubControls();
        if (!keepDisabled) this.controls.disabled = false;
        if (this.publicationSavePending) { this.publicationSavePending = false; void this.savePublication(); }
      }
    }
  }
  async copyGithubCode() {
    if (!this.githubUserCode) return false;
    if (globalThis.navigator?.clipboard?.writeText) {
      try { await globalThis.navigator.clipboard.writeText(this.githubUserCode); return true; } catch { /* Use GitAgent's legacy clipboard path on HTTP/LAN deployments. */ }
    }
    const doc = this.element.ownerDocument, textarea = doc.createElement('textarea');
    textarea.value = this.githubUserCode; textarea.setAttribute('readonly','');
    Object.assign(textarea.style,{position:'fixed',top:'-1000px',left:'-1000px',opacity:'0'});
    const focus = doc.activeElement;
    try { doc.body.append(textarea); textarea.focus(); textarea.select(); return doc.execCommand('copy'); }
    finally { textarea.remove(); focus?.focus(); }
  }
  async continueGithubAuth() {
    if (this.githubContinueLoading || !this.authPending || !this.githubUserCode || this.githubVerificationUri !== 'https://github.com/login/device') return;
    this.clearGithubWatch(); this.githubContinueLoading = true; this.updateGithubControls();
    const copied = await this.copyGithubCode();
    let handle;
    try { handle = window.open(this.githubVerificationUri,'_blank'); if (handle) handle.opener = null; } catch { /* Report blocked popups without changing authentication. */ }
    if (handle && this.authPending && !this.closed) this.githubWindowTimer = setInterval(() => {
      if (handle.closed) { this.clearGithubWatch(); this.updateGithubControls(); }
    },1000);
    else { this.clearGithubWatch(); this.updateGithubControls(); }
    const message = copied && handle ? 'Code copied. GitHub verification opened in a new tab.'
      : handle ? 'Could not copy the code automatically. Copy the code above, then continue in GitHub.'
      : 'GitHub could not be opened. Open github.com/login/device and enter the code above.';
    if (globalThis.assistOS?.showToast) await globalThis.assistOS.showToast(message,copied && handle ? 'success' : 'warning',4000);
    else this.message(message, !handle);
  }
  clearGithubWatch() { clearInterval(this.githubWindowTimer); this.githubWindowTimer = null; this.githubContinueLoading = false; }
  async disconnectGit() { await this.authenticate('disconnect'); }
  afterUnload() { this.closed = true; clearTimeout(this.authTimer); this.clearGithubWatch(); this.gitToken.value = ''; }
  closeModal() { this.afterUnload(); assistOS.UI.closeModal(this.element, null); }
}
