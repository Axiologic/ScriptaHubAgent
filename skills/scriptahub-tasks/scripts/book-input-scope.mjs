import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {withParent,at,openDir} from './anchored-files.mjs';

const beneath=(name,root)=>name===root||name.startsWith(root+'/');
const asset=/\.(?:css|woff2?|ttf|otf|eot|png|jpe?g|gif|webp|avif|svg|ico|bmp|mp3|mp4|ogg|wav|webm)$/i;
async function read(root,name) {
  return withParent(root,name,async file=>{
    const handle=await fs.open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try {const stat=await handle.stat();if(!stat.isFile()||stat.nlink!==1||stat.size>32*1024*1024)throw Error('Unsafe book scope metadata: '+name);return await handle.readFile('utf8');}
    finally {await handle.close();}
  });
}
function relativeArgument(arg,prefix,absolute) {
  const value=arg.startsWith('--')&&arg.includes('=')?arg.slice(arg.indexOf('=')+1):arg;
  if(value===prefix||value===absolute)return '';
  const relative=value.startsWith(prefix+'/')?value.slice(prefix.length+1):value.startsWith(absolute+'/')?value.slice(absolute.length+1):null;
  if(relative!==null&&(relative.includes('\\')||relative.includes('\0')||relative.split('/').some(part=>!part||part==='.'||part==='..')))throw Error('Invalid skill input path');
  return relative;
}
// Only the explicitly addressed book can cross a package/repository boundary.
// Catalogue entries for other books are publication metadata, never skill inputs.
export async function bookInputScope(root,{args,taskDirectory,virtualCwd,bookId,bookRootHint=null}) {
  if(args.some(arg=>relativeArgument(arg,taskDirectory,virtualCwd+'/'+taskDirectory)===''))throw Error('Skill inputs must address the current book, not the entire task directory');
  const packageArguments=args.map(arg=>relativeArgument(arg,taskDirectory,virtualCwd+'/'+taskDirectory)).filter(name=>name!==null&&(name==='package'||name.startsWith('package/')));
  let bookRoot=bookRootHint;
  if(bookRoot&&(!bookRoot.startsWith('package/')||bookRoot.split('/').some(part=>!part||part==='.'||part==='..')))throw Error('Invalid saved book input scope');
  for(const name of packageArguments) {
    const parts=name.split('/'),books=parts.indexOf('books');
    if(books<1||books+1>=parts.length) {
      if(name==='package'||name.endsWith('/books'))throw Error('Skill inputs must name the current book, not the package or books collection');
      continue;
    }
    const identity=bookId?parts.indexOf(bookId,books+1):-1;
    const candidate=parts.slice(0,identity>=0?identity+1:books+2).join('/');
    if(bookRoot&&candidate!==bookRoot)throw Error('One skill command cannot address multiple package books');
    bookRoot=candidate;
    for(const metadata of ['book.json','manifest.json']) {
      try {
        const value=JSON.parse(await read(root,candidate+'/'+metadata));
        if(!bookId || (value.id||value.bookId)!==bookId)throw Error('Package book metadata does not match the claimed book');
      } catch(error){if(error.code!=='ENOENT')throw error;}
    }
  }
  const assets=new Set(),visited=new Set();
  const allows=name=>!name.startsWith('package/')&&name!=='package'||!!bookRoot&&beneath(name,bookRoot)||assets.has(name);
  const traverse=name=>allows(name)||!!bookRoot&&bookRoot.startsWith(name+'/')||[...assets].some(file=>file.startsWith(name+'/'));
  async function resource(ref,document) {
    ref=ref.trim().replace(/&amp;/g,'&');
    if(!ref||ref.startsWith('#')||/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(ref))return;
    let decoded;try{decoded=decodeURIComponent(ref.split(/[?#]/)[0]);}catch{throw Error('Invalid local book resource');}
    if(!decoded)return;
    const name=path.posix.normalize(path.posix.join(path.posix.dirname(document),decoded));
    if(name.startsWith('../')||name.startsWith('/')||name==='..')throw Error('Book resource leaves the task');
    if(!asset.test(name))return;
    if(name.startsWith('package/')) {
      const parts=name.split('/');
      if(parts.includes('books')&&!beneath(name,bookRoot))throw Error('Book asset points at another package book: '+name);
      assets.add(name);
      if(/\.(?:css|svg)$/i.test(name))await inspect(name);
    }
  }
  async function inspect(name) {
    if(visited.has(name))return;visited.add(name);
    const text=await read(root,name);
    for(const match of text.matchAll(/\b(?:src|poster|data)\s*=\s*["']([^"']+)["']/gi))await resource(match[1],name);
    for(const match of text.matchAll(/<(?:link|image|use)\b[^>]*\bhref\s*=\s*["']([^"']+)["']/gi))await resource(match[1],name);
    for(const match of text.matchAll(/\b(?:srcset)\s*=\s*["']([^"']+)["']/gi))for(const value of match[1].split(','))await resource(value.trim().split(/\s+/)[0],name);
    for(const match of text.matchAll(/url\(\s*(?:"([^"]+)"|'([^']+)'|([^'"\s)]+))\s*\)|@import\s+["']([^"']+)["']/gi))await resource(match[1]||match[2]||match[3]||match[4],name);
  }
  async function walk(directory,relative) {
    for(const item of await fs.readdir(at(directory,'.'),{withFileTypes:true})) {
      if(item.name.startsWith('.'))continue;
      const name=relative+'/'+item.name;
      if(item.isDirectory()){const child=await openDir(directory,item.name);try{await walk(child,name);}finally{await child.close();}}
      else if(/\.(?:html?|xhtml|css|svg)$/i.test(item.name))await inspect(name);
    }
  }
  if(bookRoot){const directory=await openDir(root,bookRoot);try{await walk(directory,bookRoot);}finally{await directory.close();}}
  for(const name of packageArguments)if(!allows(name))throw Error('Skill argument is outside the current book and its referenced resources: '+name);
  return {bookRoot,allows,traverse,assets:[...assets]};
}
