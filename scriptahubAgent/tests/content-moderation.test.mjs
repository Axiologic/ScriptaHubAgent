import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {prepareReviewUnits} from '../content-moderation.mjs';

const execute=promisify(execFile);
const pdf=fileURLToPath(new URL('../../skills/pdf2html/tests/fixtures/semantic.pdf',import.meta.url));
const script=fileURLToPath(new URL('../../skills/book-pdf/scripts/book-pdf.mjs',import.meta.url));
const context={taskId:'book-request',stage:'submission'};

test('a real PDF produces readable text and PNG units for the robot',async t=>{
  try { await execute('pdfinfo',['-v']); await execute('pdftoppm',['-v']); await execute('pdftotext',['-v']); }
  catch { t.skip('requires Poppler'); return; }
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'moderation-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const folder=path.join(root,'tasks',context.taskId);
  await fs.mkdir(folder,{recursive:true});
  const result=await prepareReviewUnits(context,[{path:'attachment.pdf',bytes:await fs.readFile(pdf),changeId:'correct-id'}],{
    prepare:async (source,_task,input,output)=>{
      await fs.mkdir(path.dirname(path.join(folder,input)),{recursive:true});
      await fs.mkdir(path.dirname(path.join(folder,output)),{recursive:true});
      await fs.copyFile(path.join(source,input),path.join(folder,input));
      await execute(process.execPath,[script,'moderation-render',path.join(folder,input),'--output',path.join(folder,output)],{cwd:root});
      await fs.rename(path.join(folder,output),path.join(source,output));
      return true;
    },
  });
  assert.ok(result.units.length);
  for (const item of result.units) {
    assert.equal(item.changeId,'correct-id');
    assert.match(item.digest,/^[a-f0-9]{64}$/);
    assert.equal(item.image.subarray(0,8).toString('hex'),'89504e470d0a1a0a');
  }
});
