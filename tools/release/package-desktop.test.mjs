import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { packageDesktop, archiveCommand, DESKTOP_TARGETS } from './package-desktop.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'gabe-desktop-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'platform'));
  await writeFile(join(root, 'Cargo.toml'), '[package]\nname="dangerous-gabe"\nversion = "1.2.3"\n');
  await writeFile(join(root, 'README.md'), 'Fixture user guide');
  await writeFile(join(root, 'THIRD_PARTY_NOTICES.txt'), 'Fixture license notices');
  await writeFile(join(root, 'platform/Info.plist'), '<key>CFBundleShortVersionString</key><string>1.2.3</string><key>CFBundleVersion</key><string>12</string>');
  await writeFile(join(root, 'binary with spaces'), 'test executable fixture, not a native binary');
  return { root, version: '1.2.3', binary: join(root, 'binary with spaces'), output: join(root, 'dist'), sourceCommit: '' };
}

test('all desktop formats use explicit argv and fixed safe archive roots', () => {
  assert.equal(Object.keys(DESKTOP_TARGETS).length, 5);
  for (const target of Object.keys(DESKTOP_TARGETS)) {
    const [command, args] = archiveCommand({ target, source: '/tmp/path with ; spaces/root', destination: '/tmp/out archive.zip' });
    assert.ok(command);
    assert.ok(args.includes('/tmp/out archive.zip'));
    assert.ok(args.some(value => value.includes('path with ; spaces')));
    if (target.includes('windows')) assert.ok(args.includes('-LiteralPath') || args.includes('-Source'));
  }
  assert.throws(() => archiveCommand({ target: '../../evil', source: 'x', destination: 'y' }));
});

test('Windows packaging stages its executable, documentation and version metadata without invoking a shell', async t => {
  const options = await fixture(t);
  const calls = [];
  const { writeFileSync, readFileSync, existsSync } = await import('node:fs');
  const result = await packageDesktop({ ...options, target: 'x86_64-pc-windows-msvc' }, {
    platform: 'win32', run(command, args) {
      calls.push([command, args]);
      const source = args[args.indexOf('-Source') + 1];
      const destination = args[args.indexOf('-Destination') + 1];
      assert.ok(existsSync(join(source, 'dangerous-gabe.exe')));
      assert.equal(JSON.parse(readFileSync(join(source, 'release-metadata.json'), 'utf8')).target, 'x86_64-pc-windows-msvc');
      writeFileSync(destination, 'injected PowerShell archive output');
    },
  });
  assert.equal(basename(result.archive), 'dangerous-gabe-1.2.3-x86_64-pc-windows-msvc.zip');
  assert.equal(result.metadata.signing, 'unsigned');
  assert.equal(calls.length, 1);
});

test('Mac packaging stamps a desktop app and requires both signing and verification', async t => {
  const options = await fixture(t);
  const calls = [];
  const { writeFileSync, readFileSync, statSync } = await import('node:fs');
  await packageDesktop({ ...options, target: 'aarch64-apple-darwin' }, {
    platform: 'darwin', run(command, args) {
      calls.push([command, args]);
      if (command.endsWith('ditto')) {
        const contents = join(args.at(-2), 'Dangerous Gabe.app', 'Contents');
        const plist = readFileSync(join(contents, 'Info.plist'), 'utf8');
        assert.ok(plist.includes('<string>1.2.3</string>'));
        assert.ok(plist.includes('<string>12</string>'));
        const executable = statSync(join(contents, 'MacOS/dangerous-gabe'));
        assert.ok(executable.size > 0);
        if (process.platform !== 'win32') assert.equal(executable.mode & 0o111, 0o111);
        writeFileSync(args.at(-1), 'injected ditto archive output');
      }
    },
  });
  assert.ok(calls.some(([command, args]) => command.endsWith('codesign') && args.includes('--sign')));
  assert.ok(calls.some(([command, args]) => command.endsWith('codesign') && args.includes('--verify')));
});

test('Linux archive command and metadata are staged consistently through an injected archive runner', async t => {
  const options = await fixture(t);
  let staged;
  const { writeFileSync, readFileSync, readdirSync, statSync } = await import('node:fs');
  const result = await packageDesktop({ ...options, target: 'aarch64-unknown-linux-gnu' }, {
    platform: 'linux', run(command, args) {
      assert.equal(command, 'tar');
      const source = join(args[args.indexOf('-C') + 1], args.at(-1));
      staged = { metadata: JSON.parse(readFileSync(join(source, 'release-metadata.json'), 'utf8')),
        files: readdirSync(source), executable: statSync(join(source, 'dangerous-gabe')) };
      writeFileSync(args[1], 'injected archive-tool output');
    },
  });
  assert.equal(basename(result.archive), 'dangerous-gabe-1.2.3-aarch64-unknown-linux-gnu.tar.gz');
  assert.equal(staged.metadata.version, '1.2.3');
  assert.equal(staged.metadata.signing, 'unsigned');
  assert.ok(staged.executable.size > 0);
  if (process.platform !== 'win32') assert.equal(staged.executable.mode & 0o111, 0o111);
  assert.deepEqual(staged.files.sort(), ['README.md', 'THIRD_PARTY_NOTICES.txt', 'dangerous-gabe', 'release-metadata.json'].sort());
  assert.ok((await readFile(result.archive)).length > 0);
});

test('packaging rejects stale metadata, injected versions, unsupported targets and empty binaries', async t => {
  const options = await fixture(t);
  const target = 'aarch64-apple-darwin';
  await assert.rejects(packageDesktop({ ...options, target, version: '1.2.3;touch x' }));
  await assert.rejects(packageDesktop({ ...options, target: '../bad' }));
  await assert.rejects(packageDesktop({ ...options, target, version: '2.0.0' }, { platform: 'darwin' }), /Cargo.toml/);
  await writeFile(options.binary, '');
  await assert.rejects(packageDesktop({ ...options, target }, { platform: 'darwin' }), /nonempty/);
  assert.deepEqual((await readdir(dirname(options.output))).sort(), ['Cargo.toml', 'README.md', 'THIRD_PARTY_NOTICES.txt', 'binary with spaces', 'platform'].sort());
});

test('an archive tool failure leaves no final asset that could be published', async t => {
  const options = await fixture(t);
  await assert.rejects(packageDesktop({ ...options, target: 'x86_64-pc-windows-msvc' }, {
    platform: 'win32', run() { throw new Error('archive failed'); },
  }), /archive failed/);
  assert.deepEqual(await readdir(options.output), []);
});
