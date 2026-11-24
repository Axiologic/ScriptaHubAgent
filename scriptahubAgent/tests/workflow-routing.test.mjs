import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const flow = name => fs.readFile(new URL(`../../flows/${name}.json`,import.meta.url),'utf8').then(JSON.parse);

test('only requested translation may branch and every publication path passes validation',async()=>{
  const graph=await flow('create-book');
  const nodes=new Map(graph.tasks.map(task=>[task.id,task])), paths=[];
  function visit(current,previous=[]) {
    assert.ok(nodes.has(current));assert.ok(!previous.includes(current),'the book graph must not loop');
    const path=[...previous,current],next=graph.edges.filter(edge=>edge.sourceTaskId===current);
    assert.ok(next.length<=(current==='process-content'?2:1),`no failure/recovery shortcut from ${current}`);
    if(!next.length)paths.push(path);
    for(const edge of next)visit(edge.targetTaskId,path);
  }
  visit(graph.entryTaskId);
  assert.equal(paths.length,2,'only the translation/no-translation alternatives exist');
  assert.equal(paths.filter(path=>path.includes('translate-resources')).length,1,'translation must be bypassable');
  const stages=['comprehensive-summary','relevant-keywords','shared-editorial-analysis','marketing-summary','short-description'];
  const required=['resume-book','prepare-manuscript',...stages,'process-content','review-correct','export-book-pdf','validate-final','publish-result','book-result'];
  for(const path of paths)assert.deepEqual(path.filter(id=>id!=='translate-resources'),required);
  const translated=paths.find(path=>path.includes('translate-resources'));
  assert.ok(translated.indexOf('process-content')<translated.indexOf('translate-resources'));
  assert.ok(translated.indexOf('translate-resources')<translated.indexOf('review-correct'));
  assert.deepEqual(graph.edges.filter(edge=>edge.targetTaskId==='publish-result').map(edge=>edge.sourceTaskId),['validate-final']);
  const editorial=nodes.get('process-content'),translation=nodes.get('translate-resources');
  assert.ok(!editorial.skillsets.includes('ScriptaHubAgent/translate-html'),'only the separate translation step may run the translator');
  assert.ok(translation.skillsets.includes('ScriptaHubAgent/translate-html'));
  for(const role of ['marketing-summary','short-description']) {
    assert.match(nodes.get(role).prompt,/sharedEditorialAnalysis/);
    assert.deepEqual(nodes.get(role).skillsets,['ScriptaHubAgent/scriptahub-tasks','ScriptaHubAgent/'+role]);
  }
});

test('only the parent traverses requests and explicitly isolates failed book subflows',async()=>{
  const parent=await flow('add-books'), child=await flow('create-book');
  assert.equal(parent.tasks.find(task=>task.id==='select-task').continueOnChildFailure,true);
  assert.ok(parent.edges.some(edge=>edge.sourceTaskId==='reconcile-task'&&edge.targetTaskId==='select-next-task'));
  assert.ok(!child.tasks.some(task=>task.creator||task.kind==='run-workflows'));
  assert.ok(!child.edges.some(edge=>edge.targetTaskId==='select-task'));
});

test('batch startup is outside traversal loops for both book and edit workflows',async()=>{
  for(const name of ['add-books','edit-book']) {
    const graph=await flow(name);
    assert.equal(graph.entryTaskId,'select-task');
    assert.equal(graph.edges.some(edge=>edge.targetTaskId==='select-task'),false,'never restart a lot inside its traversal');
    const next=graph.tasks.find(task=>task.id==='select-next-task');
    assert.ok(next,'continuation selects within the saved snapshot');
    assert.ok(graph.edges.some(edge=>edge.targetTaskId===next.id));
    assert.ok(graph.edges.some(edge=>edge.sourceTaskId===next.id&&edge.targetTaskId==='batch-result'));
    assert.match(next.prompt,/Call only batch-next/i);
    assert.equal(next.continueOnChildFailure,true);
    assert.ok(graph.edges.some(edge=>edge.sourceTaskId===next.id&&edge.targetTaskId==='reconcile-task'));
  }
});

test('a normal edit reaches publication only after package preparation and validation',async()=>{
  const parent=await flow('edit-book'),child=await flow('edit-edition');
  assert.match(parent.tasks.find(task=>task.id==='select-task').prompt,/workflow=edit-edition/);
  assert.equal(parent.tasks.find(task=>task.id==='select-task').continueOnChildFailure,true);
  const chain=['claim-edit','apply-edit','prepare-edit-package','validate-edit','submit-edit'];
  assert.equal(child.entryTaskId,chain[0]);
  assert.deepEqual(child.edges.map(edge=>[edge.sourceTaskId,edge.targetTaskId]),chain.slice(1).map((id,index)=>[chain[index],id]));
  assert.ok(child.tasks.every(task=>!task.creator));
});

test('all distributed workflow prompts fit RoboTeam native 16000-character admission limit',async()=>{
  const directory=new URL('../../flows/',import.meta.url);
  for(const file of await fs.readdir(directory)) {
    if(!file.endsWith('.json'))continue;
    const graph=JSON.parse(await fs.readFile(new URL(file,directory),'utf8'));
    for(const task of graph.tasks)assert.ok((task.prompt||'').length<=16000,`${file}/${task.id}: ${(task.prompt||'').length} characters would remove the whole workflow from the native catalogue`);
  }
});
