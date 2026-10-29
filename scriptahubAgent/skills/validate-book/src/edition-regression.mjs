import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {openBrowser} from './browser.mjs';
import {navigate, importReaderArticle} from './layout-browser.mjs';
import {inspectLayout, checkDisplay} from './layout-checks.mjs';
import {hash, fileHash, writeJson, verifyInputs, inside} from './storage.mjs';

export const editionText = text => String(text).normalize('NFC').replace(/\s+/gu, ' ').trim();

// Explicit replacements describe approved annotations, never a whole-document rewrite.
export function expectedEditionText(text, changes = []) {
  if (!Array.isArray(changes) || changes.length > 50) throw Error('Provide at most 50 approved text changes');
  text = editionText(text);
  const edits = changes.map(change => {
    if (!change || typeof change.before !== 'string' || typeof change.after !== 'string'
      || !editionText(change.before) || change.before.length > 4000 || change.after.length > 32768) throw Error('Each approved change requires before and after text');
    const before = editionText(change.before), prefix = editionText(change.prefix || ''), suffix = editionText(change.suffix || '');
    const matches = [];
    for (let start = text.indexOf(before); start !== -1; start = text.indexOf(before, start + 1)) {
      const end = start + before.length;
      if ((!prefix || text.slice(0,start).trimEnd().endsWith(prefix)) && (!suffix || text.slice(end).trimStart().startsWith(suffix))) matches.push({start,end});
    }
    if (matches.length !== 1) throw Error('Approved passage is missing or ambiguous; retain its exact quote and context');
    return {...matches[0], after: editionText(change.after)};
  }).sort((a,b) => a.start - b.start);
  for (let i = 1; i < edits.length; i++) if (edits[i].start < edits[i-1].end) throw Error('Approved text changes overlap');
  for (const edit of edits.reverse()) text = text.slice(0,edit.start) + edit.after + text.slice(edit.end);
  return editionText(text);
}

export function newLayoutFindings(baseline, candidate) {
  const available = new Map();
  for (const finding of baseline) {
    const key = JSON.stringify([finding.category,finding.subjects]);
    const values = available.get(key) || []; values.push(finding.extent || 1); available.set(key,values);
  }
  const regressions = [], existing = [];
  for (const finding of candidate) {
    const values = available.get(JSON.stringify([finding.category,finding.subjects])) || [];
    const at = values.findIndex(value => (finding.extent || 1) <= value + .02);
    if (at < 0) regressions.push(finding);
    else { values.splice(at,1); existing.push({...finding,severity:'warning',existing:true}); }
  }
  return {regressions,existing};
}

// Chromium measurements only. Scripts are disabled by openBrowser.
function inspectEditionContent() {
  const root = document.querySelector('[data-reader-content],article,main,.edition-reading') || document.body;
  const clone = root.cloneNode(true); clone.querySelectorAll('script,style,noscript,template').forEach(n=>n.remove());
  // Block/cell boundaries separate words even when the authored HTML has no
  // literal whitespace between tags. Inline formatting must not split words.
  for(const n of clone.querySelectorAll('p,div,section,article,main,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,pre,table,tr,th,td,br')){n.before(document.createTextNode(' '));n.after(document.createTextNode(' '));}
  function clippedArea(node,rect) {
    let left=rect.left,right=rect.right,top=rect.top,bottom=rect.bottom;
    for(let e=node;e;e=e.parentElement){const s=getComputedStyle(e),b=e.getBoundingClientRect();
      if(/hidden|clip/.test(s.overflowX)){left=Math.max(left,b.left-2);right=Math.min(right,b.right+2);}
      if(/hidden|clip/.test(s.overflowY)){top=Math.max(top,b.top-2);bottom=Math.min(bottom,b.bottom+2);}}
    return Math.max(0,rect.width*rect.height-Math.max(0,right-left)*Math.max(0,bottom-top));
  }
  const clips=[...root.querySelectorAll('p,h1,h2,h3,h4,h5,h6,li,blockquote,figcaption,pre,th,td')].map(n=>{
    const range=document.createRange();range.selectNodeContents(n);let area=0,lost=0;
    for(const r of range.getClientRects()){area+=r.width*r.height;lost+=clippedArea(n,r);}
    return {text:n.textContent.trim(),extent:lost/Math.max(1,area)};
  });
  const images = [...root.querySelectorAll('img')].map(n => {
    const box = n.getBoundingClientRect();
    let hidden = !box.width || !box.height;
    for (let e=n;e;e=e.parentElement) { const s=getComputedStyle(e); if(s.display==='none'||s.visibility!=='visible'||Number(s.opacity)===0) hidden=true; }
    return {url:n.currentSrc||n.src,alt:n.alt,hidden,clipped:clippedArea(n,box)/Math.max(1,box.width*box.height),bounds:{left:box.left,right:box.right,top:box.top,bottom:box.bottom}};
  });
  const collisions = [], parts=[], walker = document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  let leaf, comparisons=0;
  while ((leaf=walker.nextNode())) {
    if (!leaf.textContent.trim() || leaf.parentElement.closest('script,style,noscript,template')) continue;
    const range=document.createRange();range.selectNodeContents(leaf);
    const s=getComputedStyle(leaf.parentElement);
    if(s.display==='none'||s.visibility!=='visible')continue;
    for(const rect of range.getClientRects())if(rect.width&&rect.height)parts.push({type:'text',text:leaf.textContent,bounds:{left:rect.left,right:rect.right,top:rect.top,bottom:rect.bottom}});
  }
  parts.push(...images.filter(i=>!i.hidden).map(i=>({type:'image',url:i.url,bounds:i.bounds})));
  parts.sort((a,b)=>a.bounds.top-b.bounds.top);
  for(let i=0;i<parts.length;i++)for(let j=i+1;j<parts.length&&parts[j].bounds.top<parts[i].bounds.bottom-2;j++){
    if(++comparisons>2000000)throw Error('Layout overlap comparison budget exceeded');
    const a=parts[i],b=parts[j],x=Math.min(a.bounds.right,b.bounds.right)-Math.max(a.bounds.left,b.bounds.left),y=Math.min(a.bounds.bottom,b.bounds.bottom)-Math.max(a.bounds.top,b.bounds.top);
    if(x>2&&y>2)collisions.push({a:{type:a.type,text:a.text,url:a.url},b:{type:b.type,text:b.text,url:b.url},extent:x*y/Math.max(1,Math.min((a.bounds.right-a.bounds.left)*(a.bounds.bottom-a.bounds.top),(b.bounds.right-b.bounds.left)*(b.bounds.bottom-b.bounds.top)))});
  }
  return {text:clone.textContent,images,clips,collisions,styles:[...document.querySelectorAll('link[rel~="stylesheet"]')].map(n=>({url:n.href,loaded:!!n.sheet}))};
}

const integrity = new Set(['hidden_content','clipped_content','outside_content','broken_image',
  'overlapping_pages','horizontal_overflow','font_load_failed','broken_anchor','duplicate_id','reader_root_incomplete']);

export async function compareEdition(baselineFile, options = {}) {
  if (!options.candidate) throw Error('An edited HTML candidate is required');
  const root=await fs.realpath(options.root || process.cwd());
  const local = async file => { const real=await fs.realpath(file);if(!inside(root,real))throw Error('Edition input is outside the run directory');return real; };
  const baseline=await local(baselineFile),candidate=await local(options.candidate);
  if(baseline===candidate)throw Error('Baseline and candidate must be separate files');
  const readerSource=options.readerCss || process.env.VALIDATEBOOK_READER_CSS;
  if(!readerSource)throw Error('The deployed ScriptaHub reader stylesheet is required');
  const readerCss=await fs.realpath(readerSource);
  const css=await fs.readFile(readerCss,'utf8'), rem=css.match(/--reader-font-size:\s*([\d.]+)rem/);
  if(!rem)throw Error('The deployed ScriptaHub reader stylesheet is required');
  const changesFile=options.changes?await local(options.changes):null;
  const changes=changesFile?JSON.parse(await fs.readFile(changesFile,'utf8')):[];
  if(!Array.isArray(changes)||changes.length>50||changes.some(c=>!c||typeof c.before!=='string'||typeof c.after!=='string'||!editionText(c.before)||c.before.length>4000||c.after.length>32768))throw Error('Invalid approved text changes');
  const stableText=text=>{let value=editionText(text);for(const change of changes){const after=editionText(change.after);if(after)value=value.split(after).join(editionText(change.before));}return value;};
  const inputs=new Map();
  async function remember(file) { const digest=await fileHash(file);if(inputs.has(file)&&inputs.get(file)!==digest)throw Error('Edition resource changed during validation');inputs.set(file,digest);return digest; }
  await remember(baseline);await remember(candidate);await remember(readerCss);if(changesFile)await remember(changesFile);
  async function resource(url) {
    const parsed=new URL(url);parsed.hash='';if(parsed.protocol==='data:'){const source=parsed.href,comma=source.indexOf(',');if(comma<0)throw Error('Invalid image data URL');return hash(/;base64$/i.test(source.slice(0,comma))?Buffer.from(source.slice(comma+1),'base64'):Buffer.from(decodeURIComponent(source.slice(comma+1))));}
    if(parsed.protocol!=='file:')throw Error('Edition validation requires local resources');
    parsed.hash='';parsed.search='';
    try {const file=await local(fileURLToPath(parsed));return remember(file);}
    catch(error){if(error.code==='ENOENT')return 'missing:'+parsed.href;throw error;}
  }
  const directory=path.resolve(options.jobDir || 'validation/edit-layout');
  if(!inside(root,directory)||[baseline,candidate,readerCss,changesFile].includes(path.join(directory,'report.json')))throw Error('Use a separate report directory inside this run');
  const browser=await openBrowser(options.chromium || process.env.VALIDATEBOOK_CHROMIUM || 'chromium');
  try {
    const measurements=[], findings=[], warnings=[];
    async function capture(file,width,presentation) {
      await browser.send('Emulation.setDeviceMetricsOverride',{width,height:1000,deviceScaleFactor:1,mobile:false});
      await navigate(browser,file);
      const standalone=await browser.evaluate(`(${inspectEditionContent.toString()})()`);
      for(const image of standalone.images) image.digest=await resource(image.url);
      for(const style of standalone.styles) if(style.loaded)await resource(style.url);
      if(presentation==='reader') {
        await browser.evaluate(`(${importReaderArticle.toString()})(${JSON.stringify({readerCss:pathToFileURL(readerCss).href,generic:true,booksRoot:pathToFileURL(root+path.sep).href,defaultRem:Number(rem[1]),managed:true})})`);
        for(let i=0;;i++){
          if(await browser.evaluate('document.fonts.status === "loaded" && [...document.querySelectorAll("link[rel=stylesheet]")].every(n=>n.sheet) && [...document.images].every(n=>n.complete)'))break;
          if(i===199)throw Error('Reader fonts, styles or images did not finish loading');
          await new Promise(resolve=>setTimeout(resolve,50));
        }
      }
      const document=await browser.evaluate(`(${inspectLayout.toString()})()`);
      const content=await browser.evaluate(`(${inspectEditionContent.toString()})()`);
      const records=new Map(document.records.map(r=>[r.selector,r]));
      const imageKeys=new Map();for(const image of content.images)imageKeys.set(image.url,await resource(image.url));
      const subject=selector=>{const r=records.get(selector);return r?hash(r.tag==='img'?(imageKeys.get(new URL(r.src,pathToFileURL(file)).href)||r.src):stableText(r.text)):selector;};
      const display=checkDisplay(document,document.language).filter(f=>integrity.has(f.category)).map(f=>{
        const selectors=f.location.split(' / '),r=records.get(f.location);
        let extent=1;
        if(f.category==='horizontal_overflow')extent=document.scrollWidth/document.width;
        if(f.category==='outside_content'&&r)extent=Math.max(0,-r.bounds.left,r.bounds.right-width)/width;
        if(f.category==='clipped_content'&&r)extent=Math.max(.001,...content.clips.filter(c=>editionText(c.text)===editionText(r.text)).map(c=>c.extent));
        return {category:f.category,subjects:selectors.map(subject).sort(),location:f.location,detail:f.detail,extent};
      });
      for(const image of content.images)if(image.hidden)display.push({category:'hidden_image',subjects:[imageKeys.get(image.url)],detail:'An image is no longer visible',extent:1});
      for(const image of content.images)if(image.clipped>.001)display.push({category:'clipped_image',subjects:[imageKeys.get(image.url)],detail:'An image is clipped by its container',extent:image.clipped});
      for(const collision of content.collisions){const kind=collision.a.type===collision.b.type?(collision.a.type==='text'?'text_overlap':'image_overlap'):'text_image_overlap';display.push({category:kind,subjects:[collision.a,collision.b].map(p=>p.type==='image'?imageKeys.get(p.url):hash(stableText(p.text))).sort(),detail:'Rendered content overlaps',extent:collision.extent});}
      for(const style of content.styles)if(!style.loaded)display.push({category:'missing_stylesheet',subjects:[style.url],detail:'Stylesheet failed to load',extent:1});
      return {findings:display,content:standalone,presentationText:content.text,imageKeys:[...imageKeys.values()]};
    }
    for(const presentation of ['standalone','reader'])for(const width of [1440,1024,390]){
      const before=await capture(baseline,width,presentation),after=await capture(candidate,width,presentation);
      const compared=newLayoutFindings(before.findings,after.findings);
      findings.push(...compared.regressions.map(f=>({...f,width,presentation,severity:'error'})));
      warnings.push(...compared.existing.map(f=>({...f,width,presentation})));
      if(width===1440){const expected=expectedEditionText(before.presentationText,changes),actual=editionText(after.presentationText);if(expected!==actual){let offset=0;while(offset<Math.min(expected.length,actual.length)&&expected[offset]===actual[offset])offset++;findings.push({category:presentation==='standalone'?'unapproved_text_change':'reader_content_change',severity:'error',presentation,detail:'Content changed outside the approved replacements',offset,expected:expected.slice(Math.max(0,offset-80),offset+160),actual:actual.slice(Math.max(0,offset-80),offset+160)});}}
      if(JSON.stringify(before.imageKeys)!==JSON.stringify(after.imageKeys))findings.push({category:'image_content_changed',severity:'error',width,presentation,detail:'An existing image was removed, replaced, duplicated or reordered'});
      measurements.push({width,presentation,baselineFindings:before.findings.length,newFindings:compared.regressions.length});
    }
    await verifyInputs([...inputs].map(([file,sha256])=>({file,sha256})));
    const result={scope:'edition_layout_regression',status:findings.length?'needs_attention':warnings.length?'passed_with_warnings':'passed',autoCorrect:false,
      errorFindings:findings.length,existingFindings:warnings.length,baseline:{file:baseline,sha256:inputs.get(baseline)},candidate:{file:candidate,sha256:inputs.get(candidate)},
      approvedChanges:changes.length,measurements,findings,existing:warnings,inputs:[...inputs].map(([file,sha256])=>({file,sha256})),
      limitations:['Compares local standalone and ScriptaHub imported-reader layout at 1440, 1024 and 390 CSS pixels.','Book scripts and remote requests are disabled. Does not compare with a PDF, audit unmodified translations or correct files.'],job:directory};
    let parent=root;
    for(const part of path.relative(root,directory).split(path.sep).filter(Boolean)){
      parent=path.join(parent,part);try{await fs.mkdir(parent,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
      const stat=await fs.lstat(parent);if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Report directory must not contain symbolic links');
    }
    await writeJson(path.join(directory,'report.json'),result);
    await fs.writeFile(path.join(directory,'report.md'),`# Edited edition layout check\n\nStatus: ${result.status}\nNew errors: ${findings.length}\nExisting findings: ${warnings.length}\n\n`+findings.map(f=>`- ${f.category}: ${f.detail}`).join('\n')+'\n');
    return result;
  } finally {await browser.close();}
}
