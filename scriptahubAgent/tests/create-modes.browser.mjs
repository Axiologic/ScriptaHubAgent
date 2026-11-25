import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createSiteServer} from '../server.mjs';

const {chromium}=await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright-core');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-create-browser-'));
const site=fileURLToPath(new URL('../site',import.meta.url));
process.env.SCRIPTA_RECORD_KEY='create-modes-test-0123456789abcdef01234567';
const server=createSiteServer(site,{dataDir:root,manageApprovals:true,
  verifyUser:async()=>({id:'user:author',email:'author@example.test'})});
let browser;
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/base-agent-additional-server/scriptahubAgent/3002/`;
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1200,height:900}});
  page.setDefaultTimeout(10000);
  await page.route(/\/collection\.js(?:\?|$)/,route=>route.fulfill({
    contentType:'text/javascript',
    body:'globalThis.SCRIPTA_COLLECTION = {books: [], keywords: {}, supportedLanguages: [{code:"en",name:"English"},{code:"ro",name:"Română"}]};'
  }));
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  const open=()=>page.goto(base+'create/index.html?lang=ro',{waitUntil:'domcontentloaded'});
  const ready=await open();
  assert.equal(ready.status(),200,await page.locator('body').innerText());
  await page.waitForLoadState('load');
  const manuscript=page.locator('#create-manuscript');
  const prompt=page.locator('#create-book-proposal');
  const openManuscript=()=>page.locator('[data-method="manuscript"]').click();
  const openPrompt=()=>page.locator('[data-method="book-proposal"]').click();
  async function assertPageAlignment(section, stacked) {
    const [hero, methods, form, firstCard, secondCard]=await Promise.all([
      page.locator('.workflow-hero').boundingBox(),
      page.locator('.create-methods').boundingBox(),
      section.locator('.workflow-form').boundingBox(),
      page.locator('[data-method="manuscript"]').boundingBox(),
      page.locator('[data-method="book-proposal"]').boundingBox(),
    ]);
    const aligned=(first,second)=>assert.ok(Math.abs(first-second)<1);
    aligned(hero.x,form.x);
    aligned(methods.x,form.x);
    aligned(methods.width,form.width);
    aligned(methods.y-hero.y-hero.height,form.y-methods.y-methods.height);
    aligned(firstCard.width,secondCard.width);
    if (stacked) aligned(firstCard.x,secondCard.x);
    else {
      aligned(firstCard.y,secondCard.y);
      aligned(firstCard.height,secondCard.height);
    }
  }
  assert.equal(await manuscript.isVisible(),true);
  assert.equal(await prompt.isVisible(),false);
  assert.equal(await page.locator('[data-method]').count(),2,JSON.stringify({errors,collection:await page.evaluate(()=>Boolean(globalThis.SCRIPTA_COLLECTION))}));
  assert.equal(await page.locator('[data-method="manuscript"]').getAttribute('aria-expanded'),'true');
  assert.equal(await page.locator('[data-method="book-proposal"]').getAttribute('aria-expanded'),'false');
  await assertPageAlignment(manuscript,false);
  assert.equal(await manuscript.locator('[name="description"], [data-instruction-picker="audience"]').count(),0);
  const documents=manuscript.locator('.create-book-brief > .form-file-field [name="documents"]');
  assert.equal(await documents.count(),1);
  assert.equal(await documents.getAttribute('accept'),'.pdf,.doc,.docx');
  assert.equal(await documents.evaluate(input=>input.required),true);
  const fileField=manuscript.locator('.create-book-brief > .form-file-field');
  const title=manuscript.locator('[name="titles"]');
  const picker=fileField.locator('.form-file-picker');
  const readerLayout=manuscript.locator('[name="readerLayout"]');
  const typography=manuscript.locator('[name="readerTypography"]');
  async function assertManuscriptGrid(stacked) {
    const controls=await Promise.all([title,picker,readerLayout,typography].map(locator=>locator.boundingBox()));
    const [first,second,third,fourth]=controls;
    const aligned=(left,right)=>assert.ok(Math.abs(left-right)<1, `Expected ${left} to align with ${right}: ${JSON.stringify(controls)}`);
    for (const control of controls) aligned(control.width,first.width);
    if (stacked) {
      for (const [index,control] of controls.entries()) {
        aligned(control.x,first.x);
        if (index>0) assert.ok(control.y>=controls[index-1].y+controls[index-1].height);
      }
    } else {
      aligned(first.x,third.x);
      aligned(second.x,fourth.x);
      aligned(first.y,second.y);
      aligned(third.y,fourth.y);
      assert.ok(second.x>=first.x+first.width && fourth.y>=second.y+second.height);
    }
  }
  await assertManuscriptGrid(false);
  const [fileLabel,fileFormats]=await Promise.all([
    fileField.locator('#manuscript-file-label').boundingBox(),
    fileField.locator('#manuscript-file-formats').boundingBox(),
  ]);
  assert.ok(fileFormats.x>=fileLabel.x+fileLabel.width && fileFormats.y<fileLabel.y+fileLabel.height);
  const controlStyle=element=>{
    const {height,borderRadius,borderTopStyle,backgroundColor,fontFamily,fontSize}=getComputedStyle(element);
    return {height,borderRadius,borderTopStyle,backgroundColor,fontFamily,fontSize};
  };
  assert.deepEqual(await picker.evaluate(controlStyle),await readerLayout.evaluate(controlStyle));
  await page.setViewportSize({width:390,height:844});
  await assertPageAlignment(manuscript,true);
  await assertManuscriptGrid(true);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.setViewportSize({width:1200,height:900});
  await manuscript.locator('[name="titles"]').fill('Grădina de acasă');
  await manuscript.locator('[name="readerLayout"]').selectOption('reflow');
  await manuscript.locator('[name="coverDescription"]').fill('Coperta manuscrisului');
  await manuscript.locator('[name="documents"]').setInputFiles({
    name:'manuscript.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nfixture')
  });
  await assertManuscriptGrid(false);
  await openPrompt();
  assert.equal(await prompt.locator('[name="documents"]').count(),0);
  assert.equal(await prompt.locator('[name="coverImage"]').count(),1);
  await prompt.locator('[name="description"]').fill('Un ghid despre grădinărit urban.');
  await prompt.locator('[name="coverDescription"]').fill('Coperta ghidului');
  await openManuscript();
  assert.equal(await manuscript.locator('[name="titles"]').inputValue(),'Grădina de acasă');
  assert.equal(await manuscript.locator('[name="readerLayout"]').inputValue(),'reflow');
  assert.match(await manuscript.locator('[data-file-selection]').textContent(),/manuscript.pdf/);
  assert.equal(await manuscript.locator('[name="coverDescription"]').inputValue(),'Coperta manuscrisului');
  await openPrompt();
  assert.match(await prompt.locator('[name="description"]').inputValue(),/grădinărit urban/);
  assert.equal(await prompt.locator('[name="coverDescription"]').inputValue(),'Coperta ghidului');

  await page.setViewportSize({width:390,height:844});
  await assertPageAlignment(prompt,true);
  await prompt.getByText(/8 credite/).waitFor();
  const fit=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
  assert.equal(fit,true);
  await prompt.locator('[name="titles"]').fill('Ghid urban');
  await prompt.locator('[data-contract-accept]').check();
  await Promise.all([
    page.waitForURL(/account\/dashboard\.html\?lang=ro&tab=books&book=bk-/),
    prompt.getByRole('button',{name:'Generează cartea'}).click(),
  ]);
  const newBook=page.locator('.dashboard-book-new');
  await newBook.getByText('Ghid urban',{exact:true}).waitFor();
  assert.match(await newBook.textContent(),/Confirmarea creditelor|Se confirmă creditele/i);
  await open();
  await openManuscript();
  await manuscript.locator('[name="titles"]').fill('Manuscrisul meu');
  await manuscript.locator('[name="documents"]').setInputFiles({
    name:'source.pdf',mimeType:'application/pdf',buffer:Buffer.from('%PDF-1.7\nfixture')
  });
  await manuscript.locator('[data-contract-accept]').check();
  await Promise.all([page.waitForURL(/account\/dashboard\.html\?lang=ro&tab=books&book=bk-/),
    manuscript.getByRole('button',{name:'Trimite manuscrisul'}).click()]);
  await newBook.getByText('Manuscrisul meu',{exact:true}).waitFor();
  assert.doesNotMatch(await newBook.textContent(),/Se confirmă creditele/i);
  assert.deepEqual(errors,[]);
  console.log('Create mode switching, draft retention, mobile layout, paid submit and My Books redirect passed.');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
  await fs.rm(root,{recursive:true,force:true});
}
