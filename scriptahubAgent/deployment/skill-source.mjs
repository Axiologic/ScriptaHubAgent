import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

const excluded=new Set(['node_modules','.cache','.venv','__pycache__','.pytest_cache','target','output','cache','.theatrical-audio','hf-cache','.DS_Store','.idea','.git','.apikeys','audio.config.json']);
export async function skillSource(root) {
  const result={};
  async function visit(relative='') {
    for(const entry of await fs.readdir(path.join(root,relative),{withFileTypes:true})) {
      const name=path.posix.join(relative,entry.name);
      if((entry.name==='.env'||entry.name.startsWith('.env.')&&entry.name!=='.env.example')||excluded.has(entry.name)||entry.name.endsWith('.pyc')||entry.name.endsWith('.actual.html')
        ||/\/external\/(?:browser|tools)(?:\/|$)/.test('/'+name)
        ||/\/external\/docling-source(?:\/|$)/.test('/'+name)
        ||/\/external\/native\/licenses(?:\/|$)/.test('/'+name)
        ||/\/external\/native\/(?:models|linux-[^/]+|darwin-[^/]+|win32-[^/]+)(?:\/|$)/.test('/'+name)
        ||name.endsWith('.zip')||/theatrical-audio\/(?:models|runtime\/(?:qwen|kokoro|piper))(?:\/|$)/.test(name)
        ||/theatrical-audio\/runtime\/(?:qwen|kokoro|piper)(?:\.resolved\.txt|\.json)$/.test(name))continue;
      if(entry.isSymbolicLink())throw new Error(`Skill source must not contain symlinks: ${name}`);
      if(entry.isDirectory())await visit(name);
      else if(entry.isFile())result[name]=createHash('sha256').update(await fs.readFile(path.join(root,name))).digest('hex');
      else throw new Error(`Unsupported skill source entry: ${name}`);
    }
  }
  await visit();return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a<b?-1:a>b?1:0));
}
