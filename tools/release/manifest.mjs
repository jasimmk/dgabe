import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { flags, isMain, stableVersion } from './version.mjs';
import { DESKTOP_TARGETS, runCommand, sourceCommit } from './package-desktop.mjs';

export function expectedAssets(version) {
  stableVersion(version);
  const assets = Object.entries(DESKTOP_TARGETS).map(([target, type]) => ({
    file: `dangerous-gabe-${version}-${target}.${type.extension}`, target, signing: type.signing,
  }));
  assets.push({ file: `dangerous-gabe-${version}-ios-iphone-ipad-unsigned.zip`, target: 'aarch64-apple-ios', signing: 'unsigned' });
  assets.push({ file: `dangerous-gabe-${version}-ios-simulator-arm64.zip`, target: 'aarch64-apple-ios-sim', signing: 'ad-hoc' });
  return assets;
}

export function archiveMetadata(path, run = runCommand) {
  const tar = path.endsWith('.tar.gz');
  const listing = run(tar ? 'tar' : 'unzip', tar ? ['-tzf', path] : ['-Z1', path]);
  const entries = listing.split(/\r?\n/).filter(Boolean);
  if (entries.some(entry => entry.startsWith('/') || entry.includes('\\') || entry.split('/').includes('..') || entry.includes('\0'))) {
    throw new Error(`Unsafe archive path in ${basename(path)}`);
  }
  const metadataPaths = entries.filter(entry => entry === 'release-metadata.json' || entry.endsWith('/release-metadata.json'));
  if (metadataPaths.length !== 1) throw new Error(`Expected one embedded release-metadata.json in ${basename(path)}`);
  const contents = run(tar ? 'tar' : 'unzip', tar ? ['-xOzf', path, '--', metadataPaths[0]] : ['-p', path, metadataPaths[0]]);
  const metadata = JSON.parse(contents);
  if (metadata.schemaVersion !== 1) throw new Error('Unsupported release metadata schema');
  return metadata;
}

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Release directory contains a symlink: ${entry.name}`);
    if (entry.isDirectory()) files.push(...await filesUnder(path));
    else if (entry.isFile()) files.push(path);
  }
  return files;
}

async function sha256(path) {
  const digest = createHash('sha256');
  for await (const data of createReadStream(path)) digest.update(data);
  return digest.digest('hex');
}

export async function validateArtifacts({ version, directory, sourceCommit: requestedCommit }) {
  stableVersion(version);
  directory = resolve(directory);
  const commit = sourceCommit(requestedCommit);
  const required = expectedAssets(version);
  const optional = { file: `dangerous-gabe-${version}-ios-iphone-ipad.ipa`, target: 'aarch64-apple-ios', signing: 'developer-signed' };
  const expected = new Map([...required, optional].map(asset => [asset.file, asset]));
  const archives = (await filesUnder(directory)).filter(path => /\.(zip|tar\.gz|ipa)$/i.test(path));
  const found = new Map();
  for (const path of archives) {
    const name = basename(path);
    if (!expected.has(name)) throw new Error(`Unexpected asset or version mismatch: ${name}`);
    if (found.has(name)) throw new Error(`Duplicate release asset: ${name}`);
    found.set(name, path);
  }
  for (const asset of required) if (!found.has(asset.file)) throw new Error(`Missing required release asset: ${asset.file}`);
  const assets = [];
  for (const [name, path] of [...found].sort(([left], [right]) => left.localeCompare(right))) {
    const size = (await stat(path)).size;
    if (!size) throw new Error(`Empty release asset: ${name}`);
    const metadata = archiveMetadata(path);
    const definition = expected.get(name);
    if (metadata.version !== version || metadata.target !== definition.target || metadata.signing !== definition.signing) {
      throw new Error(`Embedded version/target/signing mismatch: ${name}`);
    }
    if (commit && metadata.sourceCommit !== commit) throw new Error(`Source commit mismatch: ${name}`);
    if (metadata.sourceCommit !== undefined) sourceCommit(metadata.sourceCommit);
    assets.push({ ...definition, bytes: size, sha256: await sha256(path), ...(metadata.sourceCommit ? { sourceCommit: metadata.sourceCommit } : {}) });
  }
  const manifest = { schemaVersion: 1, version, ...(commit ? { sourceCommit: commit } : {}), assets };
  await writeFile(join(directory, 'SHA256SUMS.txt'), assets.map(asset => `${asset.sha256}  ${asset.file}\n`).join(''));
  await writeFile(join(directory, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (isMain(import.meta.url)) {
  try { console.log(JSON.stringify(await validateArtifacts(flags(process.argv.slice(2), ['version', 'directory'])))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
