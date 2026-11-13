import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';

async function formApi() {
  const source = await fs.readFile(new URL('../site/assets/workflow.js', import.meta.url), 'utf8');
  const context = vm.createContext({
    URL, URLSearchParams,
    SCRIPTA_COLLECTION: {},
    document: {currentScript:{src:'http://localhost/assets/workflow.js'},querySelector:()=>({})},
    FormData: class extends FormData {
      constructor(entries) { super(); for (const [name,value] of entries) this.append(name,value); }
    },
  });
  vm.runInContext(source.replace('  document.addEventListener("scriptahub:language",',
    '  globalThis.formApi = {bookCover, creationData, bookInstructions, instructionLabels, coverCopy}; return;\n  document.addEventListener("scriptahub:language",'), context);
  return context.formApi;
}

test('cover choices are optional, localized and use the existing accessible selection dialogs', async () => {
  const api = await formApi();
  for (const lang of ['en','ro','fr','de','es','pt','it','pl']) {
    const html = api.bookCover(lang);
    assert.match(html,/class="create-cover-field create-instructions"/);
    assert.equal((html.match(/<dialog /g)||[]).length,3);
    for (const name of ['coverStyle','coverPalette','coverComposition']) {
      assert.match(html,new RegExp(`data-instruction-picker="${name}"`));
      assert.ok((html.match(new RegExp(`name="${name}"`,'g'))||[]).length>=6);
    }
    assert.match(html,/name="coverDescription"/);
    assert.match(html,/maxlength="4000"/);
    assert.ok(html.includes(api.coverCopy[lang][0]));
    assert.doesNotMatch(html,/\brequired\b|undefined/);
    const content = api.bookInstructions('Instructions',api.instructionLabels[lang],lang);
    assert.doesNotMatch(content,/coverStyle|coverDescription/);
  }
});

test('all preset and custom cover choices reach the task without becoming book content instructions', async () => {
  const api = await formApi();
  const data = api.creationData([
    ['titles','Grădini & orașe'],['description','  O carte despre grădini.  '],
    ['audience','Începători'],['audience','Familii'],
    ['coverMode','generate'],['coverStyle','Botanic'],['coverStyle','Desen în tuș <verde>'],
    ['coverPalette','Verde de pădure'],['coverComposition','Titlu mare'],
    ['coverDescription','  O seră pe acoperiș; fără oameni.  '],
  ],'ro');
  const values = Object.fromEntries(data);
  assert.equal(values.coverStyle,'Botanic; Desen în tuș <verde>');
  assert.equal(data.getAll('coverStyle').length,1);
  assert.equal(values.audience,'Începători; Familii');
  assert.equal(values.coverDescription,'O seră pe acoperiș; fără oameni.');
  assert.equal(values.coverMode,'generate');
  assert.match(values.prompt,/O carte despre grădini/);
  assert.doesNotMatch(values.prompt,/Botanic|tuș|seră|Titlu mare/);
  const automatic = Object.fromEntries(api.creationData([['description','Subiect'],['coverMode','generate']],'ro'));
  assert.equal(automatic.coverDescription,'');
  assert.equal(automatic.coverStyle,undefined);
  assert.equal(automatic.prompt,'Subiect');
});
