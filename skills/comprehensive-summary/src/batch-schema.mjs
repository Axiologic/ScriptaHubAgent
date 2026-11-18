import {object,string,list,audit,sourceRefs,batchIdentity} from '../../scriptahub-tasks/shared/batch-io.mjs';
export {validateAnalysis as validate} from './core.mjs';
export function schemaFor(batch) {
  const refs=sourceRefs(batch),evidence=object({statement:string,sourceUnitIds:refs});
  const score={type:'number',minimum:0,maximum:1};
  return object({...batchIdentity(batch),thesis:string,role:string,
    ideas:list(object({id:{type:'string',pattern:'^'+batch.batch.slice(0,-5)+'-idea-'},statement:string,centrality:score,originality:score,recurrenceCandidate:string,sourceUnitIds:refs}),1),
    evidenceAndExamples:list(evidence),objectionsAndQualifications:list(evidence),audit:audit(['chapterCovered','meaningPreserved','factsPreserved'])});
}
