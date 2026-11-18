// Deterministic release gate. No AI calls, production services or external Git writes.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createWriteStream} from 'node:fs';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`);
  args.splice(index, 2);
  return value;
}
const box = option('--box', null);
const suite = option('--suite', 'all');
const repeat = Number(option('--repeat', '1'));
const output = option('--output', null);
if (args.length || !['core','runtime','all'].includes(suite) || !Number.isInteger(repeat) || repeat < 1 || repeat > 20) {
  throw new Error('Usage: node tools/test-release.mjs [--suite core|runtime|all] [--repeat 1..20] [--output DIRECTORY] [--box BOX_NAME]');
}
if (box) {
  // Same absolute workspace path is mounted inside the local Ploinky Box.
  const child = spawn('podman', ['exec', '-w', root, box, 'node', 'tools/test-release.mjs', '--suite', suite,
    '--repeat', String(repeat), ...(output ? ['--output', output] : [])], {stdio:'inherit'});
  child.once('error', error => {console.error(error.message); process.exitCode=1;});
  child.once('exit', (code, signal) => {process.exitCode=signal ? 1 : code ?? 1;});
} else {
  if (suite !== 'core' && process.platform !== 'linux') {
    throw new Error('Runtime tests require Linux (/proc and flock). Use --box BOX_NAME, or --suite core for the portable checks.');
  }
  const report = output ? path.resolve(output) : await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-release-'));
  await fs.mkdir(report, {recursive:true});
  // Processing admission checks real free space (5 GiB), even for tiny test jobs.
  // A Box's /tmp may be a 4 GiB tmpfs. Use a real temporary filesystem instead.
  let temporary;
  for(const directory of [...new Set([os.tmpdir(),...(process.platform==='linux'?['/var/tmp']:[])])]) {
    try {
      const stat=await fs.statfs(directory);
      if(stat.bavail*stat.bsize < 6*1024**3)continue;
      temporary=await fs.mkdtemp(path.join(directory,'scripta-test-work-'));break;
    } catch {}
  }
  if(!temporary)throw new Error('Tests require a writable temporary filesystem with at least 6 GiB available. Set TMPDIR to a suitable directory.');
  const groups = [];
  for (const [name, directory] of [['core','scriptahubAgent/tests'], ['runtime','skills/scriptahub-tasks/tests']]) {
    if (suite !== 'all' && suite !== name) continue;
    const files = (await fs.readdir(path.join(root,directory))).filter(file => file.endsWith('.test.mjs')).sort().map(file => `${directory}/${file}`);
    groups.push({name, files});
  }
  const manifest = {startedAt:new Date().toISOString(), node:process.version, platform:process.platform, suite, repeat, groups:[], runs:[]};
  for (const group of groups) manifest.groups.push({name:group.name, files:await Promise.all(group.files.map(async file => ({file,
    sha256:createHash('sha256').update(await fs.readFile(path.join(root,file))).digest('hex')})))});
  console.log(`Reports: ${report}`);
  for (let iteration=1; iteration<=repeat; iteration++) for (const group of groups) {
    const prefix = `${group.name}-${iteration}`, started = Date.now();
    console.log(`Running ${prefix} (${group.files.length} files)`);
    const queue = [...group.files], results = [];
    await Promise.all(Array.from({length:Math.min(4,queue.length)}, async () => {
      while (queue.length) {
        const file=queue.shift(), name=`${prefix}-${path.basename(file,'.mjs')}`;
        const began=Date.now(), log=createWriteStream(path.join(report,name+'.log'));
        const result=await new Promise(resolve => {
          let timedOut=false, killTimer;
          const child=spawn(process.execPath,['--test','--test-timeout=55000',
            '--test-reporter=spec','--test-reporter-destination=stdout','--test-reporter=junit',
            `--test-reporter-destination=${path.join(report,name+'.xml')}`,file],
          {cwd:root,env:{...process.env,TMPDIR:temporary,TMP:temporary,TEMP:temporary},detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
          child.stdout.pipe(log,{end:false});child.stderr.pipe(log,{end:false});
          function kill(signal) {try {if(process.platform==='win32')child.kill(signal);else process.kill(-child.pid,signal);}catch{}}
          const timer=setTimeout(()=>{timedOut=true;kill('SIGTERM');killTimer=setTimeout(()=>kill('SIGKILL'),2000);},60_000);
          child.once('error',error=>{clearTimeout(timer);resolve({code:1,error:error.message});});
          child.once('close',(code,signal)=>{clearTimeout(timer);clearTimeout(killTimer);resolve({code:code??1,signal,timedOut});});
        });
        await new Promise(resolve=>log.end(resolve));
        results.push({file,durationMs:Date.now()-began,...result});
        console.log(`${result.code===0?'PASS':'FAIL'} ${file}${result.timedOut?' (deadline exceeded)':''}`);
        if(result.code!==0) console.error((await fs.readFile(path.join(report,name+'.log'),'utf8')).slice(-5000));
      }
    }));
    manifest.runs.push({group:group.name, iteration, durationMs:Date.now()-started,
      code:results.every(result=>result.code===0)?0:1, files:results.sort((a,b)=>a.file.localeCompare(b.file))});
    await fs.writeFile(path.join(report,'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
  }
  manifest.finishedAt = new Date().toISOString();
  manifest.passed = manifest.runs.every(run => run.code === 0);
  await fs.writeFile(path.join(report,'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
  await fs.rm(temporary,{recursive:true,force:true});
  console.log(`${manifest.passed ? 'PASS' : 'FAIL'}: ${report}`);
  process.exitCode = manifest.passed ? 0 : 1;
}
