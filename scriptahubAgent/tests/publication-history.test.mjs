import test from 'node:test';
import assert from 'node:assert/strict';
import {checkPublicationPackage} from '../publication-policy.mjs';
import {sha256} from '../publication-transfer.mjs';
const id='bk-history',directory='books/example/'+id,root='books/history';
const json=value=>Buffer.from(JSON.stringify(value));
const history={schemaVersion:1,bookId:id,currentEdition:'edition-1',editions:[{id:'edition-1',files:{en:'en/edition-1.html',fr:'fr/full.html'}}]};
function fixture(schema) {
  const target={collection:'collection.json',root:''},manifest={taskType:'scriptahub.edit',bookId:id,sourceHashes:[]};
  if(schema===1){
    const book={id,directory,editions:{en:{fullContent:directory+'/en/edition-1.html'},fr:{fullContent:directory+'/fr/full.html'}}};
    const previous={schemaVersion:1,bookCount:1,books:[book]};
    const document={metadata:{id},history:structuredClone(history)};
    const candidate={...previous,books:[{...book,editions:{...book.editions,en:{fullContent:directory+'/en/edition-2.html'}}}]};
    const next={metadata:{id},history:{...structuredClone(history),currentEdition:'edition-2',editions:[...structuredClone(history.editions),{id:'edition-2'}]}};
    const pack=()=>new Map([['collection.json',json(candidate)],[directory+'/manifest.json',json(next.metadata)],[directory+'/editions.json',json(next.history)],[directory+'/en/edition-2.html',Buffer.from('new')],[directory+'/fr/full.html',Buffer.from('unchanged')]]);
    return {target,manifest,previous,document,candidate,next,pack};
  }
  const shared='assets/shared/'+sha256(Buffer.from('French text'))+'.html';
  const document={schemaVersion:2,id,legacyDirectory:directory,contentDirectory:root,metadata:{id,editions:{en:{book:'en/book.html',fullContent:'en/edition-1.html'},fr:{book:'fr/book.html',fullContent:'fr/full.html'}}},history:structuredClone(history),resources:{'en/edition-1.html':root+'/en/edition-1.html','fr/full.html':shared}};
  const previous={schemaVersion:2,bookCount:1,books:[{id,path:root+'/book.json',sha256:sha256(json(document))}]};
  const next=structuredClone(document);next.metadata.editions.en.fullContent='en/edition-2.html';next.resources['en/edition-2.html']=root+'/en/edition-2.html';next.history.currentEdition='edition-2';next.history.editions.push({id:'edition-2'});
  const pack=()=>new Map([['collection.json',json({...previous,books:[{...previous.books[0],sha256:sha256(json(next))}]})],[root+'/book.json',json(next)],...Object.values(next.resources).map(name=>[name,Buffer.from(name===shared?'French text':name)])]);
  return {target,manifest,previous,document,next,pack};
}
for(const schema of [1,2]) {
  test(`schema ${schema}: an edit retains prior editions and unaffected language/format access`,()=>{
    const f=fixture(schema),check=()=>checkPublicationPackage(f.manifest,f.target,f.pack(),f.previous,f.document);
    assert.doesNotThrow(check);
    f.next.history.editions.shift();assert.throws(check,/cannot remove or rewrite/);
  });
  test(`schema ${schema}: history entries cannot be rewritten or duplicated`,()=>{
    const f=fixture(schema),check=()=>checkPublicationPackage(f.manifest,f.target,f.pack(),f.previous,f.document);
    f.next.history.editions[0].files.en='en/other.html';assert.throws(check,/cannot remove or rewrite/);
    f.next.history=structuredClone(history);f.next.history.editions.push({...history.editions[0]});assert.throws(check,/duplicate/);
  });
  test(`schema ${schema}: an edit cannot silently drop an existing language or format`,()=>{
    const f=fixture(schema);delete (schema===1?f.candidate.books[0].editions:f.next.metadata.editions).fr;
    assert.throws(()=>checkPublicationPackage(f.manifest,f.target,f.pack(),f.previous,f.document),/cannot remove an existing edition/);
  });
}
test('schema 2: old aliases stay immutable, including unchanged shared resources',()=>{
  const f=fixture(2),check=()=>checkPublicationPackage(f.manifest,f.target,f.pack(),f.previous,f.document);
  assert.doesNotThrow(check);
  f.next.resources['en/edition-1.html']=root+'/en/edition-2.html';assert.throws(check,/cannot remove or remap/);
  delete f.next.resources['en/edition-1.html'];assert.throws(check,/cannot remove or remap/);
});
test('the previous Git document is mandatory and current edition references remain consistent',()=>{
  const f=fixture(1);
  assert.throws(()=>checkPublicationPackage(f.manifest,f.target,f.pack(),f.previous),/verified existing edition history/);
  delete f.next.history.currentEdition;assert.throws(()=>checkPublicationPackage(f.manifest,f.target,f.pack(),f.previous,f.document),/current edition reference/);
  f.next.history.currentEdition='missing';assert.throws(()=>checkPublicationPackage(f.manifest,f.target,f.pack(),f.previous,f.document),/missing from its history/);
});
