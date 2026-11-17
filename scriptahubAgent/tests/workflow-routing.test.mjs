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
  const required=['resume-book','prepare-manuscript','process-content','review-correct','validate-final','publish-result','book-result'];
  for(const path of paths)assert.deepEqual(path.filter(id=>id!=='translate-resources'),required);
  const translated=paths.find(path=>path.includes('translate-resources'));
  assert.ok(translated.indexOf('process-content')<translated.indexOf('translate-resources'));
  assert.ok(translated.indexOf('translate-resources')<translated.indexOf('review-correct'));
  assert.deepEqual(graph.edges.filter(edge=>edge.targetTaskId==='publish-result').map(edge=>edge.sourceTaskId),['validate-final']);
  const editorial=nodes.get('process-content'),translation=nodes.get('translate-resources');
  assert.ok(!editorial.skillsets.includes('ScriptaHubAgent/translate-html'),'only the separate translation step may run the translator');
  assert.ok(translation.skillsets.includes('ScriptaHubAgent/translate-html'));
});

test('only the parent traverses requests and explicitly isolates failed book subflows',async()=>{
  const parent=await flow('add-books'), child=await flow('create-book');
  assert.equal(parent.tasks.find(task=>task.id==='select-task').continueOnChildFailure,true);
  assert.ok(parent.edges.some(edge=>edge.sourceTaskId==='reconcile-task'&&edge.targetTaskId==='select-task'));
  assert.ok(!child.tasks.some(task=>task.creator||task.kind==='run-workflows'));
  assert.ok(!child.edges.some(edge=>edge.targetTaskId==='select-task'));
});
