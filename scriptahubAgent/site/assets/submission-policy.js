// Shared by the browser forms and the server. MB denotes decimal bytes.
export const uploadLimits = Object.freeze({ count: 8, fileBytes: 50_000_000, totalBytes: 100_000_000 });
export const submissionBodyLimit = uploadLimits.totalBytes + 1024 * 1024;

export function validateDocuments(files) {
  if (files.length > uploadLimits.count) throw new Error('Up to 8 documents are allowed.');
  let total = 0;
  for (const file of files) {
    if (!file || !Number.isSafeInteger(file.size) || file.size < 1 || file.size > uploadLimits.fileBytes) {
      throw new Error('Each document must contain data and be no larger than 50 MB.');
    }
    if (!/\.(pdf|doc|docx)$/i.test(file.name || '')) throw new Error('Only PDF, DOC and DOCX manuscripts are accepted');
    total += file.size;
  }
  if (total > uploadLimits.totalBytes) throw new Error('Documents must not exceed 100 MB in total.');
}

export function newSubmissionId() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
