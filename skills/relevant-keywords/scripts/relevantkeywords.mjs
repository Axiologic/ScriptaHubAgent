import {handleBatch} from '../../scriptahub-tasks/shared/batch-io.mjs';
import { parseArgs } from 'node:util';
if (Number(process.versions.node.split('.')[0]) < 22) { console.error('Node.js >=22 is required.'); process.exit(1); }
try {
  const core = await import('../src/core.mjs').catch(e => { throw new Error('Restore the bundled HTML parser; see dependencies.md. ' + e.message); });
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { batch:{type:'string'}, 'batch-sha256':{type:'string'},'replace-sha256':{type:'string'}, count: {type:'string'}, language:{type:'string'}, synonyms:{type:'string'}, 'job-dir':{type:'string'}, help:{type:'boolean'} } });
  const [command, input, ...extra] = positionals;
  if (values.help) { console.log('relevantkeywords doctor | analyze INPUT [--count N] [--language TAG] [--synonyms FILE] [--job-dir DIR] | batch-contract JOB --batch NAME | submit-batch JOB --batch NAME --batch-sha256 SHA [--replace-sha256 SHA] < analysis.json | status JOB | build JOB'); process.exit(0); }
  if (extra.length || (command !== 'doctor' && !input)) throw new Error('Invalid arguments; use --help.');
  let result;
  if (command === 'doctor') result = { ok:true, node:process.versions.node, analysisModel:'provided by the active LLM session' };
  else if (command === 'analyze') result = await core.analyze(input, {count:values.count === undefined ? 20 : Number(values.count),language:values.language,synonyms:values.synonyms,jobDir:values['job-dir']});
  else if (['batch-contract','submit-batch'].includes(command)) result = await handleBatch(command,input,values,'relevant-keywords',await import('../src/batch-schema.mjs'));
  else if (command === 'status') result = await core.status(input);
  else if (command === 'build') result = await core.build(input);
  else throw new Error('Unknown command; use --help.');
  console.log(JSON.stringify(result,null,2));
  if(result.status==='rejected')process.exitCode=1;
} catch(e) { console.error('relevantkeywords: ' + e.message); process.exitCode=1; }
