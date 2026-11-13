import crypto from 'node:crypto';

const now = () => new Date().toISOString();
const fail = (message, status = 409) => { throw Object.assign(new Error(message), { status }); };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const stable = value => value && typeof value === 'object' && !Array.isArray(value)
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]))
  : Array.isArray(value) ? value.map(stable) : value;

export function contributionKey(record) {
  const { submissionId, confirmedCost, ...metadata } = record.metadata;
  const { annotationDraftKey, annotations, ...values } = metadata.values;
  if (annotations) {
    const items = JSON.parse(annotations).map(({id, ...content})=>JSON.stringify(stable(content)));
    values.annotations = [...new Set(items)].sort();
  }
  metadata.values = values;
  return crypto.createHash('sha256').update(JSON.stringify(stable([
    record.owner, metadata, record.source?.edition, record.files.map(file => file.sha256).sort(),
  ]))).digest('hex');
}

export function createCycleTables(store) {
  const {db} = store;
  db.exec(`CREATE TABLE IF NOT EXISTS approval_cycles (
    id TEXT PRIMARY KEY, request_key TEXT NOT NULL UNIQUE, kind TEXT NOT NULL, owner TEXT NOT NULL,
    book_id TEXT NOT NULL REFERENCES books(id), change_id TEXT REFERENCES changes(id), phase TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 1, task_id TEXT REFERENCES tasks(id), cost INTEGER NOT NULL DEFAULT 0,
    reward INTEGER NOT NULL DEFAULT 0, issue TEXT, missing INTEGER, reviewer TEXT, notification_id TEXT,
    updated_at TEXT NOT NULL, reward_validity_days INTEGER NOT NULL DEFAULT 0,
    expires_at TEXT, expiry_checked_at INTEGER NOT NULL DEFAULT 0
  );
  CREATE UNIQUE INDEX IF NOT EXISTS approval_cycles_task ON approval_cycles(task_id);
  CREATE INDEX IF NOT EXISTS approval_cycles_book ON approval_cycles(book_id,kind,phase);
  CREATE TABLE IF NOT EXISTS edition_reward_terms (
    task_id TEXT PRIMARY KEY REFERENCES tasks(id), reward INTEGER NOT NULL, validity_days INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS edition_reward_members (
    reward_id TEXT NOT NULL REFERENCES approval_cycles(id), change_id TEXT NOT NULL UNIQUE REFERENCES changes(id),
    PRIMARY KEY(reward_id,change_id)
  );
  CREATE TABLE IF NOT EXISTS cycle_notifications (
    id TEXT PRIMARY KEY, recipient TEXT NOT NULL, subject TEXT NOT NULL, message TEXT NOT NULL,
    sent_at TEXT
  );`);

}

export class ApprovalCycles {
  constructor(store) { this.store = store; this.db = store.db; }

  read(id) { return this.db.prepare('SELECT * FROM approval_cycles WHERE id=?').get(id); }

  present(row) {
    if (!row) return null;
    return { id: row.id, kind: row.kind, phase: row.phase, attempt: row.attempt, taskId: row.task_id,
      bookId: row.book_id, issue: row.issue, missing: row.missing, cost: row.cost };
  }

  findContribution(record) {
    return this.db.prepare('SELECT change_id FROM approval_cycles WHERE request_key=?').get(contributionKey(record));
  }

  addContribution(record, change, { cost = 0, reward = 0, validityDays = 0, phase }) {
    this.db.prepare(`INSERT INTO approval_cycles
      (id,request_key,kind,owner,book_id,change_id,phase,cost,reward,updated_at,reward_validity_days) VALUES(?,?,?,?,?,?,?,?,?,?,?)`)
      .run(change.id, contributionKey(record), change.kind, record.owner, change.book_id, change.id, phase, cost, reward, now(), validityDays);
  }

  addEdition(user, book, submissionId, cost, policy = {}) {
    if (typeof submissionId !== 'string' || !uuid.test(submissionId)) fail('Invalid edition submission ID.', 400);
    const existing = this.read(submissionId);
    if (existing) {
      if (existing.owner !== user.id || existing.book_id !== book.id || existing.kind !== 'edition') fail('Submission ID is in use.');
      return this.present(existing);
    }
    const previous = this.db.prepare(`SELECT * FROM approval_cycles WHERE kind='edition' AND book_id=?
      AND phase NOT IN ('completed','rejected','retryable')`).get(book.id);
    if (previous) {
      if(previous.owner!==user.id) fail('This book already has a pending edition request.');
      return this.present(previous);
    }
    this.db.prepare(`INSERT INTO approval_cycles (id,request_key,kind,owner,book_id,phase,cost,updated_at)
      VALUES(?,?,'edition',?,?,?,?,?)`).run(submissionId, `edition:${submissionId}`, user.id, book.id, 'funding', cost, now());
    const task = this.store.queueEdition(user, book.id, submissionId);
    this.db.prepare('UPDATE approval_cycles SET task_id=? WHERE id=?').run(task.taskId,submissionId);
    this.db.prepare('INSERT INTO edition_reward_terms VALUES(?,?,?)')
      .run(task.taskId,policy.correctionReward || 0,policy.rewardValidityDays || 0);
    return this.present(this.read(submissionId));
  }

  retry(user, cycleId, attempt) {
    const row = this.read(cycleId);
    if (!row || row.owner !== user.id) fail('Request not found.', 404);
    if (row.attempt !== attempt) {
      if (row.attempt === attempt + 1) return this.present(row);
      fail('This retry belongs to a previous attempt.');
    }
    if (row.phase !== 'retryable') fail('Retry is available once the previous attempt has been reset.');
    if(row.kind==='edition' && this.db.prepare(`SELECT 1 FROM tasks t JOIN changes c ON c.id=t.change_id
      WHERE c.book_id=? AND t.state IN ('queued','running','stop_requested')`).get(row.book_id)) fail('This book already has a pending or running edition task.');
    const nextAttempt = row.attempt + 1;
    const phase = ['fork','edition'].includes(row.kind) ? 'funding' : 'active';
    this.db.prepare(`UPDATE approval_cycles SET attempt=?,phase=?,task_id=NULL,issue=NULL,missing=NULL,
      reviewer=NULL,notification_id=NULL,updated_at=? WHERE id=?`).run(nextAttempt,phase,now(),row.id);
    if (row.kind === 'edition') {
      const original = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(row.task_id);
      if (!original || original.base_revision !== this.store.book(row.book_id).revision) {
        fail('The book revision changed. Reload the book before retrying.');
      }
      const taskId = 'edition-' + crypto.randomUUID();
      const time = now();
      this.db.prepare(`INSERT INTO tasks(id,change_id,kind,base_revision,state,created_at,updated_at)
        VALUES(?,?,'edit',?,'queued',?,?)`).run(taskId,original.change_id,original.base_revision,time,time);
      this.db.prepare(`INSERT INTO task_changes(task_id,change_id,position,snapshot)
        SELECT ?,change_id,position,snapshot FROM task_changes WHERE task_id=?`).run(taskId,original.id);
      this.db.prepare('UPDATE approval_cycles SET task_id=? WHERE id=?').run(taskId,row.id);
      this.db.prepare(`INSERT INTO edition_reward_terms SELECT ?,reward,validity_days FROM edition_reward_terms WHERE task_id=?`).run(taskId,original.id);
      this.store.event(user.id,'edition.submitted',row.book_id,null,taskId);
    } else if (row.kind === 'fork') {
      const change = this.db.prepare('SELECT * FROM changes WHERE id=?').get(row.change_id);
      this.store.task(change,user.id,`${row.id}-${nextAttempt}`);
    } else {
      this.db.prepare(`UPDATE changes SET state='accepted',decided_by=NULL,decided_at=NULL,decision_note=NULL WHERE id=?`).run(row.change_id);
      const change = this.db.prepare('SELECT * FROM changes WHERE id=?').get(row.change_id);
      this.store.task(change,user.id,`${row.id}-${nextAttempt}`);
    }
    return this.present(this.read(row.id));
  }

  rewardPublishedEdition(taskId, bookId, revision) {
    const terms = this.db.prepare('SELECT * FROM edition_reward_terms WHERE task_id=?').get(taskId);
    if (!terms) return;
    const included = this.db.prepare(`SELECT c.id,c.author FROM task_changes tc
      JOIN changes c ON c.id=tc.change_id JOIN approval_cycles ac ON ac.id=c.id
      WHERE tc.task_id=? AND c.kind='edit' AND ac.phase='awaiting_publication'
      ORDER BY tc.position`).all(taskId);
    const contributors = new Map();
    for (const change of included) {
      if (!contributors.has(change.author)) contributors.set(change.author,[]);
      contributors.get(change.author).push(change.id);
    }
    for (const [owner, changes] of contributors) {
      const key = `correction-edition:${bookId}:${revision}:${owner}`;
      this.db.prepare(`INSERT OR IGNORE INTO approval_cycles
        (id,request_key,kind,owner,book_id,phase,reward,reward_validity_days,updated_at)
        VALUES(?,?,'edit',?,?,?,?,?,?)`)
        .run(crypto.randomUUID(),key,owner,bookId,terms.reward ? 'rewarding' : 'completed',terms.reward,terms.validity_days,now());
      const reward = this.db.prepare('SELECT * FROM approval_cycles WHERE request_key=?').get(key);
      for (const changeId of changes) {
        this.db.prepare('INSERT OR IGNORE INTO edition_reward_members VALUES(?,?)').run(reward.id,changeId);
        this.db.prepare('UPDATE approval_cycles SET phase=?,updated_at=? WHERE id=?')
          .run(terms.reward ? 'published' : 'completed',now(),changeId);
      }
    }
  }

  notify(row, subject, message) {
    const key = `${row.id}:${row.attempt}:${subject}`;
    this.db.prepare(`INSERT OR IGNORE INTO cycle_notifications (id,recipient,subject,message)
      SELECT ?,email,?,? FROM people WHERE id=?`).run(key,`ScriptaHub: ${subject}`,`${message}\nScriptaHub reference: ${row.id}`,row.owner);
    return key;
  }
}
