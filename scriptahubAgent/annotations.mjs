const fail = message => { throw Object.assign(new Error(message), {status:400}); };
export function annotations(meta) {
  if (meta.values?.annotations === undefined) return null;
  if (meta.kind !== 'edit') fail('Annotations require an edit contribution');
  let items;
  try { items = JSON.parse(meta.values.annotations); } catch { fail('Invalid annotations'); }
  if (!Array.isArray(items) || !items.length || items.length > 50) fail('Provide between 1 and 50 annotations');
  const ids = new Set();
  for (const item of items) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) fail('Invalid annotation');
    if (Object.keys(item).some(key => !['id','quote','prefix','suffix','start','end','section','kind','feedback','sources','edition','language'].includes(key))) fail('Unknown annotation field');
    for (const key of ['id','quote','kind','feedback','edition','language']) if (typeof item[key] !== 'string' || !item[key].trim()) fail('Incomplete annotation');
    if (!/^[a-zA-Z0-9-]{1,64}$/.test(item.id) || ids.has(item.id)) fail('Invalid annotation ID');
    ids.add(item.id);
    for (const key of ['quote','prefix','suffix','section','kind','feedback','sources','edition','language']) if (item[key] !== undefined && (typeof item[key] !== 'string' || item[key].length > 4000)) fail('Invalid annotation text');
    if (!Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end) || item.start < 0 || item.end <= item.start || item.end-item.start !== item.quote.length) fail('Invalid passage position');
    if (item.language !== meta.language) fail('Invalid annotation edition');
  }
  if (!/^\d+$/.test(meta.values.baseRevision || '')) fail('A base revision is required');
  return items;
}
export function approvedAnnotations(payload) {
  const items = annotations(payload.metadata);
  return items?.filter(item => payload.annotationDecisions?.[item.id] === 'accept') || [];
}
