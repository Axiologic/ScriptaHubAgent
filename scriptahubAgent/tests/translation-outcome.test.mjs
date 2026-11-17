import test from 'node:test';
import assert from 'node:assert/strict';
import {translationOutcome,translationOutcomeMessage} from '../translation-outcome.mjs';
const partial={sourceLanguage:'en',requestedLanguages:['en','ro','es'],publishedLanguages:['en','ro'],omitted:[{language:'es',reason:'The Spanish translation failed validation.'}]};

test('a failed target is reported separately while complete source and target editions remain publishable',()=>{
  assert.equal(translationOutcome(partial,{languages:['ro','en']}).partial,true);
  assert.match(translationOutcomeMessage(partial),/Partially completed.*en, ro.*es.*failed validation/);
  assert.equal(translationOutcome(undefined),null);
  assert.equal(translationOutcomeMessage({...partial,publishedLanguages:['en','ro','es'],omitted:[]}), '');
});
test('publication cannot omit the source, hide an unfulfilled request or misreport actual packaged languages',()=>{
  for(const value of [
    {...partial,publishedLanguages:['ro']},
    {...partial,omitted:[]},
    {...partial,publishedLanguages:['en','ro','es']},
    {...partial,omitted:[{language:'es',reason:''}]},
  ])assert.throws(()=>translationOutcome(value),/Invalid translation/);
  assert.throws(()=>translationOutcome(partial,{languages:['en']}),/Invalid translation/);
  assert.throws(()=>translationOutcome(partial,{languages:['en','ro','es']}),/Invalid translation/);
});


test('all target translations may fail while the validated original remains publishable',()=>{
  const outcome=translationOutcome({...partial,publishedLanguages:['en'],omitted:[{language:'ro',reason:'Romanian worker failed.'},{language:'es',reason:'Spanish validation failed.'}]},{languages:['en']});
  assert.equal(outcome.partial,true);assert.equal(outcome.omitted.length,2);
});
