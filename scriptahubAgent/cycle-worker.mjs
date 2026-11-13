import { callAgent } from './identity.mjs';

const day = 24 * 60 * 60 * 1000;
const timestamp = () => new Date().toISOString();
const points = (row, operation, amount) => callAgent('userPersistoAgent','userpersisto_scriptahub_points_apply',{
  userId: row.owner.replace(/^user:/, ''), operation, requestId: row.id, attempt: row.attempt, amount, kind: row.kind, ...(operation === 'reward' && row.expires_at ? {expiresAt:row.expires_at} : {}),
});
const sendEmail = ({recipient,subject,message}) => callAgent('emailAgent','email_send_text',{to:recipient,subject,text:message});

export async function advanceCycles(store, { apply = points, send = sendEmail, report = console.error } = {}) {
  const { db, cycles } = store;
  const pending = db.prepare(`SELECT ac.*,t.state AS task_state FROM approval_cycles ac
    LEFT JOIN tasks t ON t.id=ac.task_id WHERE ac.phase IN ('funding','rewarding','restoring')
    OR (ac.phase='active' AND t.state IN ('failed','cancelled','completed')) ORDER BY ac.updated_at`).all();
  for (const row of pending) {
    const transition = (phase, issue = null, missing = null, notification = null) => {
      db.prepare(`UPDATE approval_cycles SET phase=?,issue=?,missing=?,notification_id=?,updated_at=?
        WHERE id=? AND phase=? AND attempt=?`).run(phase,issue,missing,notification,timestamp(),row.id,row.phase,row.attempt);
    };
    try {
      if (row.phase === 'funding') {
        const result = row.cost ? await apply(row,'debit',row.cost) : {};
        if (result.insufficient) {
          store.transaction(() => {
            db.prepare("UPDATE tasks SET state='cancelled',updated_at=? WHERE id=? AND state='queued'").run(timestamp(),row.task_id);
            const notice = cycles.notify(row,'Request restored',`Your request was restored. You need ${result.missing} more points before trying again.`);
            transition('retryable','Insufficient points.',result.missing,notice);
          });
        } else transition('active');
      } else if (row.phase === 'rewarding') {
        if (row.reward_validity_days && !row.expires_at) {
          row.expires_at = new Date(Date.now() + row.reward_validity_days * day).toISOString();
          db.prepare('UPDATE approval_cycles SET expires_at=? WHERE id=?').run(row.expires_at,row.id);
        }
        if (row.reward) await apply(row,'reward',row.reward);
        store.transaction(() => {
          db.prepare(`UPDATE approval_cycles SET phase='completed',updated_at=? WHERE id IN
            (SELECT change_id FROM edition_reward_members WHERE reward_id=?)`).run(timestamp(),row.id);
          const edition = db.prepare('SELECT 1 FROM edition_reward_members WHERE reward_id=? LIMIT 1').get(row.id);
          cycles.notify(row,'Points awarded',edition
            ? `Your corrections in the published edition earned ${row.reward} points. This is one reward for all your corrections included in that edition.`
            : `Your contribution earned ${row.reward} points.`);
          transition('completed');
        });
      } else if (row.phase === 'restoring') {
        if (row.cost) await apply(row,'refund',row.cost);
        store.transaction(() => {
          if (row.change_id && ['manuscript','book-proposal'].includes(row.kind)) {
            db.prepare("UPDATE changes SET state='accepted',decided_at=NULL,decided_by=NULL,decision_note=NULL WHERE id=?").run(row.change_id);
          }
          const restored = row.cost ? ' The debit was reversed. Check your points history for any expirations.' : '';
          const notice = cycles.notify(row,'Request restored',`Processing ${row.task_state === 'cancelled' ? 'was cancelled' : 'failed'}. Your request was restored.${restored} You can try again from your dashboard.`);
          transition('retryable',row.task_state === 'cancelled' ? 'Processing was cancelled.' : 'Processing failed.',null,notice);
        });
      } else if (row.task_state === 'completed') {
        store.transaction(() => {
          if (!row.reward) cycles.notify(row,'Book processing complete','Your book request has completed.');
          transition(row.reward ? 'rewarding' : 'completed');
        });
      } else transition('restoring');
    } catch (error) { report(`ScriptaHub cycle ${row.id}: ${error.message}`); }
  }
  for (const notice of db.prepare('SELECT * FROM cycle_notifications WHERE sent_at IS NULL ORDER BY rowid LIMIT 25').all()) {
    try {
      const sent = await send(notice);
      if (!sent?.providerMessageId) throw new Error('EmailAgent did not confirm delivery');
      db.prepare('UPDATE cycle_notifications SET sent_at=? WHERE id=?').run(timestamp(),notice.id);
    } catch (error) { report(`ScriptaHub notification ${notice.id}: ${error.message}`); }
  }
}

export async function checkRewardExpiry(store, policy, { apply = points, report = console.error, time = Date.now() } = {}) {
  const {db, cycles} = store;
  const until = new Date(time + Math.max(policy.firstNoticeDays,policy.lastNoticeDays) * day).toISOString();
  const pending = db.prepare(`SELECT * FROM approval_cycles WHERE phase='completed' AND expires_at<=?
    AND expiry_checked_at>=0 AND expiry_checked_at<? ORDER BY expiry_checked_at LIMIT 10`).all(until,time - day);
  for (const row of pending) {
    try {
      const {remaining} = await apply(row,'expiry',row.reward);
      const days = Math.ceil((Date.parse(row.expires_at) - time) / day);
      const threshold = days > 0 && [policy.lastNoticeDays,policy.firstNoticeDays].find(limit=>limit && days<=limit);
      store.transaction(() => {
        if (threshold && remaining) {
          cycles.notify(row,`Points expiration reminder (${threshold} days)`,
            `${remaining} contribution points expire on ${row.expires_at.slice(0,10)} (UTC). Check your points balance in My account.`);
        }
        db.prepare('UPDATE approval_cycles SET expiry_checked_at=? WHERE id=?').run(days<=0 ? -1 : time,row.id);
      });
    } catch (error) { report(`ScriptaHub expiry ${row.id}: ${error.message}`); }
  }
}

export function startCycleWorker(getStore, getPolicy) {
  const schedule = (label,interval,work) => {
    let pending;
    const tick = () => {
      if (!pending) pending = Promise.resolve().then(work)
        .catch(error => console.error(`ScriptaHub ${label}: ${error.message}`)).finally(() => { pending = null; });
    };
    const timer = setInterval(tick,interval);
    timer.unref();
    tick();
    return async () => { clearInterval(timer); await pending; };
  };
  const stopCycles = schedule('cycle worker',3000,()=>advanceCycles(getStore()));
  const stopExpiry = schedule('points expiry worker',60000,async()=>checkRewardExpiry(getStore(),await getPolicy()));
  return async () => { await Promise.all([stopCycles(),stopExpiry()]); };
}
