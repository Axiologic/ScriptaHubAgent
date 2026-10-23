import crypto from 'node:crypto';

function key() {
  const value = process.env.PLOINKY_AGENT_SECRET || process.env.SCRIPTA_RECORD_KEY;
  if (!value || value.length < 32) throw Object.assign(new Error('ScriptaHub record signing key is unavailable'), { status: 503 });
  return value;
}

function digest(record) {
  const payload = JSON.stringify([record.id, record.owner, record.contact, record.metadata, record.files, record.createdAt, record.state, record.task]);
  return crypto.createHmac('sha256', key()).update(payload).digest('hex');
}

export function sealRecord(record) {
  return { ...record, proof: digest(record) };
}

export function verifyRecord(record) {
  if (!/^[0-9a-f]{64}$/.test(record?.proof || '')) throw new Error('Submission record has no valid proof');
  const expected = Buffer.from(digest(record), 'hex');
  if (!crypto.timingSafeEqual(expected, Buffer.from(record.proof, 'hex'))) throw new Error('Submission record was changed');
  return record;
}
