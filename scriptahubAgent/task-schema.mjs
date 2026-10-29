// Tasks can contain several approved requests. Keep existing task IDs and executions intact.
export function prepareTaskSchema(store) {
  const db = store.db;
  db.exec('PRAGMA foreign_keys=OFF');
  try {
    store.transaction(() => {
      const columns = db.prepare('PRAGMA table_info(tasks)').all();
      if (!columns.some(column => column.name === 'kind')) {
        db.exec(`CREATE TABLE tasks_new (id TEXT PRIMARY KEY, change_id TEXT NOT NULL REFERENCES changes(id),
          kind TEXT NOT NULL, base_revision INTEGER,
          state TEXT NOT NULL CHECK(state IN ('queued','running','stop_requested','cancelled','completed','failed')),
          created_at TEXT NOT NULL, updated_at TEXT NOT NULL, result TEXT, error TEXT);
          INSERT INTO tasks_new SELECT t.id,t.change_id,c.kind,NULL,t.state,t.created_at,t.updated_at,t.result,t.error
            FROM tasks t JOIN changes c ON c.id=t.change_id;
          DROP TABLE tasks;
          ALTER TABLE tasks_new RENAME TO tasks;`);
      }
      db.exec(`CREATE INDEX IF NOT EXISTS tasks_state ON tasks(state,created_at);
        CREATE TABLE IF NOT EXISTS task_changes (task_id TEXT NOT NULL REFERENCES tasks(id),
          change_id TEXT NOT NULL REFERENCES changes(id), position INTEGER NOT NULL, snapshot TEXT NOT NULL,
          PRIMARY KEY(task_id,change_id), UNIQUE(task_id,position));
        CREATE INDEX IF NOT EXISTS task_changes_change ON task_changes(change_id);`);
      const missing = db.prepare(`SELECT t.id AS task_id,c.* FROM tasks t JOIN changes c ON c.id=t.change_id
        WHERE t.base_revision IS NULL AND NOT EXISTS(SELECT 1 FROM task_changes tc WHERE tc.task_id=t.id)`).all();
      const insert = db.prepare('INSERT INTO task_changes VALUES(?,?,0,?)');
      for (const {task_id,...change} of missing) insert.run(task_id,change.id,JSON.stringify(change));
      if (db.prepare('PRAGMA foreign_key_check').all().length) throw Error('Task schema has inconsistent references');
    });
  } finally { db.exec('PRAGMA foreign_keys=ON'); }
}
