export function publicationConfig(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !['authorName','authorEmail'].includes(key))
    || typeof value.authorName !== 'string' || !value.authorName.trim() || value.authorName.length > 120 || /[\r\n<>\0]/.test(value.authorName)
    || typeof value.authorEmail !== 'string' || !/^[^\s<>@]+@[^\s<>@]+$/.test(value.authorEmail) || value.authorEmail.length > 254 || /[\0\r\n]/.test(value.authorEmail)) {
    throw new Error('Provide a Git author name and email for ScriptaHub publication');
  }
  return {authorName:value.authorName.trim(), authorEmail:value.authorEmail};
}
