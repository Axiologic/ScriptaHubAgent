import { imageReceipt, locateSkills, captureRuntime, RUNTIME_PATH } from './processing-source.mjs';

// The sandbox runs a verified snapshot of the mounted checkout's skill source; the image only supplies the
// installed dependencies its dependencies.json receipt names. Every call recaptures, so runtimeId changes with
// any checkout edit. view holds service paths and must never leave the service.
export async function processingRuntime({runtimeRoot=RUNTIME_PATH,codeRoot,workspace,skillsDir,snapshotRoot,pinned=new Set(),identity,hook,limits,pathMode}={}) {
  if(typeof codeRoot!=='string'||typeof snapshotRoot!=='string')throw Object.assign(new Error('ScriptaHub processing runtime is unavailable'),{status:503});
  const image=await imageReceipt(runtimeRoot);
  const {repoRoot,skillsRoot}=locateSkills({codeRoot,workspace,skillsDir,identity});
  return captureRuntime({runtimeRoot,codeRoot,skillsRoot,repoRoot,image,snapshotRoot,pinned,hook,limits,pathMode});
}
