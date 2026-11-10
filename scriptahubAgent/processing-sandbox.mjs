import path from 'node:path';

const commands = Object.freeze({
  'comprehensive-summary':['doctor','prepare','status','build','validate'],
  doc2pdf:['doctor','convert','validate'], html2doc:['doctor','convert','validate'],
  'humanise-html':['doctor','prepare','status','build','validate','repair'],
  'marketing-summary':['doctor','prepare','status','build','validate'],
  pdf2html:['doctor','convert','check','decorations','fonts'], 'relevant-keywords':['doctor','analyze','status','build'],
  'short-description':['doctor','prepare','status','build','validate'],
  'translate-html':['doctor','prepare','status','build','validate','repair'],
  'validate-book':['doctor','prepare','status','report','complete','complete-plan','complete-status','compare-edition'],
  'theatrical-audio':['providers','plan','validate','say','draft','render','verify','preview','voices','doctor'],
  'shf-presentation-creator':['install-player','analyze','compile','validate','voice-tasks','attach-voice','catalog','music','captions'],
});
const fail = message => { throw Object.assign(new Error(message),{status:400}); };
const fixedRoots = ['/usr','/bin','/sbin','/lib','/lib64','/opt','/proc','/dev','/tmp','/etc','/run','/var'];

export function validateVirtualCwd(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value === '/' || value.length > 1024
    || /[\0\r\n\\]/.test(value) || path.posix.normalize(value) !== value
    || value.split('/').slice(1).some(part => !part || part === '.' || part === '..')
    || fixedRoots.some(root => value === root || value.startsWith(root+'/') || root.startsWith(value+'/'))) fail('Invalid virtual working directory');
  return value;
}

export function validateSkillCommand(skill,args,input) {
  if (!Object.hasOwn(commands,skill) || !Array.isArray(args) || args.length > 256
    || args.some(value => typeof value !== 'string' || value.includes('\0'))
    || Buffer.byteLength(JSON.stringify(args)) > 60000 || typeof input !== 'string' || Buffer.byteLength(input) > 65536
    || !commands[skill].includes(args[0])) fail('Invalid skill command');
  const options = args.filter(arg=>arg.startsWith('--')).map(arg=>arg.split('=')[0]);
  if (skill === 'validate-book' && options.some(option => ['--chromium','--pdftotext','--pdffonts','--pdfimages','--pdftohtml','--pdf2html'].includes(option))) fail('Executable overrides are not supported');
  if (skill === 'theatrical-audio') {
    if (options.some(option => ['--python','--config','--credentials-file','--workspace-root','--settings'].includes(option))) fail('Audio runtime or credential overrides are not supported');
    const index=args.findIndex(arg=>arg==='--engine' || arg.startsWith('--engine='));
    if (index !== -1) {
      const engine=args[index].includes('=') ? args[index].slice('--engine='.length) : args[index+1];
      if (!['piper','kokoro','qwen','test-tone'].includes(engine)) fail('Cloud audio engines are not supported');
    }
  }
}

// jobDirectory is service-generated and never derived from virtualCwd.
export function sandboxCommand({virtualCwd,taskId,jobDirectory,skill,args,input}) {
  validateVirtualCwd(virtualCwd); validateSkillCommand(skill,args,input);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(taskId || '') || !path.isAbsolute(jobDirectory)) fail('Invalid processing task');
  const parents=[]; let current='';
  for (const part of virtualCwd.slice(1).split('/')) { current += '/'+part; parents.push('--dir',current); }
  const destination=virtualCwd+'/tasks/'+taskId;
  const effectiveArgs=skill==='theatrical-audio' && ['say','render'].includes(args[0])
    && !args.some(arg=>arg==='--cache'||arg.startsWith('--cache=')) ? [...args,'--cache','/tmp/cache/speech'] : args;
  const bwrap=['--die-with-parent','--new-session','--unshare-all','--cap-drop','ALL','--clearenv',
    '--ro-bind','/usr','/usr','--symlink','usr/bin','/bin','--symlink','usr/sbin','/sbin',
    '--symlink','usr/lib','/lib','--symlink','usr/lib64','/lib64',
    '--dir','/opt','--dir','/opt/scriptahub','--ro-bind','/opt/scriptahub/runtime','/opt/scriptahub/runtime',
    '--dir','/etc','--ro-bind','/etc/fonts','/etc/fonts','--ro-bind','/etc/chromium.d','/etc/chromium.d','--ro-bind','/etc/libreoffice','/etc/libreoffice',
    '--proc','/proc','--dev','/dev','--size','67108864','--tmpfs','/dev/shm',
    '--size','1073741824','--tmpfs','/tmp','--dir','/tmp/home','--dir','/tmp/cache',
    ...parents,'--dir',virtualCwd+'/tasks','--bind',jobDirectory,destination,'--remount-ro','/dev','--remount-ro','/proc','--remount-ro','/','--chdir',virtualCwd,
    '--setenv','PATH','/usr/local/bin:/usr/bin:/bin','--setenv','HOME','/tmp/home',
    '--setenv','TMPDIR','/tmp','--setenv','XDG_CACHE_HOME','/tmp/cache',
    '--setenv','HF_HUB_OFFLINE','1','--setenv','TRANSFORMERS_OFFLINE','1',
    '--setenv','AUDIO_ENGINE','piper',
    '--','/usr/local/bin/node','/opt/scriptahub/runtime/run-skill.mjs',skill,...effectiveArgs];
  return {command:'/usr/bin/python3',args:[path.join(import.meta.dirname,'deployment/processing-launch.py'),String(process.pid),...bwrap],input};
}
