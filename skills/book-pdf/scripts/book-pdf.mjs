import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {parseArgs} from 'node:util';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {openBrowser} from '../../validate-book/src/browser.mjs';
import {navigate} from '../../validate-book/src/layout-browser.mjs';
import {renderModeration} from './moderation-render.mjs';
import {hasReaderWords, readerWords} from './pdf-text.mjs';

const rights = {
  en:'Rights belong to their respective holders',
  ro:'Drepturile aparțin titularilor lor',
  de:'Die Rechte liegen bei den jeweiligen Rechteinhabern',
  es:'Los derechos pertenecen a sus respectivos titulares',
  fr:'Les droits appartiennent à leurs titulaires respectifs',
  it:'I diritti appartengono ai rispettivi titolari',
  pl:'Prawa należą do ich właścicieli',
  pt:'Os direitos pertencem aos respetivos titulares',
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const execute = promisify(execFile);

async function makeOutputDirectory(root, target) {
  let directory = root;
  for (const part of path.relative(root,target).split(path.sep).slice(0,-1)) {
    directory = path.join(directory,part);
    await fs.mkdir(directory).catch(error => { if (error.code !== 'EEXIST') throw error; });
    if (!(await fs.lstat(directory)).isDirectory()) throw Error('PDF output parent must be a real directory');
  }
}

async function verifyPdfText(file, expected, footer) {
  let foundFooter = false;
  for (const format of [[],['-raw']]) {
    const {stdout} = await execute(process.env.VALIDATEBOOK_PDFTOTEXT || 'pdftotext',
      ['-enc','UTF-8',...format,file,'-'], {timeout:60000,maxBuffer:32*1024*1024});
    const lines = stdout.split(/\r?\n|\f/);
    const notice = footer.normalize('NFKC');
    let containsFooter = false;
    const text = lines.filter(line => {
      if (line.trim().replace(/\s+/g,' ').normalize('NFKC') !== notice) return true;
      containsFooter = true;
      return false;
    }).join('\n');
    foundFooter ||= containsFooter;
    if (containsFooter && hasReaderWords(expected,text)) return;
  }
  if (!foundFooter) throw Error('The PDF is missing its rights notice');
  throw Error('The PDF is missing text from the full reader');
}

// Keep the original hyphen glyph and prevent short compounds from breaking at it.
// This changes only Chromium's temporary DOM and never the source document.
function protectHyphenatedWords() {
  const root = document.querySelector('[data-reader-content]') ?? document.querySelector('main') ?? document.body;
  const walker = document.createTreeWalker(root,NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    if (node.parentElement.closest('script, style, textarea, svg')) continue;
    const compounds = [...node.data.matchAll(/[\p{L}\p{M}\p{N}]+(?:[-‐‑][\p{L}\p{M}\p{N}]+)+/gu)]
      .filter(match => match[0].length <= 60);
    if (!compounds.length) continue;
    const fragment = document.createDocumentFragment();
    let offset = 0;
    for (const match of compounds) {
      fragment.append(node.data.slice(offset,match.index));
      const span = document.createElement('span');
      span.style.setProperty('display','inline','important');
      span.style.setProperty('white-space','nowrap','important');
      span.textContent = match[0];
      fragment.append(span);
      offset = match.index + match[0].length;
    }
    fragment.append(node.data.slice(offset));
    node.replaceWith(fragment);
  }
}
async function exportPdf(input, output, language) {
  const root = await fs.realpath(process.cwd());
  const source = await fs.realpath(input);
  const target = path.resolve(root,output);
  if (!source.startsWith(root + path.sep) || !target.startsWith(root + path.sep)
      || !/\.html?$/i.test(source) || !/\.pdf$/i.test(target)) {
    throw Error('Use separate HTML input and PDF output paths inside the current run');
  }
  const locale = new Intl.Locale(language).language;
  const sourceHash = digest(await fs.readFile(source));
  await makeOutputDirectory(root,target);
  const temporary = target + '.' + randomUUID() + '.tmp';
  const browser = await openBrowser(process.env.VALIDATEBOOK_CHROMIUM || 'chromium-browser');
  try {
    await browser.send('Emulation.setEmulatedMedia', {media:'screen'});
    await navigate(browser, source);
    const reader = await browser.evaluate(`(() => {
      const root = document.querySelector('[data-reader-content]') ?? document.querySelector('main') ?? document.body;
      return {text:root.innerText, brokenImages:[...root.querySelectorAll('img')].filter(image =>
        (image.currentSrc || image.getAttribute('src') || image.getAttribute('srcset') || image.closest('picture')) &&
        !image.naturalWidth).length};
    })()`);
    const expected = readerWords(reader.text);
    if (!expected.length) throw Error('The full reader has no printable text');
    if (reader.brokenImages) throw Error('The full reader contains images that could not be loaded for the PDF');
    await browser.evaluate(`(${protectHyphenatedWords.toString()})()`);
    await browser.evaluate(`(() => {
      const style = document.createElement('style');
      style.textContent = '@page { margin: 16mm 16mm 19mm !important; } * { hyphens: none !important; }';
      document.head.append(style);
    })()`);
    await browser.evaluate('document.fonts.ready.then(() => true)');
    const footerText = 'ScriptaHub · © ' + (rights[locale] ?? rights.en);
    const footer = '<div style="width:100%;text-align:center;font:8pt sans-serif;color:#555">' +
      footerText + '</div>';
    const {stream} = await browser.send('Page.printToPDF', {
      displayHeaderFooter:true, headerTemplate:'<span></span>', footerTemplate:footer, printBackground:true,
      paperWidth:210 / 25.4, paperHeight:297 / 25.4, marginTop:16 / 25.4, marginBottom:19 / 25.4,
      marginLeft:16 / 25.4, marginRight:16 / 25.4, transferMode:'ReturnAsStream',
    },120000);
    const file = await fs.open(temporary, 'wx');
    const hash = createHash('sha256');
    let total = 0;
    try {
      for (;;) {
        const chunk = await browser.send('IO.read', {handle:stream,size:262144});
        const bytes = Buffer.from(chunk.data, chunk.base64Encoded ? 'base64' : 'utf8');
        if (!total && bytes.subarray(0,5).toString() !== '%PDF-') throw Error('Chromium returned an invalid PDF');
        total += bytes.length;
        if (total > 50000000) throw Error('PDF exceeds the publication file size limit');
        hash.update(bytes);
        await file.writeFile(bytes);
        if (chunk.eof) break;
      }
    } finally { await file.close(); }
    await browser.send('IO.close', {handle:stream});
    await verifyPdfText(temporary,expected,footerText);
    if (digest(await fs.readFile(source)) !== sourceHash) throw Error('HTML changed during PDF export');
    await fs.rename(temporary,target);
    return {status:'exported',sourceSha256:sourceHash,sha256:hash.digest('hex'),size:total};
  } finally {
    await browser.close();
    await fs.rm(temporary,{force:true});
  }
}

try {
  const {positionals:[command,input,...extra],values} = parseArgs({allowPositionals:true,options:{
    output:{type:'string'},language:{type:'string'}
  }});
  if (command === 'moderation-render' && input && !extra.length && values.output) {
    try {
      await renderModeration(input,values.output);
    } catch (error) {
      console.error('Moderation rendering: ' + error.message);
      process.exitCode = /unavailable|ENOENT|timed out/i.test(error.message) ? 1 : 42;
    }
  } else {
    if (command !== 'export' || !input || extra.length || !values.output || !values.language) {
      throw Error('Usage: book-pdf export INPUT.html --output FILE.pdf --language TAG');
    }
    console.log(JSON.stringify(await exportPdf(input,values.output,values.language)));
  }
} catch (error) {
  console.error('book-pdf: ' + error.message);
  process.exitCode = 1;
}
