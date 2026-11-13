import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {openRoot} from '../scripts/anchored-files.mjs';
import {bookInputScope} from '../scripts/book-input-scope.mjs';
async function fixture(t){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'book-input-scope-'));
 const write=async(name,bytes)=>{await fs.mkdir(path.dirname(path.join(dir,name)),{recursive:true});await fs.writeFile(path.join(dir,name),bytes);};
 await write('package/books/current/book.json',JSON.stringify({id:'book-one'}));
 await write('package/books/current/ro/full.html','<link rel="stylesheet" href="../../../assets/shared/book.css"><p>Current book</p>');
 await write('package/assets/shared/book.css','@font-face{font-family:Book;src:url(book.woff2)}');
 await write('package/assets/shared/book.woff2','font bytes');
 await write('package/assets/shared/unrelated.png','not referenced');
 await write('package/books/other/book.json',JSON.stringify({id:'book-other'}));
 await write('package/books/other/en/full.html','UNRELATED BOOK CONTENT');
 await write('package/collection.json','{"books":[]}');
 const root=await openRoot(dir);t.after(async()=>{await root.close();await fs.rm(dir,{recursive:true,force:true});});
 const input={taskDirectory:'tasks/a',virtualCwd:'/workspace/run',bookId:'book-one',args:['prepare','tasks/a/package/books/current']};
 return {dir,root,write,input,scope:options=>bookInputScope(root,{...input,...options})};
}
test('a package skill receives only the claimed book and transitive referenced shared assets',async t=>{
 const f=await fixture(t),scope=await f.scope();
 assert.equal(scope.allows('package/books/current/ro/full.html'),true);
 assert.equal(scope.allows('package/assets/shared/book.css'),true);
 assert.equal(scope.allows('package/assets/shared/book.woff2'),true);
 for(const name of ['package/collection.json','package/books/other/en/full.html','package/assets/shared/unrelated.png'])assert.equal(scope.allows(name),false,name);
 assert.equal(scope.traverse('package/books/other'),false);
 assert.equal(scope.traverse('package/books'),true);
 const resumed=await f.scope({args:['status','tasks/a/review/job'],bookRootHint:scope.bookRoot});
 assert.equal(resumed.bookRoot,scope.bookRoot);
});
test('non-package commands exclude the package entirely and broad or mixed-book arguments are refused',async t=>{
 const f=await fixture(t),scope=await f.scope({args:['build','tasks/a/sources/job']});
 assert.equal(scope.traverse('package'),false);assert.equal(scope.allows('sources/current.html'),true);
 await assert.rejects(f.scope({args:['prepare','tasks/a/package']}),/current book/);
 await assert.rejects(f.scope({args:['prepare','tasks/a/package/books']}),/current book/);
 await assert.rejects(f.scope({args:['prepare','tasks/a']}),/current book/);
 await assert.rejects(f.scope({args:['compare-edition','tasks/a/package/books/current','tasks/a/package/books/other']}),/multiple/);
 await assert.rejects(f.scope({args:['prepare','tasks/a/package/books/other']}),/claimed book/);
});
test('a local asset cannot cause another book or an outside file to be included',async t=>{
 const f=await fixture(t);
 await f.write('package/books/current/ro/full.html','<link href="../../other/style.css">');
 await assert.rejects(f.scope(),/another package book/);
 await f.write('package/books/current/ro/full.html','<img src="../../../../../../outside.png">');
 await assert.rejects(f.scope(),/leaves the task/);
});
