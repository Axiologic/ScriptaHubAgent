import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {buildSnapshot} from '../sync.mjs';
import {createSiteServer} from '../server.mjs';
import {pathToFileURL} from 'node:url';
// Manual browser gate against UserPersisto's actual HTML and CSS; never changes an account.
const {chromium} = await import(process.env.PLAYWRIGHT_MODULE ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href : 'playwright-core');
const providerDirectory = process.env.USERPERSISTO_DASHBOARD_DIR;
assert.ok(providerDirectory, 'Set USERPERSISTO_DASHBOARD_DIR to UserPersisto public/dashboard');
const providerCSS = await fs.readFile(providerDirectory + '/dashboard.css', 'utf8');
const enrollmentCSS = await fs.readFile(providerDirectory + '/enrollment.css', 'utf8');
const enrollmentJS = await fs.readFile(providerDirectory + '/enrollment.js', 'utf8');
const enrollmentHTML = enrollmentJS.split('this.element.innerHTML = `')[1].split('`;')[0];
const providerPage = await fs.readFile(providerDirectory + '/index.html', 'utf8');
const provider = providerPage.replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, '')
 .replace('<link rel="stylesheet" href="dashboard.css">', `<style>${providerCSS}${enrollmentCSS}</style>`)
 .replace('id="account-content" class="account-grid" hidden', 'id="account-content" class="account-grid"')
 .replace('<span class="pill" id="account-role"></span>', '<span class="pill" id="account-role">Member</span>')
 .replace('<div id="account-enrollment"></div>', `<div id="account-enrollment" class="up-enrollment">${enrollmentHTML}</div>`);
const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'scriptahub-account-browser-'));
let server,browser;
try{
 const snapshot=await buildSnapshot({config:{schemaVersion:1,repositories:[]},dataDir:temporary});
 server=createSiteServer(snapshot.site,{dataDir:temporary,verifyUser:async()=>({id:'user:fixture',email:'reader@example.org',displayName:'Reader'})});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const base=origin+'/base-agent-additional-server/scriptahubAgent/3002/';
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE ? {executablePath:process.env.CHROMIUM_EXECUTABLE} : {}),args:['--disable-background-networking','--disable-sync','--disable-extensions','--mute-audio']});
 const context=await browser.newContext({viewport:{width:1440,height:1000}});
 await context.route('**/*',route=>{
  if(route.request().url()===origin+'/base-agent-additional-server/userPersistoAgent/7000/service/dashboard/?view=account')return route.fulfill({contentType:'text/html',body:provider});
  return route.request().url().startsWith(origin)?route.continue():route.abort();
 });
 const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto(base+'index.html?lang=ro',{waitUntil:'networkidle'});
 const account=page.locator('[data-account-link]');assert.equal(await account.getAttribute('aria-label'),'Contul meu');
 await account.click();await page.waitForLoadState('networkidle');
 assert.equal(await page.locator('iframe').getAttribute('src'),'/base-agent-additional-server/userPersistoAgent/7000/service/dashboard/?view=account');
 const frame = page.frames().find(frame => frame.url().includes('/service/dashboard/'));
 assert.ok(frame);
 for (const theme of ['light', 'dark', 'orange', 'nord', 'dark-orange']) {
   await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
   await page.waitForFunction(() => {
     const doc = document.querySelector('iframe').contentDocument;
     return doc && doc.documentElement.style.getPropertyValue('--scripta-ink').trim() === getComputedStyle(document.documentElement).getPropertyValue('--ink').trim();
   });
   await frame.locator('[data-scriptahub-account-theme]').waitFor({ state: 'attached' });
   const expected = await page.evaluate(() => {
     const probe=document.createElement('div');probe.style.background='var(--panel)';probe.style.color='var(--ink)';document.body.append(probe);
     const result={background:getComputedStyle(probe).backgroundColor,color:getComputedStyle(probe).color};probe.remove();return result;
   });
   await frame.waitForFunction(expected => getComputedStyle(document.body).backgroundColor === expected.background && getComputedStyle(document.body).color === expected.color, expected);
   const palette = await page.evaluate(() => {
     const result = {};
     for (const token of ['ink', 'muted', 'panel', 'surface', 'field', 'line', 'green', 'button-bg', 'button-ink']) {
       const probe = document.createElement('span');probe.style.color=`var(--${token})`;document.body.append(probe);
       result[token]=getComputedStyle(probe).color;probe.remove();
     }
     return result;
   });
   const checks = [
     ['body','backgroundColor','panel'],['body','color','ink'],
     ['.page-heading h1','color','ink'],['.page-heading p','color','muted'],
     ['#account-role','backgroundColor','field'],['#account-role','color','ink'],['#account-role','borderTopColor','line'],
     ['.account-card','backgroundColor','surface'],['.account-card','borderTopColor','line'],
     ['.account-card h2','color','ink'],['.account-email','color','muted'],['.optional','color','muted'],
     ['.card-description','color','muted'],['.account-details','color','muted'],['.account-details','borderTopColor','line'],
     ['.account-sign-out','color','green'],['footer','color','muted'],
     ['.account-navigation a[aria-current="page"]','backgroundColor','button-bg'],
     ['.account-navigation a[aria-current="page"]','color','button-ink'],
     ['#profile-form input','backgroundColor','field'],['#profile-form input','color','ink'],['#profile-form input','borderTopColor','line'],
     ['.up-enrollment h3','color','ink'],['.up-enrollment p:not(.up-enrollment-status)','color','muted'],
     ['.up-enrollment input','backgroundColor','field'],['.up-enrollment input','color','ink'],['.up-enrollment input','borderTopColor','line'],
     ['.up-enrollment textarea','backgroundColor','field'],['.up-enrollment select','backgroundColor','field'],
     ['.up-enrollment .up-secondary','color','ink'],['.up-enrollment .up-secondary','borderTopColor','line'],
     ['.up-password-setup','backgroundColor','surface'],['.up-totp-setup','borderTopColor','line'],
   ];
   for (const [selector, property, token] of checks) {
     const colors = await frame.locator(selector).evaluateAll((nodes,property)=>nodes.map(node=>getComputedStyle(node)[property]),property);
     assert.ok(colors.length, selector);
     for (const color of colors) assert.equal(color,palette[token],`${theme}: ${selector} ${property}`);
   }
   const leaked = await frame.locator('body *').evaluateAll(nodes => {
     const blues=['rgb(38, 78, 198)','rgb(69, 97, 151)','rgb(242, 246, 255)','rgb(218, 227, 244)','rgb(160, 182, 248)','rgb(233, 237, 249)'];
     return nodes.flatMap(node => {
       const style=getComputedStyle(node);
       return ['color','backgroundColor','borderTopColor','outlineColor'].filter(property=>blues.includes(style[property])).map(property=>({tag:node.tagName,id:node.id,property,color:style[property]}));
     });
   });
   assert.deepEqual(leaked,[],theme+': leftover provider blues');
   const expectedButton = await page.evaluate(() => {
     const probe = document.createElement('button');
     probe.style.background = 'var(--button-bg)';probe.style.color = 'var(--button-ink)';document.body.append(probe);
     const value = { background: getComputedStyle(probe).backgroundColor, color: getComputedStyle(probe).color };probe.remove();return value;
   });
   for (const selector of ['#save-profile', '[data-password-start]', '[data-passkey-start]', '[data-totp-start]', '[data-password-save]', '[data-reauth-submit]', '[data-totp-confirm]', '[data-contact-verify]']) {
     const actual = await frame.locator(selector).evaluate(button => ({background:getComputedStyle(button).backgroundColor,color:getComputedStyle(button).color}));
     assert.deepEqual(actual, expectedButton, theme + ': ' + selector);
   }
   for (const selector of ['#username','[data-password-start]']) {
     await frame.locator(selector).focus();
     assert.equal(await frame.locator(selector).evaluate(node=>getComputedStyle(node).outlineColor),palette.green,theme+': '+selector+' focus');
   }
   const save = frame.locator('#save-profile');
   await save.hover();
   const hoverExpected = await page.evaluate(() => {
     const probe = document.createElement('div');probe.style.background='var(--button-hover)';document.body.append(probe);
     const color=getComputedStyle(probe).backgroundColor;probe.remove();return color;
   });
   assert.equal(await save.evaluate(button => getComputedStyle(button).backgroundColor),hoverExpected,theme + ': save profile hover');
   await save.evaluate(button => button.disabled = true);
   assert.equal(await save.evaluate(button => getComputedStyle(button).backgroundColor),palette.field,theme + ': save profile disabled');
   assert.equal(await save.evaluate(button => getComputedStyle(button).color),palette.muted,theme + ': disabled text');
   await save.evaluate(button => button.disabled = false);
   await page.mouse.move(0,0);
   const expectedField = await page.evaluate(() => {
     const probe = document.createElement('input');probe.style.background='var(--field)';document.body.append(probe);
     const color=getComputedStyle(probe).backgroundColor;probe.remove();return color;
   });
   for (const selector of ['[data-password-new]', '[data-reauth-method]', '[data-totp-uri]']) {
     assert.equal(await frame.locator(selector).evaluate(field => getComputedStyle(field).backgroundColor),expectedField,theme + ': ' + selector);
   }
   const field = await frame.locator('#display-name').evaluate(input => getComputedStyle(input).backgroundColor);
   assert.notEqual(field, theme.startsWith('dark') ? 'rgb(255, 255, 255)' : 'invalid');
 }
 await page.screenshot({path:path.join(temporary,'account-themed-desktop.png')});
 await Promise.all([frame.waitForNavigation({waitUntil:'load'}), frame.evaluate(() => location.reload())]);
 await frame.locator('[data-scriptahub-account-theme]').waitFor({state:'attached'});
 assert.equal(await frame.locator('[data-scriptahub-account-theme]').count(),1);
 const sheetOrder = await frame.locator('head link[rel="stylesheet"]').evaluateAll(nodes => nodes.map(node => node.hasAttribute('data-scriptahub-account-theme')));
 assert.equal(sheetOrder.at(-1),true,'application styles must follow the fully parsed provider styles after iframe navigation');
 const applicationFont = await page.evaluate(() => getComputedStyle(document.documentElement).fontFamily);
 const cards = await frame.locator('.account-card').evaluateAll(nodes => nodes.map(node => ({font:getComputedStyle(node).fontFamily,radius:getComputedStyle(node).borderRadius,padding:getComputedStyle(node).padding})));
 assert.ok(cards.length);
 for (const card of cards) assert.deepEqual(card,{font:applicationFont,radius:'10px',padding:'18px 20px'});
 await page.screenshot({path:path.join(temporary,'account-desktop.png')});
 await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.screenshot({path:path.join(temporary,'account-mobile.png')});
 assert.deepEqual(errors,[]);console.log(JSON.stringify({themes:'5 passed',paletteGroups:'33 checked per theme',providerBlueScan:'passed',rolePill:'passed',focus:'passed',buttons:'save-profile + 7 enrollment controls checked per theme',enrollmentFields:'3 checked per theme',iframeReload:'passed',accountNavigation:'passed',providerFrame:'passed',desktop:'passed',mobile:'passed',pageErrors:errors}));
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(temporary,{recursive:true,force:true});}
