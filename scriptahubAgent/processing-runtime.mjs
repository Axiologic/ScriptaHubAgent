import { imageReceipt, locateSkills, captureRuntime, RUNTIME_PATH } from './processing-source.mjs';

// The sandbox runs a verified snapshot of the mounted checkout's skill source; the image only supplies the
// installed dependencies its dependencies.json receipt names. Every call recaptures, so runtimeId changes with
// any checkout edit. view holds service paths and must never leave the service. The checkout descriptors opened
// by discovery are held for the whole capture and released here.
export async function processingRuntime({runtimeRoot=RUNTIME_PATH,codeRoot,workspace,skillsDir,snapshotRoot,pinned=new Set(),identity,hook,limits,pathMode}={}) {
  if(typeof codeRoot!=='string'||typeof snapshotRoot!=='string')throw Object.assign(new Error('ScriptaHub processing runtime is unavailable'),{status:503});
  const image=await imageReceipt(runtimeRoot);
  const located=await locateSkills({codeRoot,workspace,skillsDir,identity,pathMode});
  try {return await captureRuntime({runtimeRoot,located,image,snapshotRoot,pinned,hook,limits});}
  finally {await located.close();}
}
