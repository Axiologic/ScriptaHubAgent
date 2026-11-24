export const wordPattern = /[\p{L}\p{M}\p{N}]+(?:[-‐][\p{L}\p{M}\p{N}]+)*/gu;
const normalize = text => text.normalize('NFKC').replace(/[\u00ad\u200b\u2060]/g,'').toLowerCase();

export function readerWords(text) {
  return normalize(text).match(wordPattern) ?? [];
}

export function hasReaderWords(expected, extracted) {
  const text = normalize(extracted);
  const tokens = [...text.matchAll(wordPattern)].map(match => ({word:match[0], offset:match.index, used:false}));
  const available = new Map(), required = new Map();
  for (const word of expected) required.set(word,(required.get(word) ?? 0)+1);
  const lineBreaks = [];
  for (const [index, token] of tokens.entries()) {
    available.set(token.word,(available.get(token.word) ?? 0)+1);
    const next = tokens[index+1];
    if (!next) continue;
    const separator = text.slice(token.offset+token.word.length,next.offset).match(/^([-‐]?)[ \t]*\r?\n[ \t]*$/);
    if (separator) {
      token.lineEnd = separator[1];
      lineBreaks.push(index);
    }
  }
  const missing = [];
  for (const [word,count] of required) {
    for (let deficit=count-(available.get(word) ?? 0); deficit>0; deficit--) missing.push(word);
  }
  return missing.every(word => lineBreaks.some(start => {
    let end = start, combined = tokens[start].word;
    if (tokens[start].used) return false;
    // Poppler may break one printed word across physical lines. Rejoin only
    // consecutive unused fragments and retain any visible hyphen.
    while (combined.length < word.length && word.startsWith(combined) && tokens[end].lineEnd !== undefined) {
      const next = tokens[end+1];
      if (next.used) return false;
      combined += tokens[end].lineEnd + next.word;
      end++;
    }
    if (end === start || combined !== word) return false;
    const fragments = new Map();
    for (let index = start; index <= end; index++) {
      const fragment=tokens[index].word;
      fragments.set(fragment,(fragments.get(fragment) ?? 0)+1);
    }
    for (const [fragment,count] of fragments) {
      if (available.get(fragment)-count < (required.get(fragment) ?? 0)) return false;
    }
    for (const [fragment,count] of fragments) available.set(fragment,available.get(fragment)-count);
    for (let index = start; index <= end; index++) tokens[index].used = true;
    return true;
  }));
}
