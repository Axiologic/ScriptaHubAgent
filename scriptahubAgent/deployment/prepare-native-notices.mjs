import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

export async function prepareNativeNotices(root) {
  const config=JSON.parse(await fs.readFile(path.join(root,'skills-runtime.json'),'utf8'));
  const notices=JSON.parse(await fs.readFile(path.join(root,'native-notices.json'),'utf8'));
  for(const notice of notices) {
    const destination=path.join(root,'skills/pdf2html/external/native',notice.path);
    const valid=bytes=>bytes.length===notice.bytes&&createHash('sha256').update(bytes).digest('hex')===notice.sha256;
    try {if(valid(await fs.readFile(destination)))continue;}catch(error){if(error.code!=='ENOENT')throw error;}
    const source=config.nativeAssetSource;
    const response=await fetch(`${source.repository}${source.revision}/${source.path}${notice.path}`,{signal:AbortSignal.timeout(60000)});
    if(!response.ok)throw new Error(`Native notice download failed (${response.status}): ${notice.path}`);
    const bytes=Buffer.from(await response.arrayBuffer());if(!valid(bytes))throw new Error(`Native notice checksum mismatch: ${notice.path}`);
    await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes,{mode:0o644});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await prepareNativeNotices(path.resolve(process.argv[2]));
