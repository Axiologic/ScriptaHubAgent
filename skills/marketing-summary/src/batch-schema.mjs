import {editorialSchema} from '../../scriptahub-tasks/shared/batch-io.mjs';
import {themeTypes,revelationTypes,validateAnalysis} from './core.mjs';
export const validate = validateAnalysis;
export const schemaFor = batch => editorialSchema(batch,{
  themeTypes,revelationTypes,collection:'safeHooks',itemKind:'hook',auditKey:'questionsIdentified'
});
