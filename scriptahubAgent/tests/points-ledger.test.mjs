import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {describePointsLedger} from '../points-ledger.mjs';

test('point history resolves a book title and route for the ledger owner without changing transaction references',t=>{
 const db=new DatabaseSync(':memory:');t.after(()=>db.close());
 db.exec('CREATE TABLE books(id TEXT,title TEXT);CREATE TABLE approval_cycles(id TEXT,owner TEXT,book_id TEXT);');
 const id='23d8f540-ca9a-414d-8692-74b5dabd78d8';
 db.prepare('INSERT INTO books VALUES(?,?)').run('bk-test','Stored title');
 db.prepare('INSERT INTO approval_cycles VALUES(?,?,?)').run(id,'user:reader','bk-test');
 const catalogue=[{id:'bk-test',title:{ro:'Geneza poporului român'},editions:{ro:{book:'books/geneza/ro/book.html'}}}];
 const ledger={entries:['reward','edition','fork'].map(kind=>({referenceId:`scriptahub:${kind}:${id}${kind==='reward'?'':':2'}`,amount:10})),totalCount:3};
 const result=describePointsLedger({db},ledger,'user:reader',catalogue,'ro');
 for(let i=0;i<3;i++){
  assert.deepEqual(result.entries[i].book,{title:'Geneza poporului român',path:'books/geneza/ro/book.html'});
  assert.equal(result.entries[i].referenceId,ledger.entries[i].referenceId);
  assert.equal(ledger.entries[i].book,undefined);
 }
 assert.equal(describePointsLedger({db},ledger,'user:other',catalogue,'ro').entries[0].book,undefined);
 assert.deepEqual(describePointsLedger({db},ledger,'user:reader',[]).entries[0].book,{title:'Stored title'});
 const manual={entries:[{referenceId:'scriptahub:admin:'+id,reason:'Contribution'}]};
 assert.deepEqual(describePointsLedger({db},manual,'user:reader',catalogue),manual);
});
