import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { stableVersion, buildNumber, flags, syncVersion } from './version.mjs';

test('only stable semver and positive build numbers reach metadata', () => {
  for (const version of ['0.1.0', '1.2.3', '123.0.999']) assert.equal(stableVersion(version), version);
  for (const version of ['', 'v1.0.0', '1.2', '01.2.3', '1.2.3-beta.1', '1.2.3+build', '1.2.3\n', '1.2.3;touch pwned', '../1.2.3', '1.2.9007199254740992']) {
    assert.throws(() => stableVersion(version));
  }
  for (const value of ['1', '42', '99999']) assert.equal(buildNumber(value), value);
  for (const value of ['0', '-1', '01', '1.2', '1;exit', ' 1', '1\n', '9007199254740992']) assert.throws(() => buildNumber(value));
});

test('option parsing rejects duplicates, missing arguments and unknown flags', () => {
  assert.deepEqual(flags(['--root', 'a path'], [], ['root']), { root: 'a path' });
  for (const args of [['--root'], ['--root', 'x', '--root', 'y'], ['--other', 'x'], ['--root', '--oops']]) {
    assert.throws(() => flags(args, [], ['root']));
  }
});

test('version preparation updates only the root package, matching lock entry and Apple strings', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gabe-version-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'platform'));
  const cargo = '[package]\nname = "dangerous-gabe"\nversion = "0.1.0"\nedition = "2024"\n\n[dependencies]\nsdl3 = { version = "=0.20.0" }\n\n[package.metadata.bundle]\nversion = "leave-me"\n';
  const lock = 'version = 4\n\n[[package]]\nname = "before"\nversion = "8.0.0"\n\n[[package]]\nname = "dangerous-gabe"\nversion = "0.1.0"\ndependencies = ["sdl3"]\n\n[[package]]\nname = "sdl3"\nversion = "0.20.0"\nchecksum = "unchanged"\n';
  const plist = '<plist><dict><key>CFBundleShortVersionString</key><string>0.1.0</string><key>CFBundleVersion</key><string>1</string><key>CFBundleIdentifier</key><string>dev.test</string></dict></plist>';
  await Promise.all([writeFile(join(root, 'Cargo.toml'), cargo), writeFile(join(root, 'Cargo.lock'), lock), writeFile(join(root, 'platform/Info.plist'), plist)]);
  const result = await syncVersion(root, '1.4.2', '37');
  assert.equal(result.files.length, 3);
  assert.equal(await readFile(join(root, 'Cargo.toml'), 'utf8'), cargo.replace('version = "0.1.0"', 'version = "1.4.2"'));
  assert.equal(await readFile(join(root, 'Cargo.lock'), 'utf8'), lock.replace('version = "0.1.0"', 'version = "1.4.2"'));
  assert.equal(await readFile(join(root, 'platform/Info.plist'), 'utf8'), plist.replace('<string>0.1.0</string>', '<string>1.4.2</string>').replace('<string>1</string>', '<string>37</string>'));
});

test('invalid preparation and module imports do not mutate fixture metadata', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gabe-version-fail-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'platform'));
  const original = '[package]\nname = "dangerous-gabe"\nversion = "0.1.0"\n';
  await writeFile(join(root, 'Cargo.toml'), original);
  await assert.rejects(syncVersion(root, '1.2.3;exit', '1'));
  await assert.rejects(syncVersion(root, '1.2.3', '1'));
  const script = ['version.mjs', 'package-desktop.mjs', 'manifest.mjs'].map(file =>
    `await import(${JSON.stringify(new URL(file, import.meta.url).href)});`).join('\n');
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await readFile(join(root, 'Cargo.toml'), 'utf8'), original);
});
