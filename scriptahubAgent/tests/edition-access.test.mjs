import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {DashboardStore} from '../dashboard-store.mjs';

for (const manageApprovals of [false,true]) test(`edition requests require ownership or an approved contribution (managed=${manageApprovals})`,async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'scripta-edition-access-'));
  const store=new DashboardStore(root,{manageApprovals});
  t.after(async()=>{store.close();await fs.rm(root,{recursive:true,force:true});});
  const owner={id:'owner',email:'owner@example.test',installationAdministratorId:'owner'};
  const contributor={id:'contributor',email:'contributor@example.test'};
  const collaborator={id:'collaborator',email:'collaborator@example.test'};
  const admin={id:'admin',email:'admin@example.test',roles:['admin']};
  store.remember(owner,[{id:'bk-first',title:'First'},{id:'bk-second',title:'Second'}]);
  for(const user of [contributor,collaborator,admin])store.remember(user);
  store.access(owner,'bk-first',collaborator.email);
  const eligible=user=>store.overview(user).editions.map(book=>book.bookId);
  assert.deepEqual(new Set(eligible(owner)),new Set(['bk-first','bk-second']));
  for(const user of [contributor,collaborator,admin]){
    assert.deepEqual(eligible(user),[]);
    assert.throws(()=>store.submitEdition(user,'bk-first',crypto.randomUUID(),5),{status:403});
    assert.throws(()=>store.queueEdition(user,'bk-first',crypto.randomUUID()),{status:403});
  }
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM tasks').get().n,0);
  assert.equal(store.db.prepare('SELECT count(*) AS n FROM approval_cycles').get().n,0);
  let proposalNumber=0;
  const submit=()=>store.submit({id:crypto.randomUUID(),owner:contributor.id,createdAt:new Date().toISOString(),files:[],
    metadata:{kind:'edit',bookId:'bk-first',values:{feedback:`Correct this passage ${++proposalNumber}`}}});
  const rejected=submit();
  assert.deepEqual(eligible(contributor),[]);
  store.decide(owner,rejected.submissionId,'reject');
  assert.deepEqual(eligible(contributor),[]);
  const accepted=submit();store.decide(owner,accepted.submissionId,'accept');
  assert.deepEqual(eligible(contributor),['bk-first']);
  assert.deepEqual(eligible(collaborator),[]);
  assert.deepEqual(eligible(admin),[]);
  assert.throws(()=>store.submitEdition(contributor,'bk-second',crypto.randomUUID(),5),{status:403});
  const result=store.submitEdition(contributor,'bk-first',crypto.randomUUID(),5);
  assert.ok(result.taskId);
  if(manageApprovals){assert.equal(store.cycles.read(result.id).owner,contributor.id);assert.equal(store.cycles.read(result.id).cost,5);}
});
