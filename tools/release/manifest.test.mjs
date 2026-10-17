import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expectedAssets, archiveMetadata, validateArtifacts } from './manifest.mjs';
import { runCommand, sourceCommit } from './package-desktop.mjs';

async function releaseFixture(t, change = () => {}) {
  const root = await mkdtemp(join(tmpdir(), 'gabe-manifest-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, 'dist');
  await mkdir(directory);
  const version = '1.2.3';
  for (const [index, asset] of expectedAssets(version).entries()) {
    const folder = `fixture-${index}`;
    const source = join(root, folder);
    await mkdir(source);
    const commit = sourceCommit();
    const metadata = { schemaVersion: 1, version, target: asset.target, signing: asset.signing,
      ...(commit ? { sourceCommit: commit } : {}) };
    change(metadata, index);
    await writeFile(join(source, 'release-metadata.json'), JSON.stringify(metadata));
    await writeFile(join(source, 'payload.txt'), 'packaging fixture, not an executable');
    const path = join(directory, asset.file);
    if (asset.file.endsWith('.tar.gz')) runCommand('tar', ['-czf', path, '-C', root, folder]);
    else runCommand('zip', ['-q', '-r', path, folder], { cwd: root });
  }
  return { root, directory, version };
}

test('complete seven-platform fixtures yield exact SHA256 checksums and versioned metadata', async t => {
  const options = await releaseFixture(t);
  const result = await validateArtifacts(options);
  assert.equal(result.version, options.version);
  assert.equal(result.assets.length, 7);
  const checksums = await readFile(join(options.directory, 'SHA256SUMS.txt'), 'utf8');
  const stored = JSON.parse(await readFile(join(options.directory, 'release-manifest.json'), 'utf8'));
  assert.deepEqual(stored, result);
  for (const asset of result.assets) {
    const bytes = await readFile(join(options.directory, asset.file));
    const expected = createHash('sha256').update(bytes).digest('hex');
    assert.equal(asset.sha256, expected);
    assert.equal(asset.bytes, bytes.length);
    assert.ok(checksums.includes(`${expected}  ${asset.file}\n`));
  }
});

test('missing assets block release without writing a partial manifest', async t => {
  const options = await releaseFixture(t);
  await rm(join(options.directory, expectedAssets(options.version)[6].file));
  await assert.rejects(validateArtifacts(options), /Missing required/);
  await assert.rejects(readFile(join(options.directory, 'release-manifest.json')), /ENOENT/);
});

test('empty and duplicate files cannot pass as complete releases', async t => {
  const options = await releaseFixture(t);
  const file = expectedAssets(options.version)[0].file;
  await mkdir(join(options.directory, 'duplicate'));
  await copyFile(join(options.directory, file), join(options.directory, 'duplicate', file));
  await assert.rejects(validateArtifacts(options), /Duplicate/);
  await rm(join(options.directory, 'duplicate'), { recursive: true });
  await writeFile(join(options.directory, file), '');
  await assert.rejects(validateArtifacts(options), /Empty/);
});

test('embedded version, target and signing claims must match the named asset', async t => {
  for (const field of ['version', 'target', 'signing']) {
    const options = await releaseFixture(t, (metadata, index) => { if (index === 0) metadata[field] = 'wrong'; });
    await assert.rejects(validateArtifacts(options), /mismatch/);
  }
});

test('unexpected versioned filenames and schema failures are rejected', async t => {
  const options = await releaseFixture(t);
  await writeFile(join(options.directory, 'dangerous-gabe-9.9.9-extra.zip'), 'unexpected');
  await assert.rejects(validateArtifacts(options), /Unexpected asset/);
  assert.throws(() => archiveMetadata('fixture.zip', (_command, args) => args[0] === '-Z1'
    ? 'root/release-metadata.json\n' : '{"schemaVersion":2}'), /schema/);
});

test('archive reader refuses traversal and ambiguous embedded manifests', () => {
  for (const listing of ['../release-metadata.json\n', '/release-metadata.json\n',
    'root/release-metadata.json\nother/release-metadata.json\n']) {
    assert.throws(() => archiveMetadata('fixture.zip', () => listing));
  }
  assert.throws(() => expectedAssets('1.2.3;exit'));
});

test('explicit source commit must match every embedded archive record', async t => {
  const commit = 'a'.repeat(40);
  const options = await releaseFixture(t, metadata => { metadata.sourceCommit = commit; });
  const manifest = await validateArtifacts({ ...options, sourceCommit: commit });
  assert.equal(manifest.sourceCommit, commit);
  assert.ok(manifest.assets.every(asset => asset.sourceCommit === commit));
  await assert.rejects(validateArtifacts({ ...options, sourceCommit: 'b'.repeat(40) }), /Source commit mismatch/);
});

test('an optional signed IPA must carry its own matching signing metadata', async t => {
  const options = await releaseFixture(t);
  const path = join(options.directory, `dangerous-gabe-${options.version}-ios-iphone-ipad.ipa`);
  const source = join(options.root, 'signed');
  await mkdir(source);
  const commit = sourceCommit();
  await writeFile(join(source, 'release-metadata.json'), JSON.stringify({ schemaVersion: 1,
    version: options.version, target: 'aarch64-apple-ios', signing: 'developer-signed',
    ...(commit ? { sourceCommit: commit } : {}) }));
  runCommand('zip', ['-q', path, 'release-metadata.json'], { cwd: source });
  const manifest = await validateArtifacts(options);
  assert.equal(manifest.assets.length, 8);
  assert.equal(manifest.assets.find(asset => asset.file.endsWith('.ipa')).signing, 'developer-signed');
});
