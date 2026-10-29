import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {compareEdition,expectedEditionText,newLayoutFindings} from '../src/edition-regression.mjs';
import {fileHash} from '../src/storage.mjs';

test('approved replacements preserve every character outside uniquely anchored passages',()=>{
  assert.equal(expectedEditionText('Start old phrase. End',[{before:'old phrase',after:'new phrase'}]),'Start new phrase. End');
  assert.equal(expectedEditionText('A same. B same. End',[{before:'same.',after:'changed.',prefix:'B',suffix:'End'}]),'A same. B changed. End');
  assert.throws(()=>expectedEditionText('same same',[{before:'same',after:'new'}]),/ambiguous/);
  assert.throws(()=>expectedEditionText('Start middle end',[{before:'Start middle',after:'new'},{before:'middle end',after:'new'}]),/overlap/);
  assert.equal(expectedEditionText('A\n\tB'), 'A B');
  assert.notEqual(expectedEditionText('Exact — wording'),expectedEditionText('Exact - wording'));
});
test('existing defects are warnings, while worsening and additional occurrences block',()=>{
  const finding={category:'clipped_content',subjects:['passage'],extent:.1};
  assert.equal(newLayoutFindings([finding],[finding]).regressions.length,0);
  assert.equal(newLayoutFindings([finding],[{...finding,extent:.4}]).regressions.length,1);
  assert.equal(newLayoutFindings([finding],[finding,finding]).regressions.length,1);
  assert.equal(newLayoutFindings([finding],[finding]).existing[0].severity,'warning');
});

test('native edit checks accept a table change and reject lost text, images and new display damage',
  {skip:!process.env.VALIDATEBOOK_TEST_CHROMIUM,timeout:180000},async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'edition-regression-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const baseline=path.join(root,'baseline.html'),candidate=path.join(root,'edited.html');
  const readerCss=fileURLToPath(new URL('../../../site/reader/reader.css',import.meta.url));
  const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5u8AAAAASUVORK5CYII=';
  const table='<table><tr><th>Investment Decision</th><th>Proposed Position</th></tr></table>';
  const html=(passage,extra='')=>`<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body><article style="position:relative"><h1>Edition check</h1><p>Retain this exact narrative.</p>${passage}<p style="display:none">An existing hidden note.</p><img src="${pixel}" alt="Existing image" width="24" height="24">${extra}</article></body></html>`;
  const original=html('<p>Investment Decision Proposed Position</p>');await fs.writeFile(baseline,original);
  const digest=await fileHash(baseline);let n=0;
  const run=async text=>{await fs.writeFile(candidate,text);const before=await fileHash(candidate);const result=await compareEdition(baseline,{candidate,root,readerCss,chromium:process.env.VALIDATEBOOK_TEST_CHROMIUM,jobDir:path.join(root,'job-'+n++)});assert.equal(await fileHash(baseline),digest);assert.equal(await fileHash(candidate),before);return result;};
  const accepted=await run(html(table));assert.equal(accepted.errorFindings,0);assert.equal(accepted.scope,'edition_layout_regression');assert.ok(accepted.existingFindings>0);assert.equal(accepted.measurements.length,6);
  const lost=await run(html(table).replace('Retain this exact narrative.','Retain narrative.'));assert.ok(lost.findings.some(f=>f.category==='unapproved_text_change'));
  const image=await run(html(table).replace(/<img[^>]+>/,''));assert.ok(image.findings.some(f=>f.category==='image_content_changed'));
  const replacement='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1" fill="red"/></svg>');
  const overwritten=await run(html(table).replace(pixel,replacement));assert.ok(overwritten.findings.some(f=>f.category==='image_content_changed'));
  const hidden=await run(html(table).replace('<p>Retain this exact narrative.</p>','<p style="display:none">Retain this exact narrative.</p>'));assert.ok(hidden.findings.some(f=>f.category==='hidden_content'));
  const clipped=await run(html(table).replace('<p>Retain this exact narrative.</p>','<p style="width:5px;height:5px;overflow:hidden">Retain this exact narrative.</p>'));assert.ok(clipped.findings.some(f=>f.category==='clipped_content'));
  const lines=await run(html(table).replace('<p>Retain this exact narrative.</p>','<p style="width:60px;line-height:1px">Retain this exact narrative.</p>'));assert.ok(lines.findings.some(f=>f.category==='text_overlap'));
  const overlap=await run(html(table).replace(`alt="Existing image"`,`style="position:absolute;left:0;top:0;width:150px;height:60px" alt="Existing image"`));assert.ok(overlap.findings.some(f=>f.category==='text_image_overlap'));
  const changes=path.join(root,'changes.json');await fs.writeFile(changes,JSON.stringify([{before:'Retain this exact narrative.',after:'Approved new narrative.'}]));
  await fs.writeFile(candidate,original.replace('Retain this exact narrative.','Approved new narrative.'));
  const approved=await compareEdition(baseline,{candidate,root,readerCss,changes,chromium:process.env.VALIDATEBOOK_TEST_CHROMIUM,jobDir:path.join(root,'approved')});assert.equal(approved.errorFindings,0);
});
