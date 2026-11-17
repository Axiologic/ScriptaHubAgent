// A partial publication is successful for its validated editions, with explicit omitted languages.
export function translationOutcome(value, {languages} = {}) {
  if (value === undefined) return null;
  const invalid = () => { throw Object.assign(new Error('Invalid translation publication outcome'),{status:400}); };
  const tag = value => {
    if (typeof value !== 'string' || value.length>80) return invalid();
    try {return new Intl.Locale(value).baseName;} catch {return invalid();}
  };
  const list = values => {
    if (!Array.isArray(values) || values.length>64) return invalid();
    const result=values.map(tag);if(new Set(result).size!==result.length)return invalid();return result;
  };
  if (!value || typeof value!=='object') return invalid();
  const sourceLanguage=tag(value.sourceLanguage),requestedLanguages=list(value.requestedLanguages),publishedLanguages=list(value.publishedLanguages);
  if (!Array.isArray(value.omitted) || value.omitted.length>64) return invalid();
  const omitted=value.omitted.map(item=>{
    if (!item || typeof item.reason!=='string' || !item.reason.trim() || item.reason.length>1000) return invalid();
    return {language:tag(item.language),reason:item.reason.trim()};
  });
  const omittedLanguages=omitted.map(item=>item.language);
  if (!requestedLanguages.includes(sourceLanguage) || !publishedLanguages.includes(sourceLanguage)
    || new Set(omittedLanguages).size!==omittedLanguages.length
    || publishedLanguages.some(language=>!requestedLanguages.includes(language))
    || omittedLanguages.some(language=>!requestedLanguages.includes(language)||publishedLanguages.includes(language))
    || requestedLanguages.some(language=>!publishedLanguages.includes(language)&&!omittedLanguages.includes(language))) return invalid();
  if (languages) {
    const actual=list(languages);
    if (actual.length!==publishedLanguages.length || actual.some(language=>!publishedLanguages.includes(language))) return invalid();
  }
  return {sourceLanguage,requestedLanguages,publishedLanguages,omitted,partial:omitted.length>0};
}
export function translationOutcomeMessage(value) {
  const outcome=translationOutcome(value);
  if(!outcome?.partial)return '';
  return `Partially completed. Published languages: ${outcome.publishedLanguages.join(', ')}. Not published: ${outcome.omitted.map(item=>`${item.language} — ${item.reason}`).join('; ')}.`;
}
export function taskTranslationWarning(store,taskId) {
  const row=store.db.prepare(`SELECT p.manifest FROM task_publications p JOIN task_executions e ON e.id=p.execution_id WHERE e.task_id=? AND p.receipt IS NOT NULL`).get(taskId);
  return row ? translationOutcomeMessage(JSON.parse(row.manifest).validation?.translationOutcome) : '';
}
