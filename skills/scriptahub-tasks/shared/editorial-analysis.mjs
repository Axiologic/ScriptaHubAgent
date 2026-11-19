import {batchIdentity, list, object, sourceRefs, string} from './batch-io.mjs';

export const hookTypes = new Set(['premise', 'question', 'stakes', 'approach', 'atmosphere', 'starting-conflict', 'reader-fit']);
export const themeTypes = new Set(['subject', 'scope', 'context', 'question', 'tension', 'premise', 'setting', 'character', 'starting-conflict']);
export const revelationTypes = new Set(['answer', 'conclusion', 'solution', 'recommendation', 'twist', 'resolution', 'outcome', 'verdict', 'identity', 'fate', 'ending']);

export function sharedAnalysisSchema(batch) {
  const item = types => ({type: 'string', enum: [...types]});
  const evidence = {statement: string, sourceUnitIds: sourceRefs(batch)};
  return object({
    ...batchIdentity(batch),
    modeSignals: list(item(['fiction', 'nonfiction']), 1, {uniqueItems: true}),
    safeHooks: list(object({type: item(hookTypes), ...evidence}), 1),
    themes: list(object({type: item(themeTypes), ...evidence}), 1),
    protectedRevelations: list(object({type: item(revelationTypes), ...evidence, guardTerms: list(string, 1)})),
    audit: object({chapterCovered: {const: true}, revelationsSeparated: {const: true}, factsPreserved: {const: true}, notes: {type: 'string'}})
  });
}

export function projectAnalysis(analysis, role) {
  const marketing = role === 'marketing-summary';
  const collection = marketing ? 'safeHooks' : 'themes';
  const numberItems = (items, kind) => items.map((item, index) => ({
    id: `${analysis.batch.slice(0, -5)}-${kind}-${String(index + 1).padStart(3, '0')}`,
    ...item
  }));
  return {
    batch: analysis.batch, chapterId: analysis.chapterId, segment: analysis.segment, modeSignals: analysis.modeSignals,
    [collection]: numberItems(analysis[collection], marketing ? 'hook' : 'theme'),
    protectedRevelations: numberItems(analysis.protectedRevelations, 'revelation'),
    audit: {...analysis.audit, [marketing ? 'questionsIdentified' : 'themeIdentified']: true}
  };
}
