import { showToast } from './notifications.js';
import './reading.js';
import { newSubmissionId } from './submission-policy.js';
import { dashboardText } from './dashboard-copy.js';
import { currentChangeStatus } from './change-status.js';
const root = new URL('../', import.meta.url);
const t = (key, values) => dashboardText(document.documentElement.lang, key, values);
const content = document.querySelector('#dashboard-content');
let data, view = 'books', mutation = false;
const expandedChangeBooks = new Set();
const editionSubmissionIds = new Map();
const states = { open: 'Awaiting review', accepted: 'Accepted', rejected: 'Rejected', queued: 'Queued', cancelled: 'Cancelled', running: 'Running', stop_requested: 'Stop requested', completed: 'Completed', failed: 'Failed' };

function element(tag, text, className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = text;
  if (className) node.className = className; return node;
}
function button(text, action) {
  const node = element('button', t(text), 'button button-no-icon'); node.type = 'button'; node.addEventListener('click', action); return node;
}
function reviewButton(decision, action) {
  const label = t(decision === 'accept' ? 'Approve' : 'Reject');
  const node = element('button', undefined, 'site-icon-button dashboard-review-action');
  node.type = 'button';node.dataset.decision = decision;node.title = label;node.setAttribute('aria-label',label);
  const icon = document.createElementNS('http://www.w3.org/2000/svg','svg');
  for (const [name,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.8','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) icon.setAttribute(name,value);
  const path = document.createElementNS(icon.namespaceURI,'path');
  path.setAttribute('d',decision === 'accept' ? 'M7 10H3v11h4zM7 10l5-7a2 2 0 0 1 2 2v4h5a2 2 0 0 1 2 2l-1 8a2 2 0 0 1-2 2H7z' : 'M7 14H3V3h4zM7 14l5 7a2 2 0 0 0 2-2v-4h5a2 2 0 0 0 2-2l-1-8a2 2 0 0 0-2-2H7z');icon.append(path);node.append(icon);
  node.addEventListener('click',action);return node;
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
  try { await load(); } catch (error) { showToast(error.message, 'error'); }
  finally { control.disabled = false; content.setAttribute('aria-busy', 'false'); }
}
async function mutate(endpoint, body) {
  if (mutation) return false; mutation = true;
  const controls = new Map([...content.querySelectorAll('button')].map(node=>[node,node.disabled]));
  for (const node of controls.keys()) node.disabled = true;
  try {
    const result = await api(endpoint, body);await load();
    const notification = endpoint === '/editions' ? 'New edition submitted for processing.'
      : endpoint === '/review' ? result.state === 'accepted' ? 'Proposal approved. Submit a new edition when ready.' : 'Proposal rejected.' : 'Saved.';
    showToast(t(notification), 'success');return true;
  } catch (error) { showToast(error.message, 'error');return false; }
  finally { mutation = false;for (const [node,disabled] of controls) if(node.isConnected) node.disabled = disabled; }
}

function card(title, state, subtitle, heading = 'h2') {
  const node = element('article', undefined, 'dashboard-card');
  const header = element('div', undefined, 'dashboard-card-header');
  const copy = element('div', undefined, 'dashboard-card-copy');
  copy.append(element(heading, title));
  if (subtitle) copy.append(element('p', subtitle, 'dashboard-meta'));
  header.append(copy);
  if (state) header.append(element('span', t(state), 'dashboard-state'));
  node.append(header); return node;
}
async function suggest(book) {
  try {
    const response = await fetch(new URL('collection.json', root), { cache: 'no-store' });
    if (!response.ok) throw Error(t('Could not load the book for editing.'));
    const catalogue = await response.json();
    const published = catalogue.books.find(item => item.id === book.id);
    if (!published) {
      showToast(t('Suggestions are available once the book has a published edition.'), 'info');
      return;
    }
    const url = new URL('feedback/index.html', root);
    url.search = new URLSearchParams({ book: published.directory, lang: document.documentElement.lang });
    location.assign(url.href);
  } catch (error) { showToast(error.message, 'error'); }
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
  actions.append(button('Suggest a change', () => suggest(book)));
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
  const node = card(change.author_name || t('Account unavailable'), null, t('{date} · Based on revision {revision}', { date: date(change.created_at), revision: change.base_revision }), 'h3');
  const statuses = element('div', undefined, 'dashboard-change-statuses');
  const current=currentChangeStatus(change);
  node.classList.add('dashboard-change-card');node.dataset.state=current.state;
  const badge=element('span',undefined,'dashboard-state');badge.dataset.state=current.state;
  badge.append(element('strong',t(current.label)));
  if(current.updatedAt) badge.title=t('Updated: {date}',{date:date(current.updatedAt)});
  if(change.state==='accepted' && current.state!=='accepted') badge.title += ` · ${t('Decision')}: ${t('Approved')}`;
  badge.setAttribute('aria-label',[t(current.label),badge.title].filter(Boolean).join(' · '));
  statuses.append(badge);
  node.querySelector('.dashboard-card-header').append(statuses);
  const information = detail('View proposed changes and documents');
  let annotations=[];
  try { annotations=JSON.parse(change.payload.metadata.values.annotations || '[]'); } catch { /* Older text contributions have no annotations. */ }
  const canReview=change.state==='open' && change.owner===data.user.id && change.author!==data.user.id;
  const decisions={...(change.payload.annotationDecisions || {})}, selected=new Set();
  if (annotations.length) {
    const controls=element('div',undefined,'dashboard-actions');
    const all=element('input');all.type='checkbox';all.setAttribute('aria-label','Select or deselect all annotations');
    const label=element('label','Select all');label.prepend(all);controls.append(label);
    const checks=[];
    const bulk=decision=>{for(const [id,select] of checks)if(selected.has(id)){decisions[id]=decision;select.value=decision;}};
    if(canReview){controls.append(button('Approve selected',()=>bulk('accept')),button('Reject selected',()=>bulk('reject')));information.append(controls);}
    all.onchange=()=>{for(const [id,,check] of checks){check.checked=all.checked;if(all.checked)selected.add(id);else selected.delete(id);}};
    for(const item of annotations){
      const row=element('article',undefined,'dashboard-card');
      row.append(element('p',`${item.section || item.edition} · ${item.kind}`,'dashboard-meta'),element('blockquote',item.quote),element('p',item.feedback));
      if(item.sources)row.append(element('p',item.sources,'dashboard-meta'));
      row.append(button('View passage',async()=>{
        try {
          const response=await fetch(new URL('collection.json',root),{cache:'no-store'});
          if(!response.ok)throw Error('Could not open the book context.');
          const catalogue=await response.json(), book=catalogue.books.find(book=>book.id===change.book_id);
          if(!book)throw Error('This book is not available in the catalogue.');
          const url=globalThis.ScriptaReading.readingUrl(book,item.language,'read',document.documentElement.lang,root);
          if(!url||url.searchParams.get('id')!==item.edition)throw Error('The annotated edition has changed. Review the original quotation shown here.');
          url.hash=new URLSearchParams({quote:item.quote,prefix:item.prefix||'',suffix:item.suffix||'',start:String(item.start)}).toString();
          window.open(url.href,'_blank','noopener');
        }catch(error){showToast(error.message, 'error');}
      }));
      if(canReview){
        const check=element('input');check.type='checkbox';check.setAttribute('aria-label','Select annotation');check.onchange=()=>{if(check.checked)selected.add(item.id);else selected.delete(item.id);all.checked=selected.size===annotations.length;all.indeterminate=selected.size>0&&selected.size<annotations.length;};
        const select=element('select');select.setAttribute('aria-label','Annotation decision');
        for(const [value,text]of [['','Awaiting decision'],['accept','Approve'],['reject','Reject']]){const option=element('option',text);option.value=value;select.append(option);}
        select.value=decisions[item.id]||'';select.onchange=()=>{decisions[item.id]=select.value;};checks.push([item.id,select,check]);row.prepend(check);row.append(select);
      }else row.append(element('p',decisions[item.id]==='accept'?'Approved':decisions[item.id]==='reject'?'Rejected':'Awaiting review','dashboard-meta'));
      information.append(row);
    }
  }
  for (const [name, value] of Object.entries(change.payload.metadata.values)) {
    if (['annotations','baseRevision','annotationDraftKey'].includes(name)) continue;
    const fields = { instructions: 'Instructions', prompt: 'Instructions', titles: 'Title', title: 'Title', target: 'Target language', format: 'Format', note: 'Notes', request: 'Request', expectations: 'Expectations' };
    information.append(element('h3', t(fields[name] || name)), element('p', value));
  }
  change.payload.files.forEach((file, index) => {
    const link = element('a', file.originalName); link.href = new URL(`api/dashboard/files/${change.id}/${index}`, root);
    const row = element('p'); row.append(link); information.append(row);
  });
  node.append(information);
  if (change.decision_note) node.append(element('p', change.decision_note));
  if (canReview && annotations.length) {
    const actions=element('div',undefined,'dashboard-actions');
    actions.append(button('Finish review',()=>{
      if(annotations.some(item=>!['accept','reject'].includes(decisions[item.id]))){showToast(t('Approve or reject every annotation before finishing.'), 'error');return;}
      if(confirm(t('Finish this review? Approved changes will wait for a new edition.'))) void mutate('/review',{changeId:change.id,decision:'accept',annotationDecisions:decisions});
    }));node.append(actions);
  } else if (canReview) {
    const actions = element('div', undefined, 'dashboard-actions dashboard-review-actions');
    actions.append(reviewButton('accept', () => {
      if (confirm(t('Approve this proposal?'))) void mutate('/review', { changeId: change.id, decision: 'accept' });
    }), reviewButton('reject', () => {
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

function renderChangeGroups(changes) {
  const groups = new Map();
  for (const change of changes) {
    const key = change.book_id || null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(change);
  }
  // The server returns newest first: preserve that order within and between books.
  let index = 0;
  for (const [bookId, requests] of groups) {
    const section = element('details', undefined, 'dashboard-change-group');
    section.open = expandedChangeBooks.has(bookId);
    section.addEventListener('toggle', () => {
      if (!section.isConnected) return;
      if (section.open) expandedChangeBooks.add(bookId);
      else expandedChangeBooks.delete(bookId);
    });
    const header = element('summary', undefined, 'dashboard-change-group-heading');
    const title = element('h2');
    const titleText = element('span', bookId ? requests[0].title : t('Library feedback'), 'dashboard-change-group-title');
    const stateCounts = new Map();
    for (const request of requests) {
      const status = currentChangeStatus(request);
      const summary = stateCounts.get(status.state) || {label:status.label,count:0};
      summary.count++;stateCounts.set(status.state,summary);
    }
    const stateSummary = element('span', undefined, 'dashboard-change-group-states');
    for (const state of ['running','stop_requested','failed','open','queued','accepted','completed','rejected','cancelled']) {
      const summary = stateCounts.get(state);if (!summary) continue;
      const indicator = element('span', undefined, 'dashboard-change-group-state');
      indicator.append(element('span',t(summary.label)),element('strong',String(summary.count)));
      indicator.dataset.state = state;indicator.title = `${t(summary.label)}: ${summary.count}`;
      indicator.setAttribute('role','img');indicator.setAttribute('aria-label',indicator.title);
      stateSummary.append(indicator);
    }
    titleText.append(stateSummary);
    title.id = `change-group-${index++}`;section.setAttribute('aria-labelledby', title.id);
    const count = element('span', String(requests.length), 'dashboard-change-group-count');
    count.setAttribute('aria-label', `${t('Change requests')}: ${requests.length}`);
    count.title = count.getAttribute('aria-label');
    title.append(titleText, count);header.append(title);section.append(header);
    const list = element('div', undefined, 'dashboard-change-group-list');
    const edition = data.editions.find(item=>item.bookId === bookId);
    if (edition && requests[0].owner === data.user.id) {
      const toolbar = element('div', undefined, 'dashboard-edition-toolbar');
      const note = element('p', edition.activeTask ? t('An edition is already pending or running.')
        : t('{count} approved changes waiting for a new edition.', {count:edition.pendingCount}), 'dashboard-meta');
      const submit = button('Submit new edition', async () => {
        if (mutation) return;
        if (!editionSubmissionIds.has(bookId)) editionSubmissionIds.set(bookId,newSubmissionId());
        if (await mutate('/editions',{bookId,submissionId:editionSubmissionIds.get(bookId)})) editionSubmissionIds.delete(bookId);
      });
      submit.disabled = Boolean(edition.activeTask) || !edition.pendingCount;
      if (submit.disabled) submit.title = note.textContent;
      toolbar.append(note,submit);list.append(toolbar);
    }
    for (const change of requests) list.append(changeCard(change));
    section.append(list);
    content.append(section);
  }
}

function render() {
  localize();
  document.querySelector('#dashboard-tasks-tab').hidden = data.canManageTasks !== true;
  if(view==='tasks' && !data.canManageTasks) { selectView(tabs.find(tab=>tab.dataset.view==='changes')); return; }
  content.replaceChildren();
  const collections = { books: data.books, changes: data.changes, tasks: data.tasks };
  const builders = { books: bookCard, changes: changeCard, tasks: taskCard };
  if (!collections[view].length) content.append(element('div', t({ books: 'No books yet. Create a book to get started.', changes: 'No change requests.', tasks: 'No tasks.' }[view]), 'dashboard-empty'));
  if (view === 'changes') renderChangeGroups(data.changes);
  else for (const item of collections[view]) content.append(builders[view](item));
}
const tabs = [...document.querySelectorAll('[data-view]')];
function selectView(node) {
  if(node.hidden || (node.dataset.view==='tasks' && !data?.canManageTasks)) return;
  view = node.dataset.view;
  tabs.forEach(tab => { tab.setAttribute('aria-selected', String(tab === node)); tab.tabIndex = tab === node ? 0 : -1; });
  content.setAttribute('aria-labelledby', node.id); if (data) render();
}
tabs.forEach((node, index) => {
  node.addEventListener('click', () => selectView(node));
  node.addEventListener('keydown', event => {
    const visibleTabs=tabs.filter(tab=>!tab.hidden), index=visibleTabs.indexOf(node);
    let target;
    if (event.key === 'ArrowRight') target = visibleTabs[(index + 1) % visibleTabs.length];
    if (event.key === 'ArrowLeft') target = visibleTabs[(index + visibleTabs.length - 1) % visibleTabs.length];
    if (event.key === 'Home') target = visibleTabs[0];
    if (event.key === 'End') target = visibleTabs[visibleTabs.length - 1];
    if (target) { event.preventDefault(); selectView(target); target.focus(); }
  });
});
document.querySelector('#refresh').addEventListener('click', refresh);
function localize() {
  document.title = `${t('Dashboard')} · ScriptaHub`;
  for (const node of document.querySelectorAll('[data-dashboard-text]')) node.textContent = t(node.dataset.dashboardText);
  for (const node of document.querySelectorAll('[data-dashboard-label]')) node.setAttribute('aria-label', t(node.dataset.dashboardLabel));
  document.querySelector('#refresh').title = t('Refresh dashboard');
}
document.addEventListener('scriptahub:language', () => {
  localize();
  if (data) render();
});
localize();
void refresh();
