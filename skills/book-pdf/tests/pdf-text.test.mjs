import test from 'node:test';
import assert from 'node:assert/strict';
import {hasReaderWords, readerWords} from '../scripts/pdf-text.mjs';

test('accepts a word reflowed across PDF lines and preserves compound hyphens', () => {
  const source = readerWords('Costești-Cetățuie primaryresearchmethodologyandinterpretation');
  assert.ok(hasReaderWords(source, 'Costești-Cetățuie primar\nyresearchmethodologyandinterpret\nation'));
  assert.ok(hasReaderWords(source, 'Costești-\nCetățuie primaryresearchmethodologyandinterpretation'));
  assert.equal(hasReaderWords(source, 'CosteștiCetățuie primaryresearchmethodologyandinterpretation'), false);
  assert.equal(hasReaderWords(source, 'Costești Cetățuie primaryresearchmethodologyandinterpretation'), false);
  assert.equal(hasReaderWords(source, 'Costești-Cetățuie primar\nandinterpret\nation'), false);
});

test('reflowed fragments are counted only once', () => {
  assert.equal(hasReaderWords(readerWords('manuscript manuscript'), 'manu\nscript'), false);
  assert.equal(hasReaderWords(readerWords('manuscript'), 'manu script'), false);
  assert.equal(hasReaderWords(readerWords('manuscript'), 'manu\n\nscript'), false);
  assert.equal(hasReaderWords(readerWords('manu manuscript'), 'manu\nscript'), false);
  assert.ok(hasReaderWords(readerWords('manu manuscript'), 'manu. manu\nscript'));
});
