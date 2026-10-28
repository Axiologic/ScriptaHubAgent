import { newSubmissionId, validateDocuments } from './submission-policy.js';
import { dashboardText } from './dashboard-copy.js';
const root = new URL('../', import.meta.url);
const t = (key, values) => dashboardText(document.documentElement.lang, key, values);
const content = document.querySelector('#dashboard-content');
const message = document.querySelector('#dashboard-message');
const dialog = document.querySelector('#edit-dialog');
const form = document.querySelector('#edit-form');
let data, view = 'books', editing, mutation = false;
const states = { open: 'Awaiting review', accepted: 'Accepted', rejected: 'Rejected', queued: 'Queued', cancelled: 'Cancelled', running: 'Running', stop_requested: 'Stop requested', completed: 'Completed', failed: 'Failed' };
const activities = {
  'access.granted': ['Access granted', 'Collaborator access was granted to this book workspace. Collaborators can view the workspace and propose changes.'],
  'access.removed': ['Access removed', 'Collaborator access to this book workspace was removed.'],
  'change.proposed': ['Change proposed', 'A change was submitted for the book owner to review. No processing task is created until the owner approves it.'],
  'change.accepted': ['Change accepted', 'A change was accepted into the book revision history. Processing is tracked separately in Tasks.'],
  'change.rejected': ['Change rejected', 'The book owner rejected a proposed change. It does not create a processing task.'],
  'task.queued': ['Task queued', 'A processing task was created for an accepted change. Queued does not mean it has started running.'],
  'task.cancelled': ['Task cancelled', 'The queued processing task was cancelled. The accepted change remains in the book history.'],
};
function element(tag, text, className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
}
function button(text, action) {
  const node = element('button', t(text), 'button button-no-icon'); node.type = 'button'; node.addEventListener('click', action); return node;
}
function detail(label) { const node = element('details'); node.append(element('summary', t(label))); return node; }
function date(value) { return new Date(value).toLocaleString(document.documentElement.lang); }
async function api(endpoint = '', body) {
  const response = await fetch(new URL(`api/dashboard${endpoint}`, root), { credentials: 'same-origin', cache: 'no-store',
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  if (response.status === 401) throw Error(t('Your session expired. Sign in again to continue.'));
  const result = await response.json(); if (!response.ok) throw Error(t(result.error || 'Request failed')); return result;
}
async function load() { data = await api(); render(); }
async function refresh() {
  const control = document.querySelector('#refresh'); control.disabled = true;
  content.setAttribute('aria-busy', 'true');
  try { await load(); message.textContent = ''; } catch (error) { message.dataset.state = 'error'; message.textContent = error.message; }
  finally { control.disabled = false; content.setAttribute('aria-busy', 'false'); }
}
async function mutate(endpoint, body) {
  if (mutation) return; mutation = true;
  content.querySelectorAll('button').forEach(node => { node.disabled = true; });
  try { await api(endpoint, body); await load(); message.dataset.state = 'success'; message.textContent = t('Saved.'); }
  catch (error) { message.dataset.state = 'error'; message.textContent = error.message; }
  finally { mutation = false; content.querySelectorAll('button').forEach(node => { node.disabled = false; }); }
}
function card(title, state, subtitle) {
  const node = element('article', undefined, 'dashboard-card');
  const header = element('div', undefined, 'dashboard-card-header');
  const copy = element('div', undefined, 'dashboard-card-copy');
  copy.append(element('h2', title));
  if (subtitle) copy.append(element('p', subtitle, 'dashboard-meta'));
  header.append(copy);
  if (state) header.append(element('span', t(state), 'dashboard-state'));
  node.append(header); return node;
}
function edit(book) {
  editing = book; form.reset(); delete form.dataset.submissionId;
  document.querySelector('#edit-title').textContent = t(book.owner === data.user.id ? 'Submit a change' : 'Propose a change');
  form.querySelector('[type=submit]').textContent = t(book.owner === data.user.id ? 'Submit change' : 'Submit proposal');
  document.querySelector('#edit-context').textContent = t(book.owner === data.user.id
    ? '{title} · Your change will be queued for processing.'
    : '{title} · The owner must approve your proposal before a task is created.', { title: book.title });
  document.querySelector('#edit-message').textContent = ''; dialog.showModal();
}
function bookCard(book) {
  const owner = book.owner === data.user.id;
  const node = card(book.title, null, t('Accepted revision {revision} · {origin}', { revision: book.revision, origin: t(book.origin === 'catalogue' ? 'Imported book' : 'Created book') }));
  const ownership = element('span', undefined, 'dashboard-ownership');
  ownership.title = t(owner ? 'Your book' : 'Shared with you');
  ownership.setAttribute('role', 'img');
  ownership.setAttribute('aria-label', ownership.title);
  const shape = owner
    ? '<path d="M14 3H5a2 2 0 0 0-2 2v14a2 2 0 0 1 2-2h7M3 19a2 2 0 0 0 2 2h6M7 3v7l2-1 2 1V3"/><circle cx="18" cy="13" r="2.5"/><path d="M13 22v-1a5 5 0 0 1 10 0v1"/>'
    : '<path d="M18 11V3H5a2 2 0 0 0-2 2v16a2 2 0 0 1 2-2h10M3 21a2 2 0 0 0 2 2h10M7 3v8l3-2 3 2V3"/><path d="m23 7 5-5a3 3 0 0 1 4 4l-6 6a2 2 0 0 1-3-3l5-5"/><circle cx="22" cy="17" r="2.5"/><circle cx="29" cy="17" r="2.5"/><path d="M17 26v-1a5 5 0 0 1 10 0v1m2-5a5 5 0 0 1 5 4v1"/>';
  ownership.classList.toggle('is-shared', !owner);
  ownership.innerHTML = `<svg viewBox="${owner ? '0 0 26 26' : '0 0 36 28'}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${shape}</svg>`;
  node.querySelector('.dashboard-meta').prepend(ownership);
  const actions = element('div', undefined, 'dashboard-actions');
  actions.append(button(owner ? 'Submit a change' : 'Propose a change', () => edit(book)));
  node.querySelector('.dashboard-card-header').append(actions);
  if (owner) {
    const access = detail('Collaborators');
    access.append(element('p', t('Collaborators can see the workspace and propose changes. Only you approve changes and manage access.'), 'dashboard-meta'));
    for (const person of data.collaborators.filter(item => item.book_id === book.id)) {
      const row = element('div', undefined, 'dashboard-collaborator');
      row.append(element('span', person.name || person.email));
      row.append(button('Remove access', () => {
        if (confirm(t('Remove access for {name}?', { name: person.name || person.email }))) void mutate('/access', { bookId: book.id, email: person.email, remove: true });
      })); access.append(row);
    }
    const invite = element('form'), label = element('label', t('Account email')), input = element('input');
    input.type = 'email'; input.required = true; input.maxLength = 320; label.append(input);
    const add = element('button', t('Add collaborator'), 'button button-no-icon'); add.type = 'submit'; invite.append(label, add);
    invite.addEventListener('submit', event => { event.preventDefault(); void mutate('/access', { bookId: book.id, email: input.value }); });
    access.append(invite, element('p', t('The account must have signed in to ScriptaHub at least once.'), 'dashboard-meta')); node.append(access);
  }
  return node;
}
function changeCard(change) {
  const node = card(change.title || t('Library feedback'), states[change.state], t('{author} · {date} · Based on revision {revision}', { author: change.author_name || t('Account unavailable'), date: date(change.created_at), revision: change.base_revision }));
  const information = detail('View proposed changes and documents');
  for (const [name, value] of Object.entries(change.payload.metadata.values)) {
    const fields = { instructions: 'Instructions', prompt: 'Instructions', titles: 'Title', title: 'Title', target: 'Target language', format: 'Format', note: 'Notes', request: 'Request', expectations: 'Expectations' };
    information.append(element('h3', t(fields[name] || name)), element('p', value));
  }
  change.payload.files.forEach((file, index) => {
    const link = element('a', file.originalName); link.href = new URL(`api/dashboard/files/${change.id}/${index}`, root);
    const row = element('p'); row.append(link); information.append(row);
  });
  node.append(information);
  if (change.decision_note) node.append(element('p', change.decision_note));
  if (change.state === 'open' && change.owner === data.user.id && change.author !== data.user.id) {
    const actions = element('div', undefined, 'dashboard-actions');
    actions.append(button('Approve and queue task', () => {
      if (confirm(t('Approve this proposal and create its processing task?'))) void mutate('/review', { changeId: change.id, decision: 'accept' });
    }), button('Reject', () => {
      const note = prompt(t('Reason for rejection (optional)'));
      if (note !== null) void mutate('/review', { changeId: change.id, decision: 'reject', note });
    })); node.append(actions);
  }
  return node;
}
function taskCard(task) {
  const kinds = { 'book-proposal': 'Book proposal', manuscript: 'Manuscript', edit: 'Edit', fork: 'Derived book', animation: 'Animation', translation: 'Translation', 'librarian-feedback': 'Library feedback' };
  const node = card(task.title, states[task.state], `${t(kinds[task.kind] || task.kind)} · ${date(task.created_at)}`);
  if (task.state === 'queued') node.append(element('p', t('Waiting for a scheduled or manual processing run.'), 'dashboard-meta'));
  if (task.error) node.append(element('p', task.error));
  if (task.result) node.append(element('p', task.result));
  if (task.state === 'queued' && task.owner === data.user.id) node.append(button('Cancel task', () => {
    if (confirm(t('Cancel this queued task? The accepted change remains in history.'))) void mutate('/cancel', { taskId: task.id });
  }));
  if (task.state === 'running' && task.owner === data.user.id) node.append(button('Stop task', () => {
    if (confirm(t('Request stopping this task? Work already published cannot be undone.'))) void mutate('/cancel', { taskId: task.id });
  }));
  return node;
}
function historyCard(event) {
  const title = data.books.find(book => book.id === event.book_id)?.title || t('Book');
  const [label, explanation] = activities[event.action] || ['Activity recorded', 'An activity was recorded for this book workspace.'];
  const actor = event.actor_name || t(event.actor?.startsWith('agent:') ? 'Processing service' : 'Account unavailable');
  const node = card(title, label, `${date(event.created_at)} · ${actor}`);
  const heading = node.querySelector('h2');
  heading.classList.add('dashboard-activity-title');
  const info = element('button', undefined, 'site-icon-button dashboard-activity-info');
  info.type = 'button';
  info.setAttribute('aria-label', t('Activity details for {title}', { title }));
  info.setAttribute('popovertarget', `activity-${event.id}`);
  info.style.setProperty('anchor-name', `--activity-${event.id}`);
  info.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/></svg>';
  const details = element('div', undefined, 'dashboard-activity-details');
  details.id = `activity-${event.id}`;
  details.setAttribute('popover', 'auto');
  details.style.setProperty('position-anchor', `--activity-${event.id}`);
  info.setAttribute('aria-describedby', details.id);
  details.append(element('p', t(explanation)));
  if (event.action.startsWith('access.')) details.append(element('p', event.subject_name
    ? t('Account: {name}', { name: event.subject_name })
    : t('The recipient was not recorded for this earlier event.'), 'dashboard-meta'));
  heading.append(info); node.append(details);
  return node;
}
function render() {
  localize();
  content.replaceChildren();
  const collections = { books: data.books, changes: data.changes, tasks: data.tasks, history: data.events };
  const builders = { books: bookCard, changes: changeCard, tasks: taskCard, history: historyCard };
  if (!collections[view].length) content.append(element('div', t({ books: 'No books yet. Create a book to get started.', changes: 'No change requests.', tasks: 'No tasks.', history: 'No activity yet.' }[view]), 'dashboard-empty'));
  for (const item of collections[view]) content.append(builders[view](item));
}
const tabs = [...document.querySelectorAll('[data-view]')];
function selectView(node) {
  view = node.dataset.view;
  tabs.forEach(tab => { tab.setAttribute('aria-selected', String(tab === node)); tab.tabIndex = tab === node ? 0 : -1; });
  content.setAttribute('aria-labelledby', node.id); if (data) render();
}
tabs.forEach((node, index) => {
  node.addEventListener('click', () => selectView(node));
  node.addEventListener('keydown', event => {
    let target;
    if (event.key === 'ArrowRight') target = tabs[(index + 1) % tabs.length];
    if (event.key === 'ArrowLeft') target = tabs[(index + tabs.length - 1) % tabs.length];
    if (event.key === 'Home') target = tabs[0];
    if (event.key === 'End') target = tabs[tabs.length - 1];
    if (target) { event.preventDefault(); selectView(target); target.focus(); }
  });
});
document.querySelector('#refresh').addEventListener('click', refresh);
document.querySelector('[data-close]').addEventListener('click', () => dialog.close());
form.addEventListener('submit', async event => {
  event.preventDefault(); const submit = form.querySelector('[type=submit]'); submit.disabled = true;
  const status = document.querySelector('#edit-message');
  try {
    validateDocuments([...form.elements.documents.files]);
    form.dataset.submissionId ||= newSubmissionId();
    const values = new FormData(form), body = new FormData();
    body.set('metadata', JSON.stringify({ submissionId: form.dataset.submissionId, kind: 'edit', targetBookId: editing.id,
      agreementVersion: '2026-09-10', agreementAccepted: values.get('agreement') === 'on', values: { instructions: values.get('instructions') } }));
    for (const file of values.getAll('documents')) if (file.size) body.append('documents', file);
    const response = await fetch(new URL('api/submissions', root), { method: 'POST', credentials: 'same-origin', body });
    const result = await response.json(); if (!response.ok) throw Error(result.error || 'Request failed');
    dialog.close(); await load(); message.dataset.state = 'success'; message.textContent = t(result.task ? 'Change accepted; task queued.' : 'Proposal sent to the book owner.');
  } catch (error) { status.textContent = t(error.message); }
  finally { submit.disabled = false; }
});
function localize() {
  document.title = `${t('Dashboard')} · ScriptaHub`;
  for (const node of document.querySelectorAll('[data-dashboard-text]')) node.textContent = t(node.dataset.dashboardText);
  for (const node of document.querySelectorAll('[data-dashboard-label]')) node.setAttribute('aria-label', t(node.dataset.dashboardLabel));
  document.querySelector('#refresh').title = t('Refresh dashboard');
  const agreement = new URL('agreement/index.html', root);
  agreement.searchParams.set('lang', document.documentElement.lang);
  form.querySelector('.dashboard-agreement a').href = agreement.href;
  const submit = form.querySelector('[type=submit]');
  submit.textContent = t(editing?.owner === data?.user.id && editing ? 'Submit change' : 'Submit proposal');
}
document.addEventListener('scriptahub:language', () => {
  localize();
  if (data) render();
  if (editing && dialog.open) {
    document.querySelector('#edit-title').textContent = t(editing.owner === data.user.id ? 'Submit a change' : 'Propose a change');
    document.querySelector('#edit-context').textContent = t(editing.owner === data.user.id
      ? '{title} · Your change will be queued for processing.'
      : '{title} · The owner must approve your proposal before a task is created.', { title: editing.title });
  }
});
localize();
void refresh();
