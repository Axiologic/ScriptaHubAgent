import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {promisify} from 'node:util';
import {reviewContent} from '../content-moderation.mjs';

const execute=promisify(execFile);
const pdf=fileURLToPath(new URL('../../skills/pdf2html/tests/fixtures/semantic.pdf',import.meta.url));
const script=fileURLToPath(new URL('../../skills/book-pdf/scripts/book-pdf.mjs',import.meta.url));
const env={SCRIPTA_MODERATION_MODEL:'fixture/model'};
const verdict=result=>({choices:[{message:{content:JSON.stringify(result)}}]});
const context={taskId:'book-request',stage:'submission'};

test('missing or invalid moderation configuration stops processing',async()=>{
  await assert.rejects(reviewContent(context,[],{env:{}}),{code:'MODERATION_UNAVAILABLE'});
  await assert.rejects(reviewContent(context,[{path:'request.json',bytes:Buffer.from('{}')}],{
    env,connect:async()=>async()=>verdict({status:'unknown'})}),{code:'MODERATION_UNAVAILABLE'});
});

test('a real PDF is rendered and sent to the configured reviewer with image evidence',async t=>{
  try { await execute('pdfinfo',['-v']); await execute('pdftoppm',['-v']); await execute('pdftotext',['-v']); }
  catch { t.skip('requires Poppler'); return; }
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'moderation-test-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const folder=path.join(root,'tasks',context.taskId);
  await fs.mkdir(folder,{recursive:true});
  let classified=0, visual=0;
  const result=await reviewContent(context,[{path:'attachment.pdf',bytes:await fs.readFile(pdf),changeId:'correct-id'}],{
    env,
    prepare:async (source,_task,input,output)=>{
      await fs.mkdir(path.dirname(path.join(folder,input)),{recursive:true});
      await fs.mkdir(path.dirname(path.join(folder,output)),{recursive:true});
      await fs.copyFile(path.join(source,input),path.join(folder,input));
      await execute(process.execPath,[script,'moderation-render',path.join(folder,input),'--output',path.join(folder,output)],{cwd:root});
      await fs.rename(path.join(folder,output),path.join(source,output));
      return true;
    },
    connect:async()=>async ({model,messages})=>{
      assert.equal(model,env.SCRIPTA_MODERATION_MODEL);
      const [text,image]=messages[1].content;
      classified++;
      assert.equal(typeof JSON.parse(text.text).material,'string');
      if (image) {
        assert.equal(image.type,'image_url');
        assert.match(image.image_url.url,/^data:image\/png;base64,/);
        assert.equal(Buffer.from(image.image_url.url.split(',')[1],'base64').subarray(0,8).toString('hex'),'89504e470d0a1a0a');
        visual++;
      }
      return verdict(image ? {status:'blocked',category:'extreme_presentation'} : {status:'passed'});
    }
  });
  assert.deepEqual(result,{category:'extreme_presentation',changeId:'correct-id'});
  assert.equal(classified,1);
  assert.equal(visual,1);
});
