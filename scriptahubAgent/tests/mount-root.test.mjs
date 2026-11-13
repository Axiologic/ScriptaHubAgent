import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createSiteServer} from '../server.mjs';

test('login returns to a canonical document URL before loading relative assets, including stripped Router requests',async t=>{
 const site=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-mount-'));
 await fs.mkdir(path.join(site,'assets'));
 await fs.writeFile(path.join(site,'index.html'),'<link rel="stylesheet" href="assets/site.css"><script src="assets/site.js"></script>');
 await fs.writeFile(path.join(site,'assets/site.css'),'body { color: green; }');
 await fs.writeFile(path.join(site,'assets/site.js'),'window.loaded = true;');
 const server=createSiteServer(site,{dataDir:site});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await fs.rm(site,{recursive:true,force:true});});
 const origin=`http://127.0.0.1:${server.address().port}`,mount='/base-agent-additional-server/scriptahubAgent/3002';
 for(const [url,headers] of [[mount+'?lang=ro',{}],[mount+'/?lang=ro',{}],['/?lang=ro',{'x-forwarded-prefix':mount}]]){
  const first=await fetch(origin+url,{headers,redirect:'manual'});
  assert.equal(first.status,308);assert.equal(first.headers.get('location'),mount+'/index.html?lang=ro');
  const final=await fetch(origin+url,{headers});assert.equal(final.status,200);
  assert.equal(new URL(final.url).search,'?lang=ro');
  for(const asset of ['assets/site.css','assets/site.js']){
   const target=new URL(asset,final.url);assert.ok(target.pathname.startsWith(mount+'/assets/'));
   assert.equal((await fetch(target)).status,200);
  }
 }
 assert.equal((await fetch(origin+'/',{redirect:'manual'})).status,200,'unproxied root already resolves relative assets correctly');
 const head=await fetch(origin+mount,{method:'HEAD',redirect:'manual'});assert.equal(head.status,308);
});
