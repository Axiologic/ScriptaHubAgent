// RoboWork bounds the entire JSON request, including base64 data and routing.
const callbackLimit = 65536;
export function uploadBlockSize(tool, metadata, remaining) {
  const agent = process.env.SCRIPTA_TASK_AGENT || 'scriptahubAgent';
  const overhead = Buffer.byteLength(JSON.stringify({agent,tool,payload:{...metadata,data:''}}));
  const capacity = Math.floor((callbackLimit - overhead) / 4) * 3;
  if (capacity < 1) throw new Error('Upload metadata exceeds the task callback request limit');
  return Math.min(65536, remaining, capacity);
}
