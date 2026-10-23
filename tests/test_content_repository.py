import base64
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('content_repository', Path(__file__).resolve().parents[1] / 'tools/content_repository.py')
content = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(content)


class ContentRepositoryTest(unittest.TestCase):
    def test_identical_artwork_and_embedded_fonts_are_stored_once(self):
        with tempfile.TemporaryDirectory() as directory:
            store = content.Store(Path(directory))
            font = b'wOFFa preserved font payload'
            data = base64.b64encode(font).decode()
            source = f'<html><head><style>@font-face{{src:url("data:font/woff;base64,{data}")}}</style></head><body><p id="p">Original &amp; complete text.</p></body></html>'.encode()
            first, aliases_one = content.extract_assets(source, 'en/full_content.html', store)
            second, aliases_two = content.extract_assets(source, 'ro/full_content.html', store)
            self.assertEqual(first, second)
            self.assertEqual(content.text_digest(source.decode()), content.text_digest(first.decode()))
            self.assertEqual(list(aliases_one.values()), list(aliases_two.values()))
            self.assertNotIn(b'data:font/woff', first)
            self.assertEqual(len(store.paths), 1)
            path = next(iter(aliases_one.values()))
            self.assertEqual((Path(directory) / path).read_bytes(), font)
            self.assertEqual(store.put(font, '.bin'), path)

    def test_migration_retains_history_and_deduplicates_language_copies(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source, output = root / 'old', root / 'new'
            book_root = source / 'books/example/bk-example'
            (book_root / 'en').mkdir(parents=True)
            (book_root / 'ro').mkdir()
            manifest = {'id': 'bk-example', 'editions': {'en': {'book': 'en/book.html', 'fullContent': 'en/full_content.html', 'pdf': 'en/book.pdf'}, 'ro': {'book': 'ro/book.html', 'fullContent': 'ro/full_content.html'}}}
            history = {'bookId': 'bk-example', 'currentEdition': 'edition-1', 'editions': [{'id': 'edition-1', 'pdf': {'en': 'en/book.pdf'}}]}
            (book_root / 'manifest.json').write_text(json.dumps(manifest))
            (book_root / 'editions.json').write_text(json.dumps(history))
            for code in ('en', 'ro'):
                (book_root / code / 'book.html').write_text('generated UI')
                (book_root / code / 'full_content.html').write_text('<p>Same authored text.</p>')
                (book_root / code / 'cover.webp').write_bytes(b'artwork')
            (book_root / 'en/book.pdf').write_bytes(b'%PDF-preserved source')
            (source / 'collection.json').write_text(json.dumps({'books': [{'id': 'bk-example', 'directory': 'books/example/bk-example'}]}))
            result = content.migrate(source, output, None, 'source', 'abc')
            self.assertEqual(result['generatedPagesRemoved'], 2)
            document = json.loads((output / 'books/example/book.json').read_text())
            self.assertEqual(document['history'], history)
            self.assertEqual(document['resources']['en/cover.webp'], document['resources']['ro/cover.webp'])
            self.assertEqual(document['resources']['en/full_content.html'], document['resources']['ro/full_content.html'])
            self.assertNotIn('en/book.html', document['resources'])
            self.assertEqual(content.validate(output)['books'], 1)
            target = output / document['resources']['en/book.pdf']
            target.write_bytes(b'corrupted')
            with self.assertRaisesRegex(ValueError, 'checksum mismatch'):
                content.validate(output)


if __name__ == '__main__':
    unittest.main()
