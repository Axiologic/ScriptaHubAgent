import { submissionCreditCost } from './points-policy.mjs';
import { ApprovalCycles, createCycleTables } from './approval-cycles.mjs';
import { prepareTaskSchema } from './task-schema.mjs';
import { annotations } from './annotations.mjs';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const now = () => new Date().toISOString();
const id = prefix => `${prefix}-${crypto.randomUUID().replaceAll('-', '')}`;
const text = (value, max = 16000) => typeof value === 'string' && value.trim().length <= max ? value.trim() : fail('Invalid text');

const standaloneEditionInstructions = 'Review the existing book and prepare a complete new edition, preserving its subject and attribution.';
const wordSegments = new Intl.Segmenter(undefined, { granularity: 'word' });

function suppliedTitle(values) {
  return values.titles?.trim() || values.title?.trim();
}

function draftBookTitle(db, { metadata, files = [] }) {
  const { kind, values } = metadata;
  const document = files.find(file => file.role !== 'cover' && file.originalName);
  const filename = document && path.basename(document.originalName.replaceAll('\\', '/'))
    .replace(/\.(pdf|docx?)$/iu, '').replace(/_+/gu, ' ');
  const brief = values.description?.trim() || values.prompt?.trim() || filename;
  const label = brief?.trim().replace(/\s+/gu, ' ') || (kind === 'manuscript' ? 'Manuscript' : 'Book proposal');
  const characters = Array.from(label);
  let title = label;
  if (characters.length > 72) {
    const limit = characters.slice(0, 72).join('').length;
    const segment = wordSegments.segment(label).containing(limit);
    const end = segment?.isWordLike && segment.index > 0 ? segment.index : limit;
    title = label.slice(0, end).trimEnd() + '…';
  }
  const draft = title;
  const taken = db.prepare("SELECT 1 FROM books WHERE title=? AND origin='created' AND revision=0 LIMIT 1");
  for (let number = 2; taken.get(title); number++) title = `${draft} (${number})`;
  return title;
}

export class DashboardStore {
  constructor(directory, { manageApprovals = false } = {}) {
    this.manageApprovals = manageApprovals;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path.join(directory, 'dashboard.sqlite'));
    chmodSync(path.join(directory, 'dashboard.sqlite'), 0o600);
    this.db.exec(`PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS books (id TEXT PRIMARY KEY, owner TEXT NOT NULL, title TEXT NOT NULL,
        source_id TEXT, origin TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS people (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS initial_credit_grants (user_id TEXT PRIMARY KEY REFERENCES people(id),
        amount INTEGER NOT NULL, granted_at TEXT);
      CREATE TABLE IF NOT EXISTS collaborators (book_id TEXT NOT NULL REFERENCES books(id), user_id TEXT NOT NULL,
        PRIMARY KEY(book_id,user_id));
      CREATE TABLE IF NOT EXISTS changes (id TEXT PRIMARY KEY, book_id TEXT REFERENCES books(id), author TEXT NOT NULL,
        kind TEXT NOT NULL, state TEXT NOT NULL, base_revision INTEGER NOT NULL, payload TEXT NOT NULL,
        created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT, decision_note TEXT);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, change_id TEXT NOT NULL REFERENCES changes(id), kind TEXT NOT NULL, base_revision INTEGER,
        state TEXT NOT NULL CHECK(state IN ('queued','running','stop_requested','cancelled','completed','failed')),
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, result TEXT, error TEXT, moderation_rejected INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, book_id TEXT, change_id TEXT, task_id TEXT,
        actor TEXT NOT NULL, action TEXT NOT NULL, created_at TEXT NOT NULL, subject_user TEXT);
      CREATE INDEX IF NOT EXISTS changes_book ON changes(book_id,created_at);
      CREATE INDEX IF NOT EXISTS tasks_state ON tasks(state,created_at);`);
    prepareTaskSchema(this);
    createCycleTables(this);
    this.cycles = new ApprovalCycles(this);
    if (manageApprovals) this.transaction(()=>{
      const waiting=this.db.prepare(`SELECT c.* FROM changes c JOIN approval_cycles ac ON ac.change_id=c.id
        WHERE c.kind IN ('manuscript','book-proposal') AND ac.phase='review' AND ac.task_id IS NULL`).all();
      for(const change of waiting){
        this.db.prepare("UPDATE changes SET state='accepted' WHERE id=?").run(change.id);
        this.db.prepare("UPDATE approval_cycles SET phase='active',updated_at=? WHERE id=?").run(now(),change.id);
        this.task(change,change.author);
      }
    });
    // Preserve existing activity. Unknown past recipients cannot be reconstructed.
    this.transaction(() => {
      this.db.prepare(`UPDATE changes AS c SET kind='edition-request'
        WHERE c.kind='edit' AND c.state='accepted' AND c.author=c.decided_by
          AND json_type(c.payload,'$.metadata.submissionId') IS NULL
          AND json_extract(c.payload,'$.metadata.values.feedback')=?
          AND EXISTS (SELECT 1 FROM tasks t WHERE t.change_id=c.id AND t.base_revision IS NOT NULL)`)
        .run(standaloneEditionInstructions);
      if (!this.db.prepare('PRAGMA table_info(events)').all().some(column => column.name === 'subject_user')) {
        this.db.exec('ALTER TABLE events ADD COLUMN subject_user TEXT');
      }
      const unnamed = this.db.prepare(`SELECT b.id,c.payload FROM books b JOIN changes c ON c.id=(
        SELECT initial.id FROM changes initial WHERE initial.book_id=b.id AND initial.kind IN ('manuscript','book-proposal')
          AND json_extract(initial.payload,'$.metadata.targetBookId') IS NULL ORDER BY initial.rowid LIMIT 1)
        WHERE b.title='Untitled book' AND b.origin='created' AND b.revision=0 ORDER BY c.created_at,c.rowid`).all();
      const updateTitle = this.db.prepare('UPDATE books SET title=? WHERE id=?');
      for (const book of unnamed) {
        const intake = JSON.parse(book.payload);
        if (!suppliedTitle(intake.metadata.values)) updateTitle.run(draftBookTitle(this.db, intake), book.id);
      }
    });
  }
  close() { this.db.close(); }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  event(actor, action, book = null, change = null, task = null, subjectUser = null) {
    this.db.prepare('INSERT INTO events(book_id,change_id,task_id,actor,action,created_at,subject_user) VALUES(?,?,?,?,?,?,?)')
      .run(book, change, task, actor, action, now(), subjectUser);
  }
  remember(user, catalogue = [], initialCredits = 0) {
    if (catalogue.length && !user.installationAdministratorId) fail('The system administrator identity is unavailable; imported books cannot be assigned yet.', 503);
    this.transaction(() => {
      const name = user.displayName || '';
      const added = this.db.prepare('INSERT INTO people VALUES(?,?,?) ON CONFLICT(id) DO NOTHING')
        .run(user.id, user.email, name).changes;
      if (added && initialCredits > 0) {
        this.db.prepare('INSERT INTO initial_credit_grants(user_id,amount) VALUES(?,?)').run(user.id, initialCredits);
      } else if (!added) {
        this.db.prepare('UPDATE people SET email=?,name=? WHERE id=?').run(user.email, name, user.id);
      }
      if (!user.installationAdministratorId) return;
      const insert = this.db.prepare('INSERT OR IGNORE INTO books(id,owner,title,source_id,origin,created_at) VALUES(?,?,?,?,?,?)');
      for (const book of catalogue) {
        const title = typeof book.title === 'string' ? book.title : book.title?.en || Object.values(book.title || {})[0] || book.id;
        insert.run(book.id, user.installationAdministratorId, title, book.id, 'catalogue', now());
      }
    });
  }
  pendingInitialCredits(userId) {
    return this.db.prepare('SELECT amount FROM initial_credit_grants WHERE user_id=? AND granted_at IS NULL').get(userId)?.amount;
  }
  confirmInitialCredits(userId) {
    this.db.prepare('UPDATE initial_credit_grants SET granted_at=? WHERE user_id=? AND granted_at IS NULL').run(now(), userId);
  }
  book(bookId) { return this.db.prepare('SELECT * FROM books WHERE id=?').get(bookId) || fail('Book not found', 404); }
  canManageBook(book, user) {
    return book.owner === user.id || (Array.isArray(user.roles) && user.roles.includes('admin'));
  }
  canRead(book, user) {
    return this.canManageBook(book,user) || Boolean(this.db.prepare('SELECT 1 FROM collaborators WHERE book_id=? AND user_id=?').get(book.id, user.id));
  }
  canRequestEdition(book,user) {
    return this.canManageBook(book,user) || Boolean(this.db.prepare(
      "SELECT 1 FROM changes WHERE book_id=? AND author=? AND state='accepted' AND kind<>'edition-request' LIMIT 1"
    ).get(book.id,user.id));
  }
  editionAccess(book,user) {
    if (!this.canRequestEdition(book,user)) fail('A new edition requires book ownership or an approved contribution to this book.',403);
  }
  requireBookManager(book, user) { if (!this.canManageBook(book,user)) fail('Only the book owner or a workspace administrator can perform this action', 403); }
  validateSubmission(user, meta) {
    if (meta.kind === 'fork' && !meta.targetBookId) {
      const source = this.book(meta.bookId);
      if (source.origin !== 'catalogue' && source.revision === 0 && !this.canRead(source, user)) fail('Book access required', 403);
      return;
    }
    if (['manuscript', 'book-proposal', 'fork'].includes(meta.kind) && !meta.targetBookId) return;
    const bookId = meta.targetBookId || meta.bookId;
    if (!bookId) { if (meta.kind !== 'librarian-feedback') fail('A book is required'); return; }
    const book = this.book(bookId);
    if (annotations(meta) && Number(meta.values.baseRevision) !== book.revision) fail('The book has changed. Reload it before submitting annotations.', 409);
    if (book.origin !== 'catalogue' && book.revision === 0 && !this.canRead(book, user)) fail('Book access required', 403);
  }
  task(change, actor, taskId = change.id) {
    const existing = this.db.prepare('SELECT t.* FROM tasks t JOIN task_changes tc ON tc.task_id=t.id WHERE t.id=?').get(taskId);
    if (existing) return existing;
    const timestamp = now();
    this.db.prepare('INSERT INTO tasks(id,change_id,kind,state,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(taskId, change.id, change.kind, 'queued', timestamp, timestamp);
    const stored = this.db.prepare('SELECT * FROM changes WHERE id=?').get(change.id);
    this.db.prepare('INSERT INTO task_changes VALUES(?,?,0,?)').run(taskId,change.id,JSON.stringify(stored));
    this.db.prepare('UPDATE approval_cycles SET task_id=? WHERE id=?').run(taskId,change.id);
    this.event(actor, 'task.queued', change.book_id, change.id, taskId);
    return this.db.prepare('SELECT * FROM tasks WHERE id=?').get(taskId);
  }
  submit(record, policy = {}, user = {id:record.owner}) {
    if (user.id !== record.owner) fail('Submission belongs to another account', 403);
    return this.transaction(() => {
      const previous = this.db.prepare('SELECT * FROM changes WHERE id=?').get(record.id);
      if (previous) return this.receipt(previous);
      const { metadata: meta } = record;
      const isNewBook = ['manuscript','book-proposal','fork'].includes(meta.kind) && !meta.targetBookId;
      const managed = this.manageApprovals && (isNewBook || ['edit','animation'].includes(meta.kind));
      const cost = submissionCreditCost(meta.kind,policy) ?? 0;
      if (managed) {
        const duplicate = this.cycles.findContribution(record);
        if (duplicate) return this.receipt(this.db.prepare('SELECT * FROM changes WHERE id=?').get(duplicate.change_id));
      }
      this.validateSubmission(user, meta);
      let book, state = 'open';
      if (isNewBook) {
        const proposedTitle = suppliedTitle(meta.values);
        const title = proposedTitle ? text(proposedTitle, 500) : draftBookTitle(this.db, record);
        book = { id: id('bk'), owner: record.owner, revision: 0 };
        this.db.prepare('INSERT INTO books(id,owner,title,source_id,origin,created_at) VALUES(?,?,?,?,?,?)')
          .run(book.id, book.owner, title, meta.bookId || null, 'created', now());
        state = 'accepted';
      } else if (meta.targetBookId || meta.bookId) {
        book = this.book(meta.targetBookId || meta.bookId);
        if (this.canManageBook(book,user) && !(managed && meta.kind === 'animation' && cost > 0)) state = 'accepted';
      } else if (meta.kind !== 'librarian-feedback') fail('A book is required');
      const change = { id: record.id, book_id: book?.id || null, author: record.owner, kind: meta.kind,
        state, base_revision: book?.revision || 0 };
      this.db.prepare('INSERT INTO changes(id,book_id,author,kind,state,base_revision,payload,created_at,decided_at,decided_by) VALUES(?,?,?,?,?,?,?,?,?,?)')
        .run(change.id, change.book_id, change.author, change.kind, state, change.base_revision,
          JSON.stringify({ metadata: meta, files: record.files, ...(record.source ? {source:record.source} : {}), ...(annotations(meta) && state === 'accepted' ? {annotationDecisions:Object.fromEntries(annotations(meta).map(item=>[item.id,'accept']))} : {}) }), record.createdAt,
          state === 'accepted' ? now() : null, state === 'accepted' ? record.owner : null);
      this.event(record.owner, state === 'accepted' ? 'change.accepted' : 'change.proposed', change.book_id, change.id);
      if (managed) this.cycles.addContribution(record,change,{
        cost,
        reward: meta.kind === 'edit' ? policy.correctionReward : meta.kind === 'manuscript' ? policy.bookReward : 0,
        validityDays:policy.rewardValidityDays,
        phase: cost > 0 ? 'funding' : isNewBook ? 'active' : state === 'open' ? 'review' : meta.kind === 'edit' ? 'awaiting_publication' : 'completed',
      });
      if (state === 'accepted' && isNewBook) this.task(change, record.owner);
      return this.receipt(this.db.prepare('SELECT * FROM changes WHERE id=?').get(record.id));
    });
  }
  receipt(change) {
    const task = this.db.prepare('SELECT t.* FROM tasks t JOIN task_changes tc ON tc.task_id=t.id WHERE tc.change_id=? ORDER BY t.rowid DESC LIMIT 1').get(change.id);
    const cycle = this.cycles.present(this.cycles.read(change.id));
    return { submissionId: change.id, bookId: change.book_id, state: change.state, createdAt: change.created_at,
      ...(cycle ? {cycle} : {}),
      task: task ? { schemaVersion: 1, id: task.id, type: `scriptahub.${task.kind}`, state: task.state } : null };
  }
  decide(user, changeId, decision, note = '', annotationDecisions, attempt) {
    if (!['accept', 'reject'].includes(decision)) fail('Invalid decision');
    return this.transaction(() => {
      const change = this.db.prepare('SELECT * FROM changes WHERE id=?').get(changeId) || fail('Change not found', 404);
      const cycle = this.cycles.read(changeId);
      if (cycle && ['manuscript','book-proposal','fork'].includes(change.kind)) {
        fail('New books are processed and validated by the workflow; only corrections require this review.',409);
      }
      const book = this.book(change.book_id);
      this.requireBookManager(book,user);
      const payload = JSON.parse(change.payload), items = annotations(payload.metadata);
      if (items) {
        if (!annotationDecisions || typeof annotationDecisions !== 'object' || Array.isArray(annotationDecisions)
          || Object.keys(annotationDecisions).length !== items.length
          || items.some(item => !['accept','reject'].includes(annotationDecisions[item.id]))) fail('Decide every annotation before finishing the review');
        decision = items.some(item => annotationDecisions[item.id] === 'accept') ? 'accept' : 'reject';
        if (change.state !== 'open' && items.some(item => payload.annotationDecisions?.[item.id] !== annotationDecisions[item.id])) fail('This proposal has already been decided',409);
        payload.annotationDecisions = annotationDecisions;
      }
      const state = decision === 'accept' ? 'accepted' : 'rejected';
      if (change.state === state) return this.receipt(change);
      if (change.state !== 'open') fail('This proposal has already been decided', 409);
      if (change.kind === 'animation' && cycle && cycle.phase !== 'review') fail('The animation credit payment must be confirmed before review.',409);
      if (decision === 'accept' && change.base_revision !== book.revision) fail('The book has changed. Ask the author to submit an updated proposal.', 409);
      if (items) this.db.prepare('UPDATE changes SET payload=? WHERE id=?').run(JSON.stringify(payload),changeId);
      this.db.prepare('UPDATE changes SET state=?,decided_at=?,decided_by=?,decision_note=? WHERE id=?')
        .run(state, now(), user.id, text(note), changeId);
      this.event(user.id, `change.${state}`, book.id, changeId);
      if (cycle && change.kind === 'animation') {
        const phase = state === 'accepted' ? 'completed' : cycle.cost ? 'restoring' : 'rejected';
        this.db.prepare('UPDATE approval_cycles SET phase=?,reviewer=?,updated_at=? WHERE id=?')
          .run(phase,user.id,now(),changeId);
        if (phase !== 'restoring') this.cycles.notify(cycle,
          state === 'accepted' ? 'Animation suggestion approved' : 'Animation suggestion declined',
          state === 'accepted' ? 'Your animation suggestion was approved.' : 'Your animation suggestion was declined.');
      } else if (cycle) {
        const phase = state === 'rejected' ? 'rejected' : 'awaiting_publication';
        this.db.prepare('UPDATE approval_cycles SET phase=?,reviewer=?,updated_at=? WHERE id=?')
          .run(phase,user.id,now(),changeId);
        this.cycles.notify(cycle,state === 'accepted' ? 'Corrections approved' : 'Corrections declined',
          state === 'accepted' ? 'Your corrections were approved. Any reward will be awarded after an edition containing them is published, once per contributor and edition.' : 'Your corrections were declined.');
      }
      return this.receipt(this.db.prepare('SELECT * FROM changes WHERE id=?').get(changeId));
    });
  }
  submitEdition(user, bookId, submissionId, cost = 0, policy = {}) {
    return this.transaction(() => {
      const book = this.book(bookId); this.editionAccess(book,user);
      return this.manageApprovals ? this.cycles.addEdition(user,book,submissionId,cost,policy) : this.queueEdition(user,bookId,submissionId);
    });
  }
  queueEdition(user, bookId, submissionId) {
    if (typeof bookId !== 'string' || !bookId || bookId.length > 128) fail('Invalid book ID');
    if (typeof submissionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(submissionId)) fail('Invalid edition submission ID');
    const book = this.book(bookId);this.editionAccess(book,user);
    const taskId = `edition-${submissionId}`;
    const previous = this.db.prepare('SELECT t.*,c.book_id FROM tasks t JOIN changes c ON c.id=t.change_id WHERE t.id=?').get(taskId);
    if (previous) {
      if (previous.book_id !== bookId || previous.base_revision === null) fail('Edition submission ID already belongs to another task',409);
      const changeCount = this.db.prepare(`SELECT count(*) AS n FROM task_changes tc JOIN changes c ON c.id=tc.change_id
        WHERE tc.task_id=? AND c.kind<>'edition-request'`).get(taskId).n;
      return {taskId,state:previous.state,changeCount};
    }
    if (this.db.prepare(`SELECT 1 FROM tasks t JOIN changes c ON c.id=t.change_id
      WHERE c.book_id=? AND t.state IN ('queued','running','stop_requested')`).get(bookId)) fail('This book already has a pending or running edition task.',409);
    const requests = this.db.prepare(`SELECT c.* FROM changes c WHERE c.book_id=? AND c.state='accepted' AND c.kind<>'edition-request' AND (c.kind NOT IN ('manuscript','book-proposal','fork') OR json_extract(c.payload,'$.metadata.targetBookId') IS NOT NULL) AND NOT EXISTS
      (SELECT 1 FROM task_changes tc JOIN tasks t ON t.id=tc.task_id WHERE tc.change_id=c.id AND t.state NOT IN ('failed','cancelled'))
      ORDER BY c.created_at,c.rowid`).all(bookId);
    const changeCount = requests.length;
    if (!changeCount) {
      const requestId=crypto.randomUUID(), time=now();
      this.db.prepare(`INSERT INTO changes(id,book_id,author,kind,state,base_revision,payload,created_at,decided_at,decided_by)
        VALUES(?,?,?,'edition-request','accepted',?,?,?,?,?)`).run(requestId,book.id,user.id,book.revision,
          JSON.stringify({metadata:{kind:'edit',bookId:book.id,values:{feedback:standaloneEditionInstructions}},files:[]}),time,time,user.id);
      requests.push(this.db.prepare('SELECT * FROM changes WHERE id=?').get(requestId));
    }
    const time=now();
    this.db.prepare("INSERT INTO tasks(id,change_id,kind,base_revision,state,created_at,updated_at) VALUES(?,?,'edit',?,'queued',?,?)")
      .run(taskId,requests[0].id,book.revision,time,time);
    const insert=this.db.prepare('INSERT INTO task_changes VALUES(?,?,?,?)');
    requests.forEach((change,index)=>insert.run(taskId,change.id,index,JSON.stringify(change)));
    this.event(user.id,'edition.submitted',bookId,null,taskId);
    return {taskId,state:'queued',changeCount};
  }
  editionRequests(taskId) {
    return this.db.prepare('SELECT snapshot FROM task_changes WHERE task_id=? ORDER BY position').all(taskId).map(row=>JSON.parse(row.snapshot));
  }
  cancel(user, taskId) {
    return this.transaction(() => {
      const row = this.db.prepare('SELECT t.*,c.book_id,c.author FROM tasks t JOIN changes c ON c.id=t.change_id WHERE t.id=?').get(taskId) || fail('Task not found', 404);
      const requested=this.db.prepare("SELECT 1 FROM events WHERE task_id=? AND action='edition.submitted' AND actor=?").get(taskId,user.id);
      if (!requested) this.requireBookManager(this.book(row.book_id),user);
      if (this.db.prepare("SELECT 1 FROM approval_cycles WHERE task_id=? AND phase='funding'").get(taskId)) fail('Wait for points confirmation before cancelling.',409);
      if (['cancelled', 'stop_requested'].includes(row.state)) return;
      if (!['queued', 'running'].includes(row.state)) fail('This task has already finished.', 409);
      const state = row.state === 'queued' ? 'cancelled' : 'stop_requested';
      this.db.prepare('UPDATE tasks SET state=?,updated_at=? WHERE id=?').run(state, now(), taskId);
      this.event(user.id, `task.${state}`, row.book_id, row.change_id, taskId);
    });
  }
  access(user, bookId, email, remove = false) {
    return this.transaction(() => {
      const book = this.book(bookId); this.requireBookManager(book,user);
      const person = this.db.prepare('SELECT * FROM people WHERE lower(email)=lower(?)').get(text(email, 320));
      if (!person) fail('This account must sign in to ScriptaHub once before it can be added.', 404);
      if (person.id === book.owner) fail('The owner already has access');
      const mutation = remove
        ? this.db.prepare('DELETE FROM collaborators WHERE book_id=? AND user_id=?').run(bookId, person.id)
        : this.db.prepare('INSERT OR IGNORE INTO collaborators VALUES(?,?)').run(bookId, person.id);
      if (mutation.changes) this.event(user.id, remove ? 'access.removed' : 'access.granted', bookId, null, null, person.id);
    });
  }
  overview(user) {
    const canManageTasks = Array.isArray(user.roles) && user.roles.includes('admin');
    const books = this.db.prepare(`SELECT b.*, c.id AS creation_id, c.kind AS creation_kind,
      t.state AS creation_state, t.error AS creation_error
      FROM books b LEFT JOIN changes c ON c.id=(SELECT initial.id FROM changes initial
        WHERE initial.book_id=b.id AND initial.kind IN ('book-proposal','manuscript','fork')
        AND json_extract(initial.payload,'$.metadata.targetBookId') IS NULL ORDER BY initial.rowid LIMIT 1)
      LEFT JOIN tasks t ON t.id=(SELECT recent.id FROM tasks recent WHERE recent.change_id=c.id AND recent.base_revision IS NULL
        ORDER BY recent.rowid DESC LIMIT 1)
      WHERE ? OR b.owner=? OR EXISTS (SELECT 1 FROM collaborators member WHERE member.book_id=b.id AND member.user_id=?)
      ORDER BY b.created_at DESC,b.rowid DESC`).all(Number(canManageTasks), user.id, user.id)
      .map(({creation_id,creation_kind,creation_state,creation_error,...book})=>({
        ...book,
        ...(creation_id && {creation:{kind:creation_kind,state:creation_state,error:creation_error,
          cycle:this.canManageBook(book,user) ? this.cycles.present(this.cycles.read(creation_id)) : null}})
      }));
    const changes = this.db.prepare(`SELECT c.*,b.title,b.owner,t.state AS processing_state,t.updated_at AS processing_updated_at, t.error AS processing_error,
      COALESCE(NULLIF(trim(p.name),''),p.email) AS author_name FROM changes c LEFT JOIN books b ON b.id=c.book_id
      LEFT JOIN people p ON p.id=c.author LEFT JOIN tasks t ON t.id=(SELECT latest.id FROM tasks latest JOIN task_changes tc ON tc.task_id=latest.id WHERE tc.change_id=c.id ORDER BY latest.rowid DESC LIMIT 1) WHERE c.kind<>'edition-request' AND (c.author=? OR b.owner=? OR EXISTS
      (SELECT 1 FROM collaborators a WHERE a.book_id=b.id AND a.user_id=?)
      OR ?=1)
      ORDER BY c.created_at DESC`).all(user.id, user.id, user.id, Number(canManageTasks));
    const tasks = canManageTasks ? this.db.prepare(`SELECT t.*,c.book_id,c.author,b.title,b.owner,(SELECT ac.owner FROM approval_cycles ac WHERE ac.task_id=t.id) AS requester FROM tasks t JOIN changes c ON c.id=t.change_id
      JOIN books b ON b.id=c.book_id ORDER BY t.created_at DESC`).all() : [];
    const editionBooks = this.db.prepare(`SELECT b.* FROM books b WHERE ? OR owner=? OR EXISTS
      (SELECT 1 FROM changes c WHERE c.book_id=b.id AND c.author=? AND c.state='accepted' AND c.kind<>'edition-request')`).all(Number(canManageTasks),user.id,user.id);
    const editions = editionBooks.map(book => ({bookId:book.id,title:book.title,
      pendingCount:this.db.prepare(`SELECT count(*) AS n FROM changes c WHERE c.book_id=? AND c.state='accepted' AND c.kind<>'edition-request' AND (c.kind NOT IN ('manuscript','book-proposal','fork') OR json_extract(c.payload,'$.metadata.targetBookId') IS NOT NULL) AND NOT EXISTS
        (SELECT 1 FROM task_changes tc JOIN tasks t ON t.id=tc.task_id WHERE tc.change_id=c.id AND t.state NOT IN ('failed','cancelled'))`).get(book.id).n,
      activeTask:this.db.prepare(`SELECT t.id,t.state FROM tasks t JOIN changes c ON c.id=t.change_id WHERE c.book_id=?
        AND t.state IN ('queued','running','stop_requested') ORDER BY t.rowid DESC LIMIT 1`).get(book.id) || null}));
    return { user: { id: user.id, name: user.displayName || user.email }, books, editions,
      changes: changes.map(({processing_state, processing_updated_at, processing_error, ...change}) => {
        const cycle = this.cycles.present(this.cycles.read(change.id));
        const processing = processing_state && !(cycle?.phase === 'review' && ['manuscript','book-proposal'].includes(change.kind))
          ? {state:processing_state,updatedAt:processing_updated_at, ...(processing_error && {error:processing_error})} : null;
        return {...change,processing,payload:JSON.parse(change.payload),cycle};
      }), tasks, canManageTasks, canManageUsers: canManageTasks,
      editionCycles: this.db.prepare("SELECT * FROM approval_cycles WHERE owner=? AND kind='edition' AND phase NOT IN ('completed','rejected')").all(user.id).map(row=>this.cycles.present(row)),
      collaborators: this.db.prepare(`SELECT c.book_id,p.id,p.email,p.name FROM collaborators c JOIN people p ON p.id=c.user_id
        JOIN books b ON b.id=c.book_id WHERE ? OR b.owner=?`).all(Number(canManageTasks),user.id),
      events: this.db.prepare(`SELECT e.*,COALESCE(NULLIF(trim(p.name),''),p.email) AS actor_name,
        COALESCE(NULLIF(trim(s.name),''),s.email) AS subject_name
        FROM events e JOIN books b ON b.id=e.book_id LEFT JOIN people p ON p.id=e.actor
        LEFT JOIN people s ON s.id=e.subject_user WHERE ? OR b.owner=? OR EXISTS
        (SELECT 1 FROM collaborators c WHERE c.book_id=b.id AND c.user_id=?) ORDER BY e.id DESC LIMIT 200`).all(Number(canManageTasks),user.id,user.id),
      executionAvailable: false };
  }
}
