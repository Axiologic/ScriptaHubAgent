#!/usr/bin/env python3
"""Migrate and validate published books in content-only repositories."""
from __future__ import annotations

import argparse
import base64
import hashlib
import html
from html.parser import HTMLParser
import json
import mimetypes
from pathlib import Path, PurePosixPath
import re
from urllib.parse import unquote_to_bytes, urljoin
from urllib.request import urlopen

LANGUAGES = ('en', 'fr', 'de', 'es', 'pt', 'it', 'ro', 'pl')
DATA = re.compile(r'''data:(image/[\w.+-]+|font/[\w.+-]+|application/(?:font-[\w.+-]+|x-font-[\w.+-]+|vnd.ms-fontobject|octet-stream))(;[\w=.+-]+)*,([^\s"'<>)]*)''', re.I)
EXTENSIONS = {'image/svg+xml': '.svg', 'font/woff': '.woff', 'font/woff2': '.woff2', 'font/ttf': '.ttf', 'font/otf': '.otf', 'application/font-woff': '.woff', 'application/x-font-ttf': '.ttf', 'application/x-font-opentype': '.otf'}

def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()

def write_json(path: Path, value) -> str:
    data = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return digest(data)

def safe(value: str) -> str:
    if not isinstance(value, str) or not value or value.startswith('/') or any(p in ('', '.', '..') for p in value.split('/')) or any(c in value for c in '\\?#%\0'):
        raise ValueError(f'Unsafe resource path: {value}')
    return value

class Text(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []
        self.skip = 0
    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style'):
            self.skip += 1
    def handle_endtag(self, tag):
        if tag in ('script', 'style') and self.skip:
            self.skip -= 1
    def handle_data(self, data):
        if not self.skip:
            self.parts.append(data)

def text_digest(value: str) -> str:
    parser = Text()
    parser.feed(value)
    return digest(''.join(parser.parts).encode())

class Store:
    def __init__(self, root: Path):
        self.root = root
        self.paths = {}
        self.bytes = 0
        for folder in ('content', 'assets/shared'):
            for file in (root / folder).glob('*'):
                if file.is_file():
                    self.paths[file.stem] = file.relative_to(root).as_posix()
                    self.bytes += file.stat().st_size

    def put(self, data: bytes, extension: str) -> str:
        sha = digest(data)
        if sha in self.paths:
            return self.paths[sha]
        extension = {'.jpeg': '.jpg', '.htm': '.html'}.get(extension.lower(), extension.lower())
        if not re.fullmatch(r'\.[a-z0-9]{1,10}', extension):
            extension = '.bin'
        folder = 'content' if extension == '.html' else 'assets/shared'
        relative = f'{folder}/{sha}{extension}'
        file = self.root / relative
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(data)
        self.paths[sha] = relative
        self.bytes += len(data)
        return relative

def extract_assets(data: bytes, relative: str, store: Store) -> tuple[bytes, dict[str, str]]:
    if PurePosixPath(relative).suffix.lower() not in ('.html', '.htm', '.css', '.svg'):
        return data, {}
    try:
        before = data.decode('utf-8')
    except UnicodeDecodeError:
        return data, {}
    added = {}
    def replace(match):
        mime = match[1].lower()
        try:
            payload = base64.b64decode(match[3], validate=True) if ';base64' in match[0].split(',', 1)[0].lower() else unquote_to_bytes(html.unescape(match[3]))
        except (ValueError, base64.binascii.Error):
            return match[0]
        if not payload:
            return match[0]
        if mime == 'application/octet-stream':
            extension = {b'wOFF': '.woff', b'wOF2': '.woff2', b'OTTO': '.otf', b'\x00\x01\x00\x00': '.ttf'}.get(payload[:4])
            if not extension:
                return match[0]
        else:
            extension = EXTENSIONS.get(mime) or mimetypes.guess_extension(mime) or '.bin'
        target = store.put(payload, extension)
        name = '__shared_' + PurePosixPath(target).name
        alias = (PurePosixPath(relative).parent / name).as_posix()
        added[alias] = target
        return name
    if PurePosixPath(relative).suffix.lower() in ('.html', '.htm', '.svg'):
        parts = re.split(r'(<script\b[^>]*>.*?</script\s*>)', before, flags=re.I | re.S)
        after = ''.join(part if part.lower().startswith('<script') else DATA.sub(replace, part) for part in parts)
    else:
        after = DATA.sub(replace, before)
    if PurePosixPath(relative).suffix.lower() in ('.html', '.htm') and text_digest(before) != text_digest(after):
        raise ValueError(f'Embedded-asset extraction changed document text: {relative}')
    return after.encode('utf-8') if after != before else data, added

def migrate(source: Path, output: Path, ids: set[str] | None, repository: str, commit: str, external_index: Path | None = None, external_base: str | None = None):
    if (output / 'collection.json').exists():
        raise ValueError('Choose a new output directory for migration')
    collection = json.loads((source / 'collection.json').read_text())
    books = collection['books']
    if ids:
        books = [book for book in books if book['id'] in ids]
        if {book['id'] for book in books} != ids:
            raise ValueError('Some requested book IDs are missing')
    external = {entry['id']: entry for entry in json.loads(external_index.read_text())['books']} if external_index else {}
    if external and not external_base:
        raise ValueError('External content needs an immutable/public base URL')
    store = Store(output)
    entries, original_bytes, original_files, removed_pages, extracted = [], 0, 0, 0, 0
    for book in books:
        directory = safe(book['directory'])
        root = source / directory
        manifest = json.loads((root / 'manifest.json').read_text())
        if manifest['id'] != book['id']:
            raise ValueError(f'Book identity mismatch: {directory}')
        if book['id'] in external:
            entries.append({**external[book['id']], 'baseUrl': external_base})
            continue
        resources, originals = {}, {}
        history = json.loads((root / 'editions.json').read_text())
        for file in sorted(root.rglob('*')):
            if not file.is_file():
                continue
            if file.is_symlink():
                raise ValueError(f'Published content contains a symlink: {file}')
            relative = safe(file.relative_to(root).as_posix())
            original_bytes += file.stat().st_size
            original_files += 1
            if relative in ('manifest.json', 'editions.json'):
                continue
            if relative == 'Animation/index.html' or any(relative == f'{code}/book.html' for code in LANGUAGES):
                removed_pages += 1
                continue
            data = file.read_bytes()
            original_sha = digest(data)
            data, embedded = extract_assets(data, relative, store)
            extracted += len(embedded)
            for alias, target in embedded.items():
                if alias in resources and resources[alias] != target:
                    raise ValueError(f'Resource alias collision: {alias}')
                resources[alias] = target
            target = store.put(data, file.suffix)
            if relative in resources and resources[relative] != target:
                raise ValueError(f'Resource alias collision: {relative}')
            resources[relative] = target
            originals[relative] = original_sha
        document = {
            'schemaVersion': 2, 'id': book['id'], 'legacyDirectory': directory,
            'metadata': manifest, 'history': history, 'resources': resources,
            'provenance': {'repository': repository, 'commit': commit, 'originalSha256': originals},
        }
        relative = f"books/{book['id']}/book.json"
        sha = write_json(output / relative, document)
        entries.append({'id': book['id'], 'path': relative, 'sha256': sha})
    index = {'schemaVersion': 2, 'bookCount': len(entries), 'books': entries}
    write_json(output / 'collection.json', index)
    report = {'books': len(entries), 'externalBooks': sum('baseUrl' in entry for entry in entries), 'originalFiles': original_files, 'originalBytes': original_bytes, 'sharedFiles': len(store.paths), 'sharedBytes': store.bytes, 'generatedPagesRemoved': removed_pages, 'embeddedAssetsExtracted': extracted}
    organize(output)
    return report

def read_document(root: Path, entry: dict, cache: dict | None = None):
    if entry.get('baseUrl'):
        url = urljoin(entry['baseUrl'], safe(entry['path']))
        if not url.startswith('https://'):
            raise ValueError('External content must use HTTPS')
        data = urlopen(url, timeout=60).read()
    else:
        data = (root / safe(entry['path'])).read_bytes()
    if digest(data) != entry['sha256']:
        raise ValueError(f"Metadata checksum mismatch: {entry['id']}")
    document = json.loads(data)
    if document['schemaVersion'] != 2 or document['id'] != entry['id'] or document['metadata']['id'] != entry['id']:
        raise ValueError('Invalid book document')
    return document

def organize(root: Path):
    """Give every book a readable directory while preserving all legacy aliases and bytes."""
    index = json.loads((root / 'collection.json').read_text())
    validate(root, external=False)
    books, objects, slugs, old_files = [], {}, set(), set()
    for entry in index['books']:
        if entry.get('baseUrl'):
            continue
        book = read_document(root, entry)
        slug = '-'.join(book['legacyDirectory'].split('/')[1:-1])
        if not re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', slug) or slug in slugs:
            raise ValueError(f'Non-unique readable book name: {slug}')
        slugs.add(slug)
        book['contentDirectory'] = f'books/{slug}'
        books.append((entry, book))
        old_files.add(entry['path'])
        for alias, target in book['resources'].items():
            data = (root / safe(target)).read_bytes()
            sha = digest(data)
            item = objects.setdefault(sha, {'data': data, 'references': []})
            item['references'].append((book, alias))
            old_files.add(target)
    occupied, planned = {}, {}
    for sha, item in sorted(objects.items()):
        references = item['references']
        # Prefer current English paths over historical copies and fallback language aliases.
        book, alias = min(references, key=lambda pair: (pair[1].startswith('edition-files/'), not pair[1].startswith('en/'), pair[0]['contentDirectory'], pair[1]))
        parts = PurePosixPath(alias)
        name = parts.name
        if name in ('cover.webp', 'cover.png', 'thumbnail.webp'):
            relative = 'assets/' + ('cover-source.png' if name == 'cover.png' else name)
        elif name.startswith('__shared_'):
            relative = 'assets/embedded-asset' + parts.suffix
        elif alias.startswith('Animation/'):
            relative = 'animation/' + alias.split('/', 1)[1]
        elif alias.startswith('edition-files/'):
            relative = 'editions/' + alias.split('/', 1)[1]
        elif name in ('full_content.html', 'short_content.html'):
            relative = str(parts.parent / ('full.html' if name == 'full_content.html' else 'summary.html'))
        else:
            relative = alias
        shared = len({b['id'] for b, _ in references}) > 1
        prefix = 'assets/shared' if shared else book['contentDirectory']
        if shared:
            relative = book['contentDirectory'].split('/')[-1] + '-' + PurePosixPath(relative).name
        target = prefix + '/' + relative
        number = 2
        while target in occupied and occupied[target] != sha:
            path = PurePosixPath(relative)
            target = prefix + '/' + str(path.with_name(f'{path.stem}-{number}{path.suffix}'))
            number += 1
        safe(target)
        occupied[target] = sha
        planned[target] = item['data']
        for document, old_alias in references:
            document['resources'][old_alias] = target
    # All source files have been read and validated before any managed path is replaced.
    for target, data in planned.items():
        destination = root / target
        if destination.exists() and target not in old_files and destination.read_bytes() != data:
            raise ValueError(f'Reorganization would overwrite an unrelated file: {target}')
    for target, data in planned.items():
        destination = root / target
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(data)
    new_files = set(planned)
    for entry, book in books:
        book['resourceChecksums'] = {target: digest(planned[target]) for target in sorted(set(book['resources'].values()))}
        entry['title'] = book['metadata'].get('title', {}).get('en', book['id'])
        entry['path'] = book['contentDirectory'] + '/book.json'
        fields = ('schemaVersion', 'id', 'contentDirectory', 'legacyDirectory', 'metadata', 'history', 'resources', 'resourceChecksums', 'provenance')
        book = {**{key: book[key] for key in fields if key in book}, **{key: value for key, value in book.items() if key not in fields}}
        entry['sha256'] = write_json(root / entry['path'], book)
        new_files.add(entry['path'])
    index = {'schemaVersion': 2, 'bookCount': len(index['books']), 'books': [
        {**({'title': entry['title']} if 'title' in entry else {}), **{key: value for key, value in entry.items() if key != 'title'}}
        for entry in sorted(index['books'], key=lambda entry: entry.get('title', entry['id']).lower())
    ]}
    write_json(root / 'collection.json', index)
    for old in old_files - new_files:
        file = root / old
        if file.exists():
            file.unlink()
    for directory in sorted((p for p in root.rglob('*') if p.is_dir() and '.git' not in p.parts), key=lambda p: len(p.parts), reverse=True):
        if not any(directory.iterdir()):
            directory.rmdir()
    return validate(root, external=False)

def validate(root: Path, external: bool = True):
    index = json.loads((root / 'collection.json').read_text())
    if index['schemaVersion'] != 2 or index['bookCount'] != len(index['books']):
        raise ValueError('Invalid content index')
    ids, directories, visited = set(), set(), set()
    for entry in index['books']:
        if entry['id'] in ids:
            raise ValueError('Duplicate book identity')
        ids.add(entry['id'])
        if entry.get('baseUrl') and not external:
            continue
        book = read_document(root, entry)
        directory = safe(book['legacyDirectory'])
        if directory in directories:
            raise ValueError('Duplicate legacy directory')
        directories.add(directory)
        if book['history']['bookId'] != book['id']:
            raise ValueError('Edition history identity changed')
        for relative, target in book['resources'].items():
            safe(relative); safe(target)
            if entry.get('baseUrl'):
                continue
            if target in visited:
                continue
            visited.add(target)
            file = root / target
            expected = book.get('resourceChecksums', {}).get(target)
            if expected is None and re.fullmatch(r'[a-f0-9]{64}', file.stem):
                expected = file.stem
            if expected is None or digest(file.read_bytes()) != expected:
                raise ValueError(f'Content checksum mismatch: {target}')
        for edition in book['metadata']['editions'].values():
            for key, relative in edition.items():
                if key != 'book' and relative not in book['resources']:
                    raise ValueError(f'Missing edition resource: {relative}')
        for edition in book['history']['editions']:
            paths = [*edition.get('pdf', {}).values(), *edition.get('covers', {}).values()]
            paths.extend(value for formats in edition.get('readers', {}).values() for value in formats.values())
            for relative in paths:
                if relative not in book['resources']:
                    raise ValueError(f'Historical resource lost: {relative}')
    return {'books': len(ids), 'localResources': len(visited)}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    migration = sub.add_parser('migrate')
    migration.add_argument('--source', type=Path, required=True)
    migration.add_argument('--output', type=Path, required=True)
    migration.add_argument('--ids', help='Comma-separated stable book IDs; omit for the whole collection')
    migration.add_argument('--repository', default='https://github.com/Axiologic/ScriptaHub.git')
    migration.add_argument('--commit', required=True)
    migration.add_argument('--external-index', type=Path)
    migration.add_argument('--external-base-url')
    check = sub.add_parser('check')
    check.add_argument('--root', type=Path, required=True)
    check.add_argument('--skip-external', action='store_true')
    organization = sub.add_parser('organize')
    organization.add_argument('--root', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'migrate':
        result = migrate(args.source, args.output, set(args.ids.split(',')) if args.ids else None, args.repository, args.commit, args.external_index, args.external_base_url)
    elif args.command == 'organize':
        result = organize(args.root)
    else:
        result = validate(args.root, not args.skip_external)
    print(json.dumps(result, ensure_ascii=False))

if __name__ == '__main__':
    main()
