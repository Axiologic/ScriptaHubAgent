import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';

// AMD64 is compiled by the image's pinned Rust build stage. Binary hashes are
// generated from that build, retained in its receipt and checked before install.
export async function installBuiltNative(root, config, platform, buildRoot = '/opt/scriptahub/native-build') {
  if (platform !== 'linux-x64') return;
  const receipt = JSON.parse(await fs.readFile(path.join(buildRoot, 'receipt.json'), 'utf8'));
  if (receipt.platform !== platform || receipt.sourceRevision !== config.nativeAssetSource.revision)
    throw new Error('Native build source or platform does not match the declared runtime');
  const integrityPath = path.join(root, 'skills/pdf2html/external/native/integrity.json');
  const integrity = JSON.parse(await fs.readFile(integrityPath, 'utf8'));
  for (const name of ['docling.node', 'lib/libpdfium.so']) {
    const bytes = await fs.readFile(path.join(buildRoot, platform, name));
    const actual = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
    if (JSON.stringify(actual) !== JSON.stringify(receipt.files[name])) throw new Error(`Native build checksum mismatch: ${name}`);
    const target = path.join(root, 'skills/pdf2html/external/native', platform, name);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
    integrity.files[`${platform}/${name}`] = actual;
  }
  await fs.cp(path.join(buildRoot, platform, 'notices'), path.join(root, 'skills/pdf2html/external/native', platform, 'notices'), { recursive: true });
  await fs.writeFile(integrityPath, JSON.stringify(integrity, null, 2) + '\n');
}
