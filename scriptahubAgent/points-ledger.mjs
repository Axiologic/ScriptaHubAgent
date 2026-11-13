// Resolve service idempotency references to user-facing book context without
// changing the underlying UserPersisto ledger or its operation identities.
export function describePointsLedger(store, ledger, owner, catalogue, language = 'en') {
  const lookup = store.db.prepare(`SELECT b.id,b.title FROM approval_cycles ac
    JOIN books b ON b.id=ac.book_id WHERE ac.id=? AND ac.owner=?`);
  return {...ledger, entries:ledger.entries.map(entry => {
    const match = /^scriptahub:(?:reward|edition|fork):([a-f0-9-]{36})(?::[1-9][0-9]*)?$/i.exec(entry.referenceId || '');
    const record = match && lookup.get(match[1],owner);
    if (!record) return entry;
    const published = catalogue.find(book => book.id === record.id);
    const title = published?.title?.[language] || published?.title?.en || Object.values(published?.title || {}).find(Boolean) || record.title;
    const edition = published?.editions?.[language] || published?.editions?.en || Object.values(published?.editions || {}).find(edition => edition.book);
    return {...entry, book:{title, ...(edition?.book ? {path:edition.book} : {})}};
  })};
}
