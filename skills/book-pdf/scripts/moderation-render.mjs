import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {openBrowser} from '../../validate-book/src/browser.mjs';
import {navigate} from '../../validate-book/src/layout-browser.mjs';

const execute = promisify(execFile);
const maxPages = 500;
async function renderPdf(input, output, units) {
  const {stdout} = await execute('pdfinfo',[input],{timeout:12000});
  const pages = Number(/^Pages:\s+(\d+)/m.exec(stdout)?.[1]);
  if (!pages || pages > maxPages) throw Error('Unsupported PDF page count');
  for (let page=1;page<=pages;page++) {
    const range = ['-f',String(page),'-l',String(page)];
    const image = 'page-' + page;
    await execute('pdftoppm',[...range,'-singlefile','-scale-to','1700','-png',input,path.join(output,image)],{timeout:15000});
    const {stdout:text} = await execute('pdftotext',[...range,input,'-'],{timeout:12000,maxBuffer:1024*1024});
    units.push({image:image+'.png',text});
  }
}

async function renderVisual(input, output, units) {
  const html = /\.x?html?$/i.test(input);
  const browser = await openBrowser(process.env.VALIDATEBOOK_CHROMIUM || 'chromium-browser');
  try {
    await browser.send('Emulation.setDeviceMetricsOverride',{width:1200,height:1000,deviceScaleFactor:1,mobile:false});
    await navigate(browser,input);
    const info = await browser.evaluate(`(() => {
      const root = document.documentElement;
      return {width:root.scrollWidth,height:root.scrollHeight,text:document.body?.innerText || root.textContent || '',
        missing:[...document.images].some(img=>!img.naturalWidth)};
    })()`);
    if (info.missing || !info.width || !info.height) throw Error('Unrenderable image');
    const height = Math.ceil(info.height/900), width = Math.ceil(info.width/1100);
    if (height*width > maxPages) throw Error('Too many visual tiles');
    for(let y=0;y<info.height;y+=900) for(let x=0;x<info.width;x+=1100) {
      const image = 'tile-' + units.length + '.png';
      const {data} = await browser.send('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,
        clip:{x,y,width:Math.min(1200,info.width-x),height:Math.min(1000,info.height-y),scale:1}});
      await fs.writeFile(path.join(output,image),Buffer.from(data,'base64'));
      units.push({image,text:''});
    }
    if (html || /\.svg$/i.test(input)) {
      for(let position=0;position<info.text.length;position+=7500) {
        units.push({image:units[0].image,text:info.text.slice(position,position+8000)});
      }
    }
  } finally { await browser.close(); }
}

export async function renderModeration(input, output) {
  const root = await fs.realpath(process.cwd());
  input = await fs.realpath(input);
  output = path.resolve(output);
  if (!input.startsWith(root+'/tasks/') || !output.startsWith(root+'/tasks/')
    || path.relative(root,input).split(path.sep)[1] !== path.relative(root,output).split(path.sep)[1]) {
    throw Error('Moderation input and output must belong to the same task');
  }
  await fs.mkdir(output);
  const units = [];
  if (/\.docx?$/i.test(input)) {
    const pdf = path.join(output,'document.pdf');
    await execute(process.execPath,[fileURLToPath(new URL('../../doc2pdf/scripts/doc2pdf.mjs',import.meta.url)),
      'convert',input,'--output',pdf],{timeout:90000,maxBuffer:65536});
    input = pdf;
  }
  if (/\.pdf$/i.test(input)) await renderPdf(input,output,units);
  else if (/\.(?:html?|xhtml|svg|png|jpe?g|webp|bmp|ico)$/i.test(input)) {
    if (/\.(?:png|webp|svg)$/i.test(input)) {
      const bytes = await fs.readFile(input);
      if (/\.png$/i.test(input) && bytes.includes('acTL') || /\.webp$/i.test(input) && bytes.includes('ANIM')
        || /\.svg$/i.test(input) && /<(?:[\w-]+:)?(?:animate\w*|set)\b|@keyframes/i.test(bytes.toString('utf8'))) {
        throw Error('Animated artwork requires a frame-by-frame review');
      }
    }
    await renderVisual(input,output,units);
  }
  else throw Error('Unsupported moderation format');
  await fs.writeFile(path.join(output,'units.json'),JSON.stringify(units));
}
