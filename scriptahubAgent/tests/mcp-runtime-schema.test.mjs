import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Run in the deployed Ploinky container to check its actual schema compiler,
// rather than assuming that every JSON Schema construct is supported.
const runtime = process.env.PLOINKY_AGENT_RUNTIME_ROOT || '/Agent';
const compiler = path.join(runtime,'server/toolInputSchemaCache.mjs');
const available = await fs.access(compiler).then(() => true, () => false);
test('every MCP tool registers with the actual Ploinky runtime schema compiler', {skip: !available && 'Requires the Ploinky agent runtime'}, async () => {
  const {getConfiguredToolInputSchema} = await import(pathToFileURL(compiler).href);
  const config = JSON.parse(await fs.readFile(new URL('../mcp-config.json',import.meta.url),'utf8'));
  const schemas = new Map(config.tools.map(tool => [tool.name,getConfiguredToolInputSchema(config,tool).schema]));
  assert.ok(schemas.size >= 10);
  for (const name of ['scriptahub_task_package_prepare','scriptahub_task_package_upload','scriptahub_task_publish']) {
    assert.deepEqual(config.tools.find(tool=>tool.name===name).tags,['internal'],`${name} must accept service calls only`);
  }
  assert.deepEqual(config.tools.find(tool=>tool.name==='scriptahub_publication_auth').tags,['admin']);
  assert.equal(schemas.get('scriptahub_config_get').safeParse({}).success,true);
  const settings = {repositories:[],syncIntervalSeconds:60};
  const save = schemas.get('scriptahub_config_set');
  assert.equal(save.safeParse(settings).success,true);
  assert.equal(save.safeParse({...settings,publication:{authorName:'Publisher',authorEmail:'publisher@example.test'}}).success,true);
  assert.equal(save.safeParse({...settings,publication:null}).success,false);
  assert.equal(save.safeParse({...settings,publication:{secretKey:'UNTRUSTED',authorName:'Publisher',authorEmail:'publisher@example.test'}}).success,false);
  assert.equal(save.safeParse({...settings,summaryReadingMinutes:20}).success,false);
  const auth = schemas.get('scriptahub_publication_auth');
  assert.equal(auth.safeParse({action:'connect',authorName:'Name',authorEmail:'name@example.test'}).success,true);
  assert.equal(auth.safeParse({action:'connect',credentialRef:'OLD_REFERENCE'}).success,false);
  assert.equal(config.tools.some(tool => tool.delegations?.some(delegation => /dpuAgent|gitAgent/.test(delegation.targetAgentId))),false);
  assert.equal(auth.safeParse({action:'token',token:'test-only-token'}).success,true);
  const prepare = schemas.get('scriptahub_task_package_prepare');
  const entry = {path:'book.html',sha256:'a'.repeat(64),size:1};
  const input = {executionId:'execution-one',catalogue:'https://github.com/example/books/blob/main/collection.json',branch:'main',files:[entry,{...entry,path:'source.pdf'}],validation:{publicationPermitted:true}};
  assert.equal(prepare.safeParse(input).success,true);
  assert.equal(prepare.safeParse({...input,baseCommit:'b'.repeat(40)}).success,true);
  assert.equal(prepare.safeParse({...input,baseCommit:null}).success,false);
});
