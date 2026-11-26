import { showToast } from './notifications.js';
import './reading.js';
import { newSubmissionId } from './submission-policy.js';
import { dashboardText } from './dashboard-copy.js?v=admin-tabs-1';
import { currentChangeStatus } from './change-status.js';
const root = new URL('../', import.meta.url);
const t = (key, values) => dashboardText(document.documentElement.lang, key, values);
const content = document.querySelector('#dashboard-content');
const adminPanel = document.querySelector('#dashboard-admin-panel');
const adminContent = document.querySelector('#dashboard-admin-content');
const tabs = [...document.querySelectorAll('[data-view]')];
const adminTabs = [...adminPanel.querySelectorAll('[data-admin-view]')];
const administrationTab = document.querySelector('#dashboard-admin-tab');
let data, view = 'books', adminView = 'settings', mutation = false, initialViewApplied = false;
let publishedBooks = globalThis.SCRIPTA_COLLECTION?.books || [];
const disclosureStates = new Map();
let refreshing = false;
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
function disclosure(key, className) {
  const node = element('details', undefined, className);
  node.dataset.disclosureKey = key;
  node.open = disclosureStates.get(key) === true;
  node.addEventListener('toggle', () => {
    if (node.isConnected) disclosureStates.set(key, node.open);
  });
  return node;
}
function detail(label, key) { const node = disclosure(key); node.append(element('summary', t(label))); return node; }
function date(value) { return new Date(value).toLocaleString(document.documentElement.lang); }
async function api(endpoint = '', body) {
  const response = await fetch(new URL(`api/dashboard${endpoint}`, root), { credentials: 'same-origin', cache: 'no-store',
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  if (response.status === 401) throw Error(t('Your session expired. Sign in again to continue.'));
  const result = await response.json(); if (!response.ok) throw Error(t(result.error || 'Request failed')); return result;
}
async function load({ background = false } = {}) {
  const overview = await api();
  const changed = JSON.stringify(overview) !== JSON.stringify(data);
  // Stable polling responses must not replace disclosures or in-progress review controls.
  if (background && !changed) return;
  const catalogue = await fetch(new URL('collection.json', root), {cache:'no-store'})
    .then(response => response.ok ? response.json() : null).catch(() => null);
  data = overview;
  if (Array.isArray(catalogue?.books)) publishedBooks = catalogue.books;
  render();
  if (!initialViewApplied) {
    initialViewApplied = true;
    const query = new URL(location.href).searchParams;
    const requested = query.get('tab');
    const nestedTab = adminTabs.find(tab => tab.dataset.adminView === requested);
    const tab = nestedTab ? administrationTab : tabs.find(tab => tab.dataset.view === requested);
    if (requested) selectView(tab && !tab.hidden ? tab : tabs[0], nestedTab ? requested : query.get('section') || 'settings');
  }
}
async function refresh({ background = false } = {}) {
  if (refreshing || mutation) return;
  refreshing = true;
  const control = document.querySelector('#refresh'); control.disabled = true;
  const panel = view === 'admin' ? adminContent : content;
  if (!background) panel.setAttribute('aria-busy', 'true');
  try { await load({background});if(!background && view==='points')await dashboardSections.get('points')?.controller?.refresh(); } catch (error) { if (!background) showToast(error.message, 'error'); }
  finally { refreshing = false; control.disabled = false; if (!background) panel.setAttribute('aria-busy', 'false'); }
}
async function mutate(endpoint, body) {
  if (mutation) return false; mutation = true;
  const panel = view === 'admin' ? adminContent : content;
  const controls = new Map([...panel.querySelectorAll('button')].map(node=>[node,node.disabled]));
  for (const node of controls.keys()) node.disabled = true;
  try {
    const result = await api(endpoint, body);await load();
    const notification = endpoint === '/editions' ? 'New edition requested.'
      : endpoint === '/review' ? result.state === 'accepted'
        ? result.task ? 'Proposal approved and queued.' : 'Proposal approved. Submit a new edition when ready.'
        : 'Proposal rejected.' : 'Saved.';
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
  const title = catalogueTitle(book.id, book.title);
  const creation = book.creation, cycle = creation?.cycle;
  const publishedBook = Boolean(book.revision || book.origin === 'catalogue');
  const status = publishedBook ? (creation ? states.completed : null) : cycle?.phase === 'funding' ? cycleCopy.funding : states[creation?.state];
  const origin = t(book.origin === 'catalogue' ? 'Imported book' : 'Created book');
  const node = card(title,status,publishedBook ? t('Accepted revision {revision} · {origin}', {revision:book.revision,origin}) : origin);
  if (new URL(location.href).searchParams.get('book') === book.id) node.classList.add('dashboard-book-new');
  if (!publishedBook && cycle?.phase === 'retryable') addCycleState(node,cycle,owner);
  if (!publishedBook && creation?.error && creation.error !== cycle?.issue) node.append(element('p',creation.error,'dashboard-meta'));
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
  if (publishedBook) actions.append(button('Suggest a change', () => suggest(book)));
  node.querySelector('.dashboard-card-header').append(actions);
  if (owner) {
    const access = detail('Collaborators', `book:${book.id}:collaborators`);
    access.append(element('p', t('Collaborators can see the workspace and propose changes. You and workspace administrators can review changes. You manage collaborators.'), 'dashboard-meta'));
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
const cycleCopy = {
  funding: 'Confirming credits',
  active: 'Processing',
  rewarding: 'Applying reward',
  awaiting_publication: 'Approved, awaiting edition publication',
  published: 'Edition published, applying reward',
  restoring: 'Restoring request and credits',
  retryable: 'Ready to try again',
};
function addCycleState(node, cycle, owner) {
  if (!cycle || !cycleCopy[cycle.phase]) return;
  node.append(element('p', t(cycleCopy[cycle.phase]), 'dashboard-meta'));
  if (cycle.issue) node.append(element('p', cycle.missing ? t('You need {count} more credits.', {count:cycle.missing}) : t(cycle.issue), 'dashboard-meta'));
  if (owner && cycle.missing && data.isBetaVersion !== false) node.append(element('p', t('ScriptaHub is in beta. Contact a platform administrator for additional credits.'), 'dashboard-meta'));
  if (owner && cycle.phase === 'retryable') node.append(button('Try again', () => void mutate('/retry',{cycleId:cycle.id,attempt:cycle.attempt})));
}
function changeCard(change) {
  const node = card(change.author_name || t('Account unavailable'), null, t('{date} · Based on revision {revision}', { date: date(change.created_at), revision: change.base_revision }), 'h3');
  const statuses = element('div', undefined, 'dashboard-change-statuses');
  const current=currentChangeStatus(change);
  node.classList.remove('dashboard-card');
  node.classList.add('dashboard-change-card');node.dataset.state=current.state;
  const published = publishedBooks.find(book => book.id === change.book_id);
  if (published) {
    const language = document.documentElement.lang;
    const edition = published.editions?.[language] || published.editions?.en
      || Object.values(published.editions || {}).find(edition => edition.book);
    if (edition?.book) {
      const link = element('a', t('View book'), 'dashboard-view-book');
      const url = new URL(edition.book, root);
      url.searchParams.set('lang', language);
      link.href = url.href;
      statuses.append(link);
    }
  }
  if (statuses.childElementCount) node.querySelector('.dashboard-card-header').append(statuses);
  const information = detail('View proposed changes and documents', `change:${change.id}:information`);
  let annotations=[];
  try { annotations=JSON.parse(change.payload.metadata.values.annotations || '[]'); } catch { /* Older text contributions have no annotations. */ }
  const editorial = ['manuscript','book-proposal'].includes(change.kind) && change.cycle;
  const canReview = change.state === 'open'
    && (data.canManageTasks || change.owner === data.user.id)
    && (change.kind !== 'animation' || !change.cycle || change.cycle.phase === 'review')
    && (!editorial || (data.canManageTasks && change.cycle.phase === 'review'));
  addCycleState(node,change.cycle,change.author === data.user.id);
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
  const values = change.payload.metadata.values;
  const facts = element('dl',undefined,'dashboard-contribution-facts');
  const narrative = element('div',undefined,'dashboard-contribution-story');
  const instructionNames = new Set(['audience','purpose','scope','structure','viewpoints','qualityCriteria']);
  const fields = {
    instructions:'Instructions', prompt:'Instructions', description:'Description',
    titles:'Title', title:'Title', target:'Target language', format:'Format', note:'Notes',
    request:'Request', expectations:'Expectations', audience:'Audience', purpose:'Purpose',
    scope:'Scope', structure:'Structure', viewpoints:'Viewpoints to include', qualityCriteria:'Quality criteria',
    sourceEdition:'Source edition', coverStyle:'Cover style', coverPalette:'Cover colors', coverComposition:'Cover composition', coverDescription:'Cover description',
  };
  for (const [name,value] of Object.entries(values)) {
    if (!value || ['annotations','baseRevision','annotationDraftKey','coverMode'].includes(name)) continue;
    if (name === 'prompt' && values.description && ['book-proposal','manuscript'].includes(change.kind)) continue;
    const label = t(fields[name] || name);
    if (['description','prompt','instructions','feedback','sources','note','request','expectations','coverDescription'].includes(name)) {
      const section = element('section');
      section.append(element('h3',label),element('p',value));
      narrative.append(section);
    } else {
      const row = element('div');
      const content = instructionNames.has(name) ? value.split('; ').join(' · ') : value;
      row.append(element('dt',label),element('dd',content));
      facts.append(row);
    }
  }
  if (facts.childElementCount) information.append(facts);
  if (narrative.childElementCount) information.append(narrative);
  change.payload.files.forEach((file, index) => {
    const link = element('a', file.originalName); link.href = new URL(`api/dashboard/files/${change.id}/${index}`, root);
    const row = element('p'); row.append(link); information.append(row);
  });
  node.append(information);
  if (change.decision_note) node.append(element('p', change.decision_note));
  if (change.processing?.error && change.processing.error !== change.decision_note) {
    node.append(element('p', change.processing.error));
  }
  if (canReview && annotations.length) {
    const actions=element('div',undefined,'dashboard-actions');
    actions.append(button('Finish review',()=>{
      if(annotations.some(item=>!['accept','reject'].includes(decisions[item.id]))){showToast(t('Approve or reject every annotation before finishing.'), 'error');return;}
      if(confirm(t('Finish this review? Approved changes will wait for a new edition.'))) void mutate('/review',{changeId:change.id,decision:'accept',annotationDecisions:decisions});
    }));node.append(actions);
  } else if (canReview) {
    const actions = element('div', undefined, 'dashboard-actions dashboard-review-actions');
    actions.append(reviewButton('accept', () => {
      if (confirm(t('Approve this proposal?'))) void mutate('/review', { changeId: change.id, attempt:change.cycle?.attempt, decision: 'accept' });
    }), reviewButton('reject', () => {
      const note = prompt(t('Reason for rejection (optional)'));
      if (note !== null) void mutate('/review', { changeId: change.id, attempt:change.cycle?.attempt, decision: 'reject', note });
    })); node.append(actions);
  }
  return node;
}
function catalogueTitle(bookId, fallback) {
  const title = publishedBooks.find(book => book.id === bookId)?.title;
  if (typeof title === 'string') return title || fallback;
  return title?.[document.documentElement.lang] || title?.en || Object.values(title || {}).find(Boolean) || fallback;
}
function taskCard(task) {
  const kinds = { 'book-proposal': 'Book proposal', manuscript: 'Manuscript', edit: 'Edit', fork: 'Derived book', animation: 'Animation', translation: 'Translation', 'librarian-feedback': 'Library feedback' };
  const node = card(catalogueTitle(task.book_id, task.title), states[task.state], `${t(kinds[task.kind] || task.kind)} · ${date(task.created_at)}`);
  if (task.state === 'queued') node.append(element('p', t('Waiting for a scheduled or manual processing run.'), 'dashboard-meta'));
  if (task.error) node.append(element('p', task.error));
  if (task.result) node.append(element('p', task.result));
  if (task.state === 'queued' && (task.owner === data.user.id || task.requester===data.user.id || data.canManageTasks)) node.append(button('Cancel task', () => {
    if (confirm(t('Cancel this queued task? The accepted change remains in history.'))) void mutate('/cancel', { taskId: task.id });
  }));
  if (task.state === 'running' && (task.owner === data.user.id || task.requester===data.user.id || data.canManageTasks)) node.append(button('Stop task', () => {
    if (confirm(t('Request stopping this task? Work already published cannot be undone.'))) void mutate('/cancel', { taskId: task.id });
  }));
  return node;
}

async function requestEdition(bookId) {
  const edition=data.editions.find(item=>item.bookId===bookId);
  if (!edition || mutation) return;
  const confirmedCost=data.pointsPolicy?.editionCost || 0;
  if (!confirm(t('Use {count} credits to create this edition?',{count:confirmedCost})))return;
  if(!editionSubmissionIds.has(bookId))editionSubmissionIds.set(bookId,newSubmissionId());
  if(await mutate('/editions',{bookId,submissionId:editionSubmissionIds.get(bookId),confirmedCost}))editionSubmissionIds.delete(bookId);
}
function editionRequestForm() {
  const section=element('section',undefined,'dashboard-card');
  section.append(element('h2',t('Request a new edition')));
  const label=element('label',t('Book')), select=element('select');
  const placeholder=element('option',t('Select a book'));placeholder.value='';select.append(placeholder);
  for(const book of data.editions){const option=element('option',catalogueTitle(book.bookId, book.title || book.bookId));option.value=book.bookId;select.append(option);}
  const submit=button('Submit new edition',()=>void requestEdition(select.value));submit.disabled=true;
  const note=element('p',undefined,'dashboard-meta');
  select.onchange=()=>{const book=data.editions.find(item=>item.bookId===select.value);submit.disabled=!book || Boolean(book.activeTask) || Boolean(data.editionCycles?.some(item=>item.bookId===book.bookId));note.textContent=book?.activeTask?t('An edition is already pending or running.'):t('Use {count} credits to create this edition?',{count:data.pointsPolicy?.editionCost || 0});};
  label.append(select);section.append(label,note,submit);return section;
}
function renderChangeGroups(changes, target) {
  const groups = new Map();
  for (const change of changes) {
    const key = change.book_id || null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(change);
  }
  // The server returns newest first: preserve that order within and between books.
  let index = 0;
  for (const [bookId, requests] of groups) {
    const section = disclosure(`group:${bookId || 'library'}`, 'dashboard-change-group');
    const header = element('summary', undefined, 'dashboard-change-group-heading');
    const title = element('h2');
    const titleText = element('span', bookId ? catalogueTitle(bookId, requests[0].title) : t('Library feedback'), 'dashboard-change-group-title');
    const requestTypes = {
      'book-proposal': 'Create book', manuscript: 'Create book', edit: 'Book corrections',
      fork: 'Create derived book', animation: 'Book animation', translation: 'Book translation',
      'librarian-feedback': 'Library feedback',
    };
    const typeCounts = new Map();
    for (const request of requests) {
      const label = requestTypes[request.kind] || 'Other request';
      typeCounts.set(label, (typeCounts.get(label) || 0) + 1);
    }
    const stateCounts = new Map();
    for (const request of requests) {
      const status = currentChangeStatus(request);
      const summary = stateCounts.get(status.state) || {label:status.label,count:0};
      summary.count++;stateCounts.set(status.state,summary);
    }
    const stateSummary = element('span', undefined, 'dashboard-change-group-states');
    const icons = {
      'Create book': '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20M6.5 3H20v19H6.5A2.5 2.5 0 0 1 4 19.5v-14A2.5 2.5 0 0 1 6.5 3Z"/><path d="M9 9h6m-3-3v6"/>',
      'Book corrections': '<path d="m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5"/>',
      'Create derived book': '<circle cx="6" cy="5" r="2"/><circle cx="18" cy="5" r="2"/><circle cx="6" cy="19" r="2"/><path d="M6 7v10m0-4h6a6 6 0 0 0 6-6"/>',
      'Book animation': '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="m10 8 6 4-6 4V8Z"/>',
      'Book translation': '<path d="M3 5h12M9 3v2m4 0c-1 6-5 10-10 12m2-9c2 4 5 7 9 9m0 4 4-10 4 10m-6-4h4"/>',
      'Library feedback': '<path d="M21 11a8 8 0 0 1-8 8H7l-4 3V11a9 9 0 0 1 18 0Z"/><path d="M8 9h8m-8 4h5"/>',
    };
    for (const [label, count] of typeCounts) {
      const type = element('span', undefined, 'dashboard-change-group-type');
      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 24 24');icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');icon.setAttribute('stroke-width', '1.7');
      icon.setAttribute('stroke-linecap', 'round');icon.setAttribute('stroke-linejoin', 'round');
      icon.setAttribute('aria-hidden', 'true');icon.setAttribute('focusable', 'false');
      icon.innerHTML = icons[label] || '<circle cx="12" cy="12" r="9"/><path d="M12 8v5m0 3h.01"/>';
      type.append(icon, element('span', `${t(label)}${count > 1 ? ` (${count})` : ''}`));
      stateSummary.append(type);
    }
    for (const state of ['running','stop_requested','failed','open','queued','accepted','completed','rejected','cancelled']) {
      const summary = stateCounts.get(state);if (!summary) continue;
      const indicator = element('span', undefined, 'dashboard-change-group-state');
      indicator.append(element('span',t(summary.label)),element('strong',String(summary.count)));
      indicator.dataset.state = state;indicator.title = `${t(summary.label)}: ${summary.count}`;
      indicator.setAttribute('role','img');indicator.setAttribute('aria-label',indicator.title);
      stateSummary.append(indicator);
    }
    titleText.append(stateSummary);
    title.id = `${target.id}-change-group-${index++}`;section.setAttribute('aria-labelledby', title.id);
    const count = element('span', String(requests.length), 'dashboard-change-group-count');
    count.setAttribute('aria-label', `${t('Editorial requests')}: ${requests.length}`);
    count.title = count.getAttribute('aria-label');
    title.append(titleText, count);header.append(title);section.append(header);
    const list = element('div', undefined, 'dashboard-change-group-list');
    const edition = data.editions.find(item=>item.bookId === bookId);
    const cycle = data.editionCycles?.find(item=>item.bookId === bookId);
    if (edition && (edition.pendingCount > 0 || edition.activeTask || cycle)) {
      const toolbar = element('div', undefined, 'dashboard-edition-toolbar');
      const note = element('p', edition.activeTask ? t('An edition is already pending or running.')
        : t('{count} approved changes waiting for a new edition.', {count:edition.pendingCount}), 'dashboard-meta');
      const submit = button('Submit new edition', async () => {
        if (mutation) return;
        const confirmedCost = data.pointsPolicy?.editionCost || 0;
        if (confirmedCost && !confirm(t('Use {count} credits to create this edition?', {count:confirmedCost}))) return;
        if (!editionSubmissionIds.has(bookId)) editionSubmissionIds.set(bookId,newSubmissionId());
        if (await mutate('/editions',{bookId,submissionId:editionSubmissionIds.get(bookId),confirmedCost})) editionSubmissionIds.delete(bookId);
      });
      submit.disabled = Boolean(cycle || edition.activeTask) || !edition.pendingCount;
      if (submit.disabled) submit.title = note.textContent;
      toolbar.append(note,submit);addCycleState(toolbar,cycle,true);list.append(toolbar);
    }
    for (const change of requests) list.append(changeCard(change));
    section.append(list);
    target.append(section);
  }
}

const dashboardSections = new Map();
function renderPointsSection(name, target) {
  let entry = dashboardSections.get(name);
  if (!entry) {
    const node = element('div', undefined, name === 'points' ? 'account-points' : 'account-users dashboard-' + (name === 'settings' ? 'admin' : name));
    node.append(element('p', t('Loading dashboard…'), 'dashboard-meta'));
    entry = {node};dashboardSections.set(name,entry);
    const modules = {
      settings: () => import('./account-admin.js?v=animation-cost-1'),
      users: () => import('./account-users.js?v=users-errors-1'),
      points: () => import('./account-points.js?v=credit-release-1'),
    };
    const loadModule = modules[name]();
    const creditPurchasesEnabled = data.isBetaVersion === false;
    void loadModule.then(async module => {
      entry.controller = await (name === 'settings' ? module.mountAdministration(node, undefined, {creditPurchasesEnabled})
        : name === 'users' ? module.mountUsers(node) : module.mountPoints(node, {accountId:data.user.id, creditPurchasesEnabled}));
    }).catch(error => {
      node.replaceChildren(element('p', error.message, 'dashboard-meta'));
      dashboardSections.delete(name);
    });
  }
  // Polling and tab switches must not discard pending price or award form input.
  if (target.firstElementChild !== entry.node) target.replaceChildren(entry.node);
}

function renderAdministration() {
  const tab = adminTabs.find(node => node.dataset.adminView === adminView && !node.hidden);
  markSelectedTab(adminTabs, tab);
  adminContent.setAttribute('aria-labelledby', tab.id);
  if (adminView === 'settings' || adminView === 'users') {
    renderPointsSection(adminView, adminContent);
    return;
  }
  adminContent.replaceChildren();
  if (adminView === 'reviews') {
    if (!data.changes.length) adminContent.append(element('div', t('No change requests.'), 'dashboard-empty'));
    renderChangeGroups(data.changes, adminContent);
  } else {
    if (!data.tasks.length) adminContent.append(element('div', t('No tasks.'), 'dashboard-empty'));
    for (const task of data.tasks) adminContent.append(taskCard(task));
  }
}

function render() {
  const target = view === 'admin' ? adminContent : content;
  for (const node of target.querySelectorAll('details[data-disclosure-key]')) disclosureStates.set(node.dataset.disclosureKey, node.open);
  localize();
  for (const tab of adminTabs) {
    tab.hidden = ['tasks','reviews'].includes(tab.dataset.adminView) ? !data.canManageTasks : !data.canManageUsers;
  }
  administrationTab.hidden = adminTabs.every(tab => tab.hidden);
  if (!data.canManageUsers) {
    for (const name of ['settings','users']) {
      dashboardSections.get(name)?.node.replaceChildren();
      dashboardSections.delete(name);
    }
  }
  if (administrationTab.hidden) adminContent.replaceChildren();

  if (view === 'admin') {
    if (administrationTab.hidden) {
      selectView(tabs[0]);
    } else if (!adminTabs.some(tab => tab.dataset.adminView === adminView && !tab.hidden)) {
      selectView(administrationTab);
    } else {
      renderAdministration();
    }
    return;
  }
  if (view === 'points') { renderPointsSection(view, content); return; }
  content.replaceChildren();
  if (view === 'changes') {
    const bookIds = new Set(data.books.map(book => book.id));
    const changes = data.changes.filter(change => change.author === data.user.id || bookIds.has(change.book_id));
    if (!changes.length) content.append(element('div', t('No change requests.'), 'dashboard-empty'));
    renderChangeGroups(changes, content);
    return;
  }
  const selectedBook = new URL(location.href).searchParams.get('book');
  const books = selectedBook ? [...data.books].sort((a,b) => Number(b.id === selectedBook) - Number(a.id === selectedBook)) : data.books;
  if (data.editions?.length) content.append(editionRequestForm());
  if (!books.length) content.append(element('div', t('No books yet. Create a book to get started.'), 'dashboard-empty'));
  for (const book of books) content.append(bookCard(book));
}

function markSelectedTab(tabList, selected) {
  for (const tab of tabList) {
    tab.setAttribute('aria-selected', String(tab === selected));
    tab.tabIndex = tab === selected ? 0 : -1;
  }
}
function selectView(node, section = adminView) {
  if (node.hidden) return;
  view = node.dataset.view;
  const url = new URL(location.href);
  url.searchParams.set('tab', view);
  if (view === 'admin') {
    const tab = adminTabs.find(item => !item.hidden && item.dataset.adminView === section) || adminTabs.find(item => !item.hidden);
    adminView = tab.dataset.adminView;
    url.searchParams.set('section', adminView);
  } else {
    url.searchParams.delete('section');
    content.setAttribute('aria-labelledby', node.id);
  }
  history.replaceState(history.state, '', url);
  markSelectedTab(tabs, node);
  content.hidden = view === 'admin';
  adminPanel.hidden = view !== 'admin';
  if (data) render();
}
function bindTabs(tabList, select) {
  for (const node of tabList) {
    node.addEventListener('click', () => select(node));
    node.addEventListener('keydown', event => {
      const visible = tabList.filter(tab => !tab.hidden);
      const index = visible.indexOf(node);
      let target;
      if (event.key === 'ArrowRight') target = visible[(index + 1) % visible.length];
      if (event.key === 'ArrowLeft') target = visible[(index + visible.length - 1) % visible.length];
      if (event.key === 'Home') target = visible[0];
      if (event.key === 'End') target = visible.at(-1);
      if (target) { event.preventDefault(); select(target); target.focus(); }
    });
  }
}
bindTabs(tabs, selectView);
bindTabs(adminTabs, tab => { if (view === 'admin' && !tab.hidden) selectView(administrationTab, tab.dataset.adminView); });
document.querySelector('#refresh').addEventListener('click', refresh);
document.addEventListener('scriptahub:points-policy', () => { void api('/points-policy').then(policy => { if(data) data.pointsPolicy=policy; }).catch(error => showToast(error.message,'error')); });
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

// Keep asynchronous funding, publication and restoration status visible.
setInterval(()=>{
  const activeAdminView = view === 'admin' && ['tasks','reviews'].includes(adminView);
  if (!mutation && !refreshing && data && (view === 'books' || view === 'changes' || activeAdminView) && document.visibilityState === 'visible'
    && (data.editionCycles?.length
      || data.changes.some(item => ['funding','active','restoring','published'].includes(item.cycle?.phase))
      || (activeAdminView && data.tasks.some(task => ['queued','running','stop_requested'].includes(task.state))))) void refresh({background:true});
},5000);
