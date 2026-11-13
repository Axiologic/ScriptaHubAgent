import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {verifyProcessingFile} from './processing-files.mjs';

const LIMIT=64*1024*1024, TTL=24*60*60*1000;
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
export function createInputCacheTable(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS processing_input_cache (
    execution_id TEXT NOT NULL, executor TEXT NOT NULL, sha256 TEXT NOT NULL, size INTEGER NOT NULL,
    touched INTEGER NOT NULL, PRIMARY KEY(execution_id,executor,sha256)
  )`);
}
export const inputCacheBytes=db=>db.prepare('SELECT COALESCE(SUM(size),0) AS bytes FROM processing_input_cache').get().bytes;

// Disposable, bounded copies. Workers never mount this directory. A blob belongs
// to exactly one verified executor and execution, even when its hash is shared.
export class ProcessingInputCache {
  constructor(dataDir,db) {
    this.root=path.join(dataDir,'processing-inputs');this.db=db;
    createInputCacheTable(db);
    fs.mkdirSync(this.root,{recursive:true,mode:0o700});
    const stat=fs.lstatSync(this.root);
    if(!stat.isDirectory()||stat.isSymbolicLink())throw new Error('Invalid processing input cache');
    fs.chmodSync(this.root,0o700);
    const verified=fs.lstatSync(this.root);
    if(!verified.isDirectory()||verified.isSymbolicLink())throw new Error('Invalid processing input cache');
    this.identity={dev:verified.dev,ino:verified.ino};
    const expected=new Set();
    for(const row of this.rows()) {
      const name=this.name(row);expected.add(name);
      try {verifyProcessingFile(this.root,{path:name,size:row.size,sha256:row.sha256});}
      catch {this.remove(row);}
    }
    // A crash may leave a copy without its index entry. Cache bytes are optional,
    // so discard only recognized flat blobs/temporary files, never follow links.
    for(const name of fs.readdirSync(this.root))if(!expected.has(name)) {
      if(!/^[a-f0-9]{64}-[a-f0-9]{64}(?:\.[a-f0-9-]+\.tmp)?$/.test(name))throw new Error('Unknown processing cache entry');
      const st=fs.lstatSync(path.join(this.root,name));
      if(st.isDirectory())throw new Error('Invalid processing cache entry');
      fs.unlinkSync(path.join(this.root,name));
    }
    this.prune();
  }
  checkRoot() {
    const st=fs.lstatSync(this.root);
    if(!st.isDirectory()||st.isSymbolicLink()||st.dev!==this.identity.dev||st.ino!==this.identity.ino)throw new Error('Processing input cache changed');
  }
  rows() {return this.db.prepare('SELECT * FROM processing_input_cache ORDER BY touched').all();}
  name(row) {return hash(row.executor+'\0'+row.execution_id)+'-'+row.sha256;}
  remove(row) {
    this.checkRoot();
    try {fs.unlinkSync(path.join(this.root,this.name(row)));}catch(error){if(error.code!=='ENOENT')throw error;}
    this.db.prepare('DELETE FROM processing_input_cache WHERE execution_id=? AND executor=? AND sha256=?').run(row.execution_id,row.executor,row.sha256);
  }
  prune(budget=LIMIT) {
    this.checkRoot();let bytes=inputCacheBytes(this.db);
    for(const row of this.rows()) {
      const task=this.db.prepare(`SELECT t.state FROM task_executions e JOIN tasks t ON t.id=e.task_id WHERE e.id=?`).get(row.execution_id);
      if(bytes<=Math.min(LIMIT,budget)&&Date.now()-row.touched<TTL&&task?.state==='running')continue;
      try {this.remove(row);} catch(error) {if(error.code!=='ENOENT')throw error;this.db.prepare('DELETE FROM processing_input_cache WHERE execution_id=? AND executor=? AND sha256=?').run(row.execution_id,row.executor,row.sha256);}
      bytes-=row.size;
    }
  }
  retain(executor,executionId,root,entries,budget) {
    this.prune(budget);
    for(const entry of entries) {
      if(!entry.size||entry.size>Math.min(LIMIT,budget))continue;
      const row={executor,execution_id:executionId,sha256:entry.sha256,size:entry.size};
      const existing=this.db.prepare('SELECT * FROM processing_input_cache WHERE execution_id=? AND executor=? AND sha256=?').get(executionId,executor,entry.sha256);
      if(existing)continue;
      verifyProcessingFile(root,entry);
      if(inputCacheBytes(this.db)+entry.size>Math.min(LIMIT,budget))this.prune(Math.min(LIMIT,budget)-entry.size);
      const name=this.name(row),temp=name+'.'+crypto.randomUUID()+'.tmp';
      try {
        this.checkRoot();fs.copyFileSync(path.join(root,entry.path),path.join(this.root,temp),fs.constants.COPYFILE_EXCL);
        verifyProcessingFile(this.root,{...entry,path:temp});
        fs.renameSync(path.join(this.root,temp),path.join(this.root,name));
        try {this.db.prepare('INSERT INTO processing_input_cache VALUES(?,?,?,?,?)').run(executionId,executor,entry.sha256,entry.size,Date.now());}
        catch(error){fs.unlinkSync(path.join(this.root,name));throw error;}
      } finally {try {fs.unlinkSync(path.join(this.root,temp));}catch(error){if(error.code!=='ENOENT')throw error;}}
    }
  }
  restore(executor,executionId,root,entry) {
    this.checkRoot();
    const row=this.db.prepare('SELECT * FROM processing_input_cache WHERE execution_id=? AND executor=? AND sha256=? AND size=?').get(executionId,executor,entry.sha256,entry.size);
    if(!row)return false;
    try {verifyProcessingFile(this.root,{...entry,path:this.name(row)});} catch {try {this.remove(row);}catch(error){if(error.code!=='ENOENT')throw error;}return false;}
    // Create and verify real parents before copying; no hardlinks into a worker.
    let parent=root;
    for(const part of entry.path.split('/').slice(0,-1)) {
      parent=path.join(parent,part);try {fs.mkdirSync(parent,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}
      const st=fs.lstatSync(parent);if(!st.isDirectory()||st.isSymbolicLink())throw new Error('Invalid processing directory');
    }
    try {fs.copyFileSync(path.join(this.root,this.name(row)),path.join(root,entry.path),fs.constants.COPYFILE_EXCL);}
    catch(error){if(error.code==='EEXIST')return false;throw error;}
    verifyProcessingFile(root,entry);
    this.db.prepare('UPDATE processing_input_cache SET touched=? WHERE execution_id=? AND executor=? AND sha256=?').run(Date.now(),executionId,executor,entry.sha256);
    return true;
  }
}
