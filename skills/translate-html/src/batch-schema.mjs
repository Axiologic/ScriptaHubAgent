import {object,string,list} from '../../scriptahub-tasks/shared/batch-io.mjs';
import {requiresModel} from './document.mjs';
export function schemaFor(batch) {
  const ids=batch.units.filter(requiresModel).map(unit=>unit.id);
  return object({units:list(object({id:{type:'string',enum:ids},translation:string}),ids.length,{maxItems:ids.length})});
}
export function validate(value,batch) {
  const expected=batch.units.filter(requiresModel),errors=[];
  if(new Set(value.units.map(unit=>unit.id)).size!==expected.length)errors.push('Each required translation unit must appear exactly once');
  for(const unit of value.units) {
    const source=expected.find(item=>item.id===unit.id);
    const tokens=text=>(text.match(/⟦[^⟧]+⟧/gu)||[]).sort();
    if(!source||JSON.stringify(tokens(source.source))!==JSON.stringify(tokens(unit.translation)))errors.push('Protected markup tokens differ for '+unit.id);
  }
  return errors;
}
