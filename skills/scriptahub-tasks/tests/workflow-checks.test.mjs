import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {editionReaders, insideRun, writeHandoff, requirePreflight, verifyPackage, readManuscriptEditorial} from '../scripts/workflow-checks.mjs';
import {combineCollections, validateCatalogueKeywords} from '../scripts/catalogue-keywords.mjs';
import {publishPackage} from '../scripts/run.mjs';
import {applyManuscriptPresentation, prepareReadingRoutes} from '../scripts/prepare-reading-routes.mjs';

async function inRun(callback) {
  const previous = process.cwd();
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'scripta-checks-')));
  try { process.chdir(root); await callback(root); }
  finally { process.chdir(previous); await fs.rm(root, {recursive:true, force:true}); }
}
const context = {executionId:'execution-one', runId:'run-one', taskId:'task-one', bookId:'book-one'};
test('manuscript reader preferences preserve the original body and are idempotent', () => {
  const original = '<html><head><title>Source</title></head><body><main>Original text</main></body></html>';
  const values = {readerLayout:'reflow',readerTypography:'readable'};
  const marked = applyManuscriptPresentation(original,values);
  assert.match(marked, /<meta name="scriptahub-reader-presentation" content="reflow readable"><\/head>/);
  assert.equal(marked.slice(marked.indexOf('<body>')),original.slice(original.indexOf('<body>')));
  assert.equal(applyManuscriptPresentation(marked,values),marked);
  assert.equal(applyManuscriptPresentation(original,{readerLayout:'source'}),original);
});
const emptyKeywords = Object.fromEntries(['en','fr','de','es','pt','it','ro','pl'].map(code => [code, []]));

for (const schemaVersion of [1, 2]) test('preparation writes the reading routes for schema ' + schemaVersion, {skip:process.platform!=='linux'}, async () => inRun(async () => {
  const directory = 'tasks/task-one', bookDir = 'books/example';
  const pkg = directory + '/package', book = pkg + '/' + bookDir;
  const metadataPath = book + (schemaVersion === 1 ? '/manifest.json' : '/book.json');
  const metadata = {id:context.bookId, title:{en:'Example'}, editions:{en:{book:'en/book.html',fullContent:'en/book.html'}}};
  const entry = schemaVersion === 1 ? {...metadata, directory:bookDir} : {id:context.bookId,path:bookDir+'/book.json'};
  const full = schemaVersion === 1 ? 'en/full_content.html' : 'en/manuscript.html';
  const short = 'en/comprehensive-summary.html';
  await fs.mkdir(directory+'/run-state',{recursive:true});
  await fs.mkdir(book+'/en',{recursive:true});
  await fs.writeFile(directory+'/run-state/claimed.json',JSON.stringify({
    task:{...context,type:'scriptahub.book-proposal',values:{coverMode:'generate'}}
  }));
  await fs.writeFile(pkg+'/collection.json',JSON.stringify({schemaVersion,books:[entry]}));
  await fs.writeFile(metadataPath,JSON.stringify(schemaVersion===1?metadata:{metadata,resources:{}}));
  await fs.writeFile(book+'/'+full,'<main>Full text</main>');
  await fs.writeFile(book+'/'+short,'<meta name="summary-generator" content="comprehensivesummary-skill">');
  const cover = 'en/cover.svg';
  const artwork = '<svg xmlns="http://www.w3.org/2000/svg"><title>Example</title></svg>';
  await fs.writeFile(book+'/'+cover,artwork);
  const input = {directory,executionId:context.executionId,collectionPath:'collection.json',
    editions:{en:{fullContent:full,comprehensiveSummary:short,shortDescription:'Short description',aboutBook:['Presentation']}}};
  await assert.rejects(prepareReadingRoutes(input), /Provide a staged cover image for en/);
  input.editions.en.cover = cover;
  const pdf = 'en/book.pdf';
  await fs.writeFile(book+'/'+pdf,'%PDF-1.7\n');
  input.editions.en.pdf = pdf;
  const result = await prepareReadingRoutes(input);
  assert.equal(result.editions.en.fullContent,book+'/'+full);
  assert.deepEqual(await prepareReadingRoutes(input),result);
  const catalogue = JSON.parse(await fs.readFile(pkg+'/collection.json','utf8'));
  const bytes = await fs.readFile(metadataPath);
  const saved = JSON.parse(bytes);
  const finalMetadata = schemaVersion===1 ? saved : saved.metadata;
  assert.deepEqual(finalMetadata.editions.en,{book:'en/book.html',fullContent:'en/full_content.html',shortContent:short,pdf});
  assert.deepEqual(finalMetadata.aboutBook.en,['Presentation']);
  assert.equal(finalMetadata.coverUrl.en,cover);
  assert.equal(finalMetadata.thumbnailUrl.en,cover);
  if (schemaVersion===1) {
    assert.equal(catalogue.books[0].editions.en.fullContent,bookDir+'/'+full);
    assert.equal(catalogue.books[0].editions.en.pdf,bookDir+'/'+pdf);
    assert.match(await fs.readFile(book+'/en/book.html','utf8'),/href="book.pdf" download/);
    assert.equal(catalogue.books[0].coverUrl.en,bookDir+'/'+cover);
    assert.equal(catalogue.books[0].thumbnailUrl.en,bookDir+'/'+cover);
    assert.match(await fs.readFile(book+'/en/book.html','utf8'),/href="comprehensive-summary.html"/);
  } else {
    assert.equal(saved.resources['en/full_content.html'],bookDir+'/'+full);
    assert.equal(saved.resources[cover],bookDir+'/'+cover);
    assert.equal(saved.resources[pdf],bookDir+'/'+pdf);
    assert.equal(saved.resourceChecksums[bookDir+'/'+cover],crypto.createHash('sha256').update(artwork).digest('hex'));
    assert.equal(catalogue.books[0].sha256,crypto.createHash('sha256').update(bytes).digest('hex'));
  }
  const files = ['collection.json', bookDir + '/' + path.basename(metadataPath),
    bookDir + '/' + full, bookDir + '/' + short, bookDir + '/' + cover, bookDir + '/' + pdf];
  if (schemaVersion === 1) files.push(bookDir + '/en/book.html');
  assert.equal((await editionReaders(path.join(process.cwd(),pkg),'collection.json',catalogue,
    context.bookId,new Set(files),true,true,{required:true},true)).get('en'),bookDir + '/' + full);
  await assert.rejects(editionReaders(path.join(process.cwd(),pkg),'collection.json',catalogue,
    context.bookId,new Set(files.filter(name=>!name.endsWith('.pdf'))),true,true,undefined,true),/Missing download PDF for en/);

  if (schemaVersion === 1) {
    delete catalogue.books[0].thumbnailUrl;
    catalogue.books[0].keywordIds = [];
    catalogue.books[0].keywords = emptyKeywords;
    Object.assign(catalogue,combineCollections(catalogue.books));
  } else {
    delete saved.metadata.thumbnailUrl;
    const changed = JSON.stringify(saved);
    await fs.writeFile(metadataPath,changed);
    catalogue.books[0].sha256 = crypto.createHash('sha256').update(changed).digest('hex');
  }
  catalogue.bookCount = catalogue.books.length;
  await fs.writeFile(pkg+'/collection.json',JSON.stringify(catalogue));
  const inventory = directory+'/inventory.json';
  await fs.writeFile(inventory,JSON.stringify({executionId:context.executionId,baseCommit:null,
    files:await Promise.all(files.map(async name => {
      const bytes = await fs.readFile(pkg+'/'+name);
      return {path:name,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
    }))}));
  const verification = {...context,directory,packageRoot:pkg,inventory,
    catalogue:'https://github.com/example/books/blob/main/collection.json',branch:'main'};
  await assert.rejects(verifyPackage({...verification,checkReadingRoutes:true}),/thumbnail mapping for en/);
  await assert.rejects(verifyPackage({...verification,finalize:true}),/thumbnail mapping for en/);
}));

test('both catalogue schemes bind each reading action to its own resource', async () => inRun(async root => {
  const full = 'en/full.html', short = 'en/summary.html', landing = 'en/book.html';
  await fs.mkdir('en');
  await fs.writeFile(short, '<meta name="summary-generator" content="comprehensivesummary-skill">');
  const routes = {book:landing, fullContent:full, shortContent:short};
  const metadata = {id:context.bookId, aboutBook:{en:['An editorial presentation.']}, editions:{en:routes}};
  const files = new Set([full, short, landing, 'book.json']);
  const check = collection => editionReaders(root, 'collection.json', collection, context.bookId, files, true, true);
  const legacy = {schemaVersion:1, books:[metadata]};
  assert.equal((await check(legacy)).get('en'), full);
  routes.fullContent = landing;
  await assert.rejects(check(legacy), /distinct routes/);
  routes.fullContent = full;
  await fs.writeFile(short, '<meta name="short-description-generator" content="shortdescription-skill">');
  await assert.rejects(check(legacy), /must open the comprehensive summary/);
  await fs.writeFile(short, '<meta content="comprehensivesummary-skill" name="summary-generator">');

  const modern = {schemaVersion:2, books:[{id:context.bookId,path:'book.json'}]};
  const resources = {[full]:'en/reader.html', [short]:'en/summary.html'};
  files.delete(landing);
  files.add(resources[full]);
  await fs.writeFile('book.json', JSON.stringify({metadata, resources}));
  assert.equal((await check(modern)).get('en'), resources[full]);
  resources[short] = resources[full];
  await fs.writeFile('book.json', JSON.stringify({metadata, resources}));
  await assert.rejects(check(modern), /distinct routes/);
}));

test('durable handoffs preserve execution identity, accept large context and reject secrets and symlinks', async () => inRun(async root => {
  const saved = await writeHandoff({step:'prepare-manuscript', context});
  assert.match(saved.sha256, /^[a-f0-9]{64}$/);
  await writeHandoff({step:'process-content', context:{...context, artifact:'book.html'}});
  assert.equal(JSON.parse(await fs.readFile(saved.path)).context.artifact, 'book.html');
  await assert.rejects(writeHandoff({step:'process-content', context:{...context, executionId:'another'}}), /another execution/);
  await assert.rejects(writeHandoff({step:'process-content', context:{...context, data:{password:'private'}}}), /Secrets/);
  const data = 'x'.repeat(128*1024);
  const launcher = fileURLToPath(new URL('../scripts/run.mjs',import.meta.url));
  const result = spawnSync(process.execPath,[launcher,'handoff'],{
    input:JSON.stringify({step:'process-content',context:{...context,data}}),encoding:'utf8',
  });
  assert.equal(result.status,0,result.stderr);
  await writeHandoff({step:'process-content', context});
  assert.equal(JSON.parse(await fs.readFile(saved.path)).context.data,data);
  await assert.rejects(insideRun('../outside'), /leaves/);
  await fs.symlink(path.join(root, saved.path), 'link.json');
  await assert.rejects(insideRun('link.json'), /symlinks/);
  await fs.rm(saved.path); await fs.symlink(path.join(root,'link.json'), saved.path);
  await assert.rejects(writeHandoff({step:'process-content', context}), /symlinks/);
}));

test('claim requires a fresh successful preflight, including a valid timestamp', async () => inRun(async () => {
  await assert.rejects(requirePreflight(), /preflight/);
  await fs.mkdir('run-state');
  const now = Date.now();
  const report = {ok:true, runtimeId:'runtime', platform:'linux-x64', sourceDigests:{}, checks:Array.from({length:8}, () => ({status:'passed'})), checkedAt:new Date(now).toISOString()};
  await fs.writeFile('run-state/preflight.json', JSON.stringify(report));
  await requirePreflight(now);
  for (const change of [{ok:false}, {checkedAt:'invalid'}, {checkedAt:new Date(now+1000).toISOString()}, {checkedAt:new Date(now-900001).toISOString()}, {checks:[]}]) {
    await fs.writeFile('run-state/preflight.json', JSON.stringify({...report,...change}));
    await assert.rejects(requirePreflight(now), /preflight/);
  }
}));

test('batch verification refuses different bytes, execution identity and unsafe inventory paths before remote access', async () => inRun(async () => {
  await fs.mkdir('package');
  const bytes = Buffer.from('book'); await fs.writeFile('package/book.html', bytes);
  const entry = {path:'book.html', size:bytes.length, sha256:crypto.createHash('sha256').update(bytes).digest('hex')};
  const inventory = {executionId:context.executionId, baseCommit:null, files:[entry]};
  const input = {...context, packageRoot:'package', inventory:'inventory.json', catalogue:'https://github.com/example/books/blob/main/collection.json', branch:'main'};
  for (const [change, pattern] of [[{executionId:'another'}, /another execution/], [{files:[{...entry,sha256:'0'.repeat(64)}]}, /differs/], [{files:[{...entry,path:'../book.html'}]}, /Unsafe/], [{files:[entry,entry]}, /duplicate/]]) {
    await fs.writeFile('inventory.json', JSON.stringify({...inventory,...change}));
    await assert.rejects(verifyPackage(input), pattern);
  }
}));

test('batch item handoffs isolate identities and reject directories outside the item namespace', async () => inRun(async () => {
  const first=await writeHandoff({step:'prepare-manuscript',directory:'tasks/task-one',context});
  const secondContext={...context,executionId:'execution-two',runId:'run-two',taskId:'task-two'};
  const second=await writeHandoff({step:'claim-edit',directory:'tasks/task-two',context:secondContext});
  assert.notEqual(first.path,second.path);
  assert.equal(JSON.parse(await fs.readFile(first.path)).context.executionId,'execution-one');
  assert.equal(JSON.parse(await fs.readFile(second.path)).context.executionId,'execution-two');
  await assert.rejects(writeHandoff({step:'prepare-manuscript',directory:'tasks/../outside',context}),/Invalid task directory/);
  await assert.rejects(writeHandoff({step:'apply-edit',directory:'tasks/task-one',context:secondContext}),/another execution/);
}));

test('package verification rejects incomplete keyword metadata and stale counts before remote access', async () => inRun(async () => {
  await fs.mkdir('package');
  const labels = Object.fromEntries(['en','fr','de','es','pt','it','ro','pl'].map(code=>[code,['Dacians']]));
  const book = {id:context.bookId,keywordIds:['term:dacians'],keywords:labels};
  const collection = combineCollections([book]);
  validateCatalogueKeywords(collection);
  const input = {...context,packageRoot:'package',inventory:'inventory.json',
    catalogue:'https://github.com/example/books/blob/main/collection.json',branch:'main'};
  for (const [mutate, pattern] of [
    [value=>delete value.keywords,/Missing or invalid catalogue keyword index/],
    [value=>{value.keywords=null;},/Missing or invalid catalogue keyword index/],
    [value=>delete value.books[0].keywordIds,/Invalid keyword catalogue/],
    [value=>delete value.books[0].keywords.ro,/Invalid keyword catalogue/],
    [value=>{value.keywords.en=[];},/Invalid catalogue keyword index/],
    [value=>{value.keywords.en[0].count=2;},/keyword counts/],
  ]) {
    const candidate=structuredClone(collection);mutate(candidate);
    const bytes=Buffer.from(JSON.stringify(candidate));
    await fs.writeFile('package/collection.json',bytes);
    await fs.writeFile('inventory.json',JSON.stringify({executionId:context.executionId,baseCommit:null,
      files:[{path:'collection.json',size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')}]}));
    await assert.rejects(verifyPackage(input),pattern);
  }
  assert.throws(()=>combineCollections([{...book,keywordIds:['term:dacians','term:dacians']}]),/Invalid keyword catalogue/);
  const shared=combineCollections([book,{...book,id:'another-book'}]);
  assert.equal(shared.keywords.en[0].count,2);
  validateCatalogueKeywords(shared);
}));

test('a sparse non-Git publication package keeps its validated baseline when the remote advances',async()=>inRun(async root=>{
 const originalPath=process.env.PATH;
 try{
  const sha='a'.repeat(40),head='b'.repeat(40),collection=combineCollections([{id:context.bookId,directory:'books/current/'+context.bookId,keywordIds:[],keywords:emptyKeywords}]);
  await fs.mkdir('package');await fs.mkdir('bin');
  await fs.writeFile('package/collection.json',JSON.stringify(collection));await fs.writeFile('package/book.html','current book');
  const files=[];for(const name of ['collection.json','book.html']){const bytes=await fs.readFile('package/'+name);files.push({path:name,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
  await fs.writeFile('inventory.json',JSON.stringify({executionId:context.executionId,baseCommit:sha,files}));
  await fs.writeFile('bin/git',`#!${process.execPath}\nif(process.argv.includes('ls-remote'))process.stdout.write('${head}\\trefs/heads/main\\n');else process.exit(99);\n`,{mode:0o700});
  process.env.PATH=path.join(root,'bin')+path.delimiter+originalPath;
  const result=await verifyPackage({...context,packageRoot:'package',inventory:'inventory.json',catalogue:'https://github.com/example/books/blob/main/collection.json',branch:'main'});
  assert.equal(result.ok,true);assert.equal(result.baseCommit,sha);assert.equal(result.fileCount,2);
 }finally{process.env.PATH=originalPath;}
}));

test('generated HTML is accepted without PDF only after a strict native reader/layout audit',async()=>inRun(async root=>{
 const savedPath=process.env.PATH;
 try{
  const sha='b'.repeat(40);await fs.mkdir('package');await fs.mkdir('bin');await fs.mkdir('tasks/a/run-state',{recursive:true});
  await fs.writeFile('tasks/a/run-state/claimed.json',JSON.stringify({task:{type:'scriptahub.book-proposal',executionId:context.executionId,bookId:context.bookId}}));
  await fs.writeFile('package/book.html','<!doctype html><html lang="ro"><body><main><p>Cartea generată.</p></main></body></html>');
  await fs.writeFile('package/collection.json',JSON.stringify(combineCollections([{id:context.bookId,directory:'books/current/'+context.bookId,keywordIds:[],keywords:emptyKeywords}])));
  const files=[];for(const name of ['collection.json','book.html']){const bytes=await fs.readFile('package/'+name);files.push({path:name,size:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
  await fs.writeFile('inventory.json',JSON.stringify({executionId:context.executionId,baseCommit:sha,files}));
  await fs.writeFile('bin/git',`#!${process.execPath}\nif(process.argv.includes('ls-remote'))process.stdout.write('${sha}\\trefs/heads/main\\n');else process.exit(99);\n`,{mode:0o700});process.env.PATH=path.join(root,'bin')+path.delimiter+savedPath;
  const native={scope:'edition_layout_regression',status:'passed',autoCorrect:false,errorFindings:0,existingFindings:0,findings:[],candidate:{file:path.join(root,'package/book.html'),sha256:files[1].sha256}};
  const input={...context,directory:'tasks/a',packageRoot:'package',inventory:'inventory.json',audit:'audit.json',catalogue:'https://github.com/example/books/blob/main/collection.json',branch:'main'};
  await fs.writeFile('audit.json',JSON.stringify(native));
  assert.equal((await verifyPackage(input)).audit.scope,'html_layout_integrity');
  await fs.writeFile('audit.json',JSON.stringify({...native,existingFindings:1,status:'passed_with_warnings'}));
  await assert.rejects(verifyPackage(input),/baseline defects/);
  await fs.writeFile('audit.json',JSON.stringify({...native,candidate:{...native.candidate,sha256:'0'.repeat(64)}}));
  await assert.rejects(verifyPackage(input),/HTML changed/);
 }finally{process.env.PATH=savedPath;}
}));

test('final edit approval requires every affected reader and binds the exact inventory to publication', async () => inRun(async root => {
  const previousPath = process.env.PATH, commit = 'a'.repeat(40), directory = 'tasks/task-one';
  const save = (file, value) => fs.writeFile(file, JSON.stringify(value));
  const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
  const editions = [], audits = [], files = [], readers = {};
  try {
    await fs.mkdir(directory + '/run-state', {recursive: true});
    await fs.mkdir('package');
    await fs.mkdir('bin');
    await fs.writeFile('bin/git', `#!${process.execPath}\nprocess.stdout.write('${commit}\\trefs/heads/main\\n');\n`, {mode: 0o700});
    process.env.PATH = path.join(root, 'bin') + path.delimiter + previousPath;
    const requests = [{language: 'en'}, {language: 'ro'}];
    await save(directory + '/run-state/claimed.json', {task: {...context, type: 'scriptahub.edit', requests}});
    for (const {language} of requests) {
      const file = language + '.html', candidateHtml = 'package/' + file, baselineHtml = language + '-original.html', changesPath = language + '-changes.json';
      const candidate = '<main>Revised ' + language + '</main>', baseline = '<main>Original ' + language + '</main>';
      await fs.writeFile(candidateHtml, candidate);
      await fs.writeFile(baselineHtml, baseline);
      await save(changesPath, [{before: 'Original', after: 'Revised'}]);
      const changesSha256 = digest(await fs.readFile(changesPath)), baselineSha256 = digest(baseline);
      const report = language + '-audit.json';
      await save(report, {scope:'edition_layout_regression', status:'passed', autoCorrect:false, errorFindings:0, existingFindings:0, findings:[],
        candidate:{file:path.join(root, candidateHtml), sha256:digest(candidate)},
        baseline:{file:path.join(root, baselineHtml), sha256:baselineSha256},
        inputs:[{file:path.join(root, changesPath), sha256:changesSha256}]});
      readers[language] = {fullContent: file};
      files.push({path:file, size:Buffer.byteLength(candidate), sha256:digest(candidate)});
      editions.push({language, baselineHtml, baselineSha256, candidateHtml, changesPath, changesSha256});
      audits.push({language, report});
    }
    const collection = JSON.stringify(combineCollections([{id:context.bookId, editions:readers, keywordIds:[], keywords:emptyKeywords}]));
    await fs.writeFile('package/collection.json', collection);
    files.push({path:'collection.json', size:Buffer.byteLength(collection), sha256:digest(collection)});
    await save('inventory.json', {executionId:context.executionId, baseCommit:commit, files});
    await save('edition-plan.json', {editions});
    const input = {...context, directory, packageRoot:'package', inventory:'inventory.json', editionPlan:'edition-plan.json',
      catalogue:'https://github.com/example/books/blob/main/collection.json', branch:'main', finalize:true};
    await assert.rejects(verifyPackage({...input, audits:audits.slice(0, 1)}), /cover every required edition/);
    await save('edition-plan.json', {editions:editions.slice(0, 1)});
    await assert.rejects(verifyPackage({...input, audits:audits.slice(0, 1)}), /omits a language/);
    await save('edition-plan.json', {editions});
    const approved = await verifyPackage({...input, audits});
    assert.equal(approved.audit.scope, 'edition_layout_regression');
    const validation = JSON.parse(await fs.readFile(approved.approval.validation));
    assert.deepEqual(validation.reports.map(report => report.language), ['en', 'ro']);
    assert.equal(validation.inventorySha256, digest(await fs.readFile(approved.approval.inventory)));
    await assert.rejects(publishPackage(() => assert.fail('unexpected remote call'),
      {...input, ...approved.approval, catalogue:'https://github.com/example/other/blob/main/collection.json'}), /destination differs/);
    await fs.appendFile(editions[1].changesPath, '\n');
    await assert.rejects(verifyPackage({...input, audits}), /pinned baseline and change plan for ro/);
    await fs.appendFile(approved.approval.inventory, '\n');
    await assert.rejects(publishPackage(() => assert.fail('unexpected remote call'), {...input, ...approved.approval}), /differs from the final validation/);
  } finally {
    process.env.PATH = previousPath;
  }
}));

test('editorial, review and final validation preserve the pinned source and accepted output receipt', async () => inRun(async () => {
  const pinned={...context,editorialSource:{path:'tasks/task-one/sources/book.html',sha256:'a'.repeat(64),language:'en'},editorialResults:{summary:{output:'tasks/task-one/editorial/comprehensive-summary.html',sha256:'b'.repeat(64)}}};
  for (const step of ['resume-book','process-content','translate-resources','review-correct','validate-final']) {
    const saved=await writeHandoff({step,directory:'tasks/task-one',context:pinned});
    const actual=JSON.parse(await fs.readFile(saved.path));
    assert.equal(actual.step,step);assert.deepEqual(actual.context,pinned);
  }
}));

test('many direct editions keep their accepted evidence in separate files', async () => inRun(async () => {
  const directory = 'tasks/task-one';
  const languages = ['en','ro','fr','de','es','it','pl','pt'];
  const manuscriptEditions = Object.fromEntries(languages.map((language, index) => [language, {
    language, path:`${directory}/sources/${language}/index.html`, sha256:String(index).repeat(64),
    referencePdf:`${directory}/sources/${language}/book.pdf`, referencePdfSha256:'e'.repeat(64),
  }]));
  const pinned = {...context, editorialSource:manuscriptEditions.en, manuscriptEditions};
  const roles = ['comprehensive-summary','relevant-keywords','marketing-summary','short-description'];
  const manuscriptEditorial = Object.fromEntries(languages.map(language => [language, {
    editorialResults:Object.fromEntries(roles.map(role => [role, {
      output:`${directory}/editorial/${language}/${role}.html`, outputSha256:'a'.repeat(64),
      sourcePath:manuscriptEditions[language].path, sourceSha256:manuscriptEditions[language].sha256,
      job:`${directory}/editorial-jobs/${language}/${role}`,
      receipt:`${directory}/editorial/${language}/${role}.json`, receiptSha256:'b'.repeat(64),
      parameters:{language, editorialRequirements:'detail '.repeat(40)},
    }])),
  }]));
  const saved = await writeHandoff({directory, step:'short-description', context:{...pinned, manuscriptEditorial}});
  const read = async () => JSON.parse(await fs.readFile(saved.path)).context;
  const first = await read();
  assert.deepEqual(Object.keys(first.manuscriptEditorial.ro).sort(),['path','sha256']);
  assert.deepEqual(await readManuscriptEditorial(first,directory,'ro'), manuscriptEditorial.ro);
  const addition = {output:'updated Romanian summary'};
  await writeHandoff({directory, step:'short-description', context:{...pinned, manuscriptEditorial:{
    ro:{editorialResults:{'comprehensive-summary':addition}},
  }}});
  const revised = await read();
  assert.deepEqual(revised.manuscriptEditorial.en, first.manuscriptEditorial.en);
  assert.deepEqual(await readManuscriptEditorial(revised,directory,'ro'), {editorialResults:{
    ...manuscriptEditorial.ro.editorialResults, 'comprehensive-summary':addition,
  }});
  await fs.appendFile(revised.manuscriptEditorial.ro.path, '\n');
  await assert.rejects(readManuscriptEditorial(revised,directory,'ro'), /Editorial evidence changed for ro/);
}));

test('each published manuscript edition requires its own pinned PDF and reader audit', {skip: process.platform !== 'linux'}, async () => inRun(async root => {
  const previousPath = process.env.PATH;
  const directory = 'tasks/task-one';
  const packageRoot = directory + '/package';
  const save = (file, value) => fs.writeFile(file, JSON.stringify(value));
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  const editions = {};
  const manuscriptEditions = {};
  const sourceAudits = {};
  const audits = [];
  const files = [];
  const stage = async (file, content) => {
    await fs.writeFile(packageRoot + '/' + file, content);
    files.push({path:file, size:Buffer.byteLength(content), sha256:digest(content)});
  };
  try {
    await fs.mkdir('bin');
    await fs.writeFile('bin/git', `#!${process.execPath}\nprocess.stdout.write('${'a'.repeat(40)}\\trefs/heads/main\\n');\n`, {mode: 0o700});
    process.env.PATH = path.join(root, 'bin') + path.delimiter + previousPath;
    for (const language of ['en', 'ro']) {
      const sourceDir = directory + '/sources/' + language;
      const validationDir = directory + '/validation/' + language;
      const reader = language + '.html';
      const html = '<main>' + language + '</main>';
      const pdf = 'PDF fixture ' + language;
      const source = sourceDir + '/source.html';
      const referencePdf = sourceDir + '/source.pdf';
      await fs.mkdir(sourceDir, {recursive: true});
      await fs.mkdir(validationDir, {recursive: true});
      await fs.mkdir(packageRoot, {recursive: true});
      await fs.writeFile(source, html);
      await fs.writeFile(referencePdf, pdf);
      const book = language + '-book.html';
      const shortContent = language + '-summary.html';
      await stage(reader, html);
      await stage(book, '<main>Book</main>');
      await stage(shortContent, '<meta name="summary-generator" content="comprehensivesummary-skill">');
      editions[language] = {fullContent:reader, book, shortContent};
      manuscriptEditions[language] = {language, path: source, sha256: digest(html), referencePdf, referencePdfSha256: digest(pdf)};
      const candidate = path.join(root, packageRoot, reader);
      const report = validationDir + '/report.json';
      const result = {status:'passed', scope:'layout_and_structure', autoCorrect:false, findings:[], documents:[{file:candidate}]};
      await save(report, result);
      await save(validationDir + '/job.json', {result, inputs:[
        {file:candidate, sha256:digest(html)}, {file:path.join(root, referencePdf), sha256:digest(pdf)}
      ]});
      audits.push({language, report});
      const early = directory + '/validation/source-layout/' + language;
      await fs.mkdir(early, {recursive:true});
      const earlyReport = early + '/report.json';
      const sourceDocument = path.join(root, source);
      const earlyResult = {...result, documents:[{file: sourceDocument}]};
      const job = early + '/job.json';
      const style = 'p { color: green }';
      const styleFile = sourceDir + '/' + language + '.css';
      await fs.writeFile(styleFile, style);
      await stage(language + '.css', style);
      await save(earlyReport, earlyResult);
      await save(job, {result:earlyResult, inputs:[
        {file:sourceDocument, sha256:digest(html)}, {file:path.join(root, referencePdf), sha256:digest(pdf)},
        {file:path.join(root, styleFile), sha256:digest(style)},
      ]});
      sourceAudits[language] = {path:earlyReport, sha256:digest(await fs.readFile(earlyReport)), jobSha256:digest(await fs.readFile(job))};
    }
    const {language, path: source, sha256} = manuscriptEditions.en;
    await writeHandoff({step:'prepare-manuscript', directory, context:{
      ...context, editorialSource:{language, path:source, sha256}, manuscriptEditions, sourceAudits
    }});
    await save(directory + '/run-state/claimed.json', {task:{...context, type:'scriptahub.manuscript'}});
    await assert.rejects(writeHandoff({step:'review-correct', directory, context:{
      ...context, manuscriptEditions:{...manuscriptEditions, ro:{...manuscriptEditions.ro, referencePdfSha256:'0'.repeat(64)}}
    }}), /Manuscript editions are pinned/);
    const aboutBook = {en:['English edition'], ro:['Ediție în română']};
    const collection = JSON.stringify(combineCollections([{id:context.bookId, editions, aboutBook, keywordIds:[], keywords:emptyKeywords}]));
    await stage('collection.json', collection);
    const inventory = directory + '/inventory.json';
    await save(inventory, {executionId:context.executionId, baseCommit:null, files});
    const input = {...context, directory, packageRoot, inventory, finalize:true,
      catalogue:'https://github.com/example/books/blob/main/collection.json', branch:'main'};
    await assert.rejects(verifyPackage({...input, audits:[audits[0]]}), /cover every required edition/);
    await assert.rejects(verifyPackage({...input, audits:[audits[0], {...audits[1], report:audits[0].report}]}),
      /does not cover the published source edition: ro/);
    assert.ok((await verifyPackage({...input, audits})).approval);
    const earlyAudits = Object.entries(sourceAudits).map(([language, reference]) => ({language, report:reference.path}));
    assert.ok((await verifyPackage({...input, audits:earlyAudits})).approval);
    const changedStyle = 'p { color: orange }';
    await fs.writeFile(packageRoot + '/ro.css', changedStyle);
    Object.assign(files.find(file => file.path === 'ro.css'), {size:Buffer.byteLength(changedStyle), sha256:digest(changedStyle)});
    await save(inventory, {executionId:context.executionId, baseCommit:null, files});
    await assert.rejects(verifyPackage({...input, audits:earlyAudits}), /resources changed for ro/);
    assert.ok((await verifyPackage({...input, audits:[earlyAudits[0], audits[1]]})).approval);
    await fs.appendFile(manuscriptEditions.ro.referencePdf, 'changed');
    await assert.rejects(verifyPackage({...input, audits}), /Pinned manuscript source changed for ro/);
  } finally {
    process.env.PATH = previousPath;
  }
}));

test('a pinned editorial source survives a partial handoff and cannot be replaced', async () => inRun(async () => {
  const editorialSource={path:'tasks/task-one/sources/book.html',sha256:'a'.repeat(64),language:'en'};
  await writeHandoff({step:'process-content',directory:'tasks/task-one',context:{...context,editorialSource}});
  const saved=await writeHandoff({step:'review-correct',directory:'tasks/task-one',context});
  assert.deepEqual(JSON.parse(await fs.readFile(saved.path)).context.editorialSource,editorialSource);
  for (const change of [{path:'tasks/task-one/editorial/comprehensive-summary.html'},{sha256:'b'.repeat(64)},{language:'ro'}]) {
    await assert.rejects(writeHandoff({step:'review-correct',directory:'tasks/task-one',context:{...context,editorialSource:{...editorialSource,...change}}}),/source is pinned/);
    assert.deepEqual(JSON.parse(await fs.readFile(saved.path)).context.editorialSource,editorialSource);
  }
}));
