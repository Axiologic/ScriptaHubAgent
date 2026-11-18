import {object,string,list,sourceRefs} from '../../scriptahub-tasks/shared/batch-io.mjs';
import {checkTerms} from './core.mjs';
export function schemaFor(batch) {
  return object({reviewed:{const:true},keywords:list(object({keyword:string,unitIds:sourceRefs(batch)}))});
}
export function validate(value,batch) {
  try {checkTerms(value.keywords,new Set(batch.units.map(unit=>unit.id)),'batch');return value.reviewed===true?[]:['Review is incomplete'];}
  catch(error){return [error.message];}
}
