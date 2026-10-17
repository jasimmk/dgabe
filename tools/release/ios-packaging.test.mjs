import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { packageIos, parseArguments } from './package-ios.mjs';
import { runTool } from './ios-tools.mjs';
import { info, profile, signingEnv, simulatedTools } from './fixtures/ios-fixture.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'gabe-apple-unit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = join(root, 'DangerousGabe.app');
  await mkdir(app);
  await writeFile(join(app, 'Assets.car'), 'compiled catalog fixture');
  await writeFile(join(app, 'AppIcon60x60@2x.png'), 'phone icon fixture');
  await writeFile(join(app, 'AppIcon76x76@2x~ipad.png'), 'tablet icon fixture');
  const temporaryRoot = join(root, 'private');
  await mkdir(temporaryRoot);
  await writeFile(join(app, 'Info.plist'), JSON.stringify(info));
  await writeFile(join(app, info.CFBundleExecutable), 'fixture, not executable code', { mode: 0o755 });
  const noticeFile = join(root, 'THIRD_PARTY_NOTICES.txt');
  await writeFile(noticeFile, 'fixture notices');
  return { root, app, temporaryRoot, noticeFile, options: { kind: 'device', app, version: '0.1.0', output: join(root, 'dist') } };
}

test('Apple CLI rejects missing, duplicate and unknown options', () => {
  const args = ['--kind', 'device', '--app', 'game.app', '--version', '0.1.0', '--output', 'dist'];
  assert.equal(parseArguments(args).kind, 'device');
  for (const invalid of [[], args.slice(0, -1), [...args, '--kind', 'device'], [...args, '--secret', 'x']]) {
    assert.throws(() => parseArguments(invalid));
  }
});

for (const problem of ['basename', 'missing', 'empty', 'directory', 'permissions']) {
  test(`Apple packaging rejects ${problem} executable mismatch before signing or archiving`, async t => {
    const f = await fixture(t); const tools = simulatedTools();
    const executable = join(f.app, info.CFBundleExecutable);
    if (problem === 'basename') {
      const renamed = join(f.root, 'DifferentName.app');
      await rename(f.app, renamed);
      f.options.app = renamed;
    } else if (problem === 'missing') await rename(executable, join(f.app, 'dangerous-gabe'));
    else if (problem === 'empty') await writeFile(executable, '');
    else if (problem === 'directory') { await rm(executable); await mkdir(executable); }
    else await chmod(executable, 0o644);
    await assert.rejects(packageIos(f.options, { ...f, run: tools.run, env: {} }), /executable/i);
    assert(!tools.calls.some(call => ['ditto', 'codesign', 'security'].includes(call.command)));
  });
}

test('compiled catalog and both family icon files must exist before any archive or signing', async t => {
  const f = await fixture(t); const tools = simulatedTools();
  await rm(join(f.app, 'AppIcon76x76@2x~ipad.png'));
  await assert.rejects(packageIos(f.options, { ...f, run: tools.run, env: {} }), /icon is missing/);
  assert(!tools.calls.some(call => ['ditto', 'codesign', 'security'].includes(call.command)));
  await writeFile(join(f.app, 'AppIcon76x76@2x~ipad.png'), 'tablet icon fixture');
  await writeFile(join(f.app, 'Assets.car'), '');
  await assert.rejects(packageIos(f.options, { ...f, run: tools.run, env: {} }), /catalog is empty/);
});

test('both universal icons and the compiled catalog survive archive staging', async t => {
  const f = await fixture(t); const tools = simulatedTools();
  const { readFileSync } = await import('node:fs');
  let observed = false;
  const run = (file, args, options) => {
    if (basename(file) === 'ditto') {
      const app = join(args.at(-2), 'DangerousGabe.app');
      assert.equal(readFileSync(join(app, 'Assets.car'), 'utf8'), 'compiled catalog fixture');
      assert.equal(readFileSync(join(app, 'AppIcon60x60@2x.png'), 'utf8'), 'phone icon fixture');
      assert.equal(readFileSync(join(app, 'AppIcon76x76@2x~ipad.png'), 'utf8'), 'tablet icon fixture');
      assert.equal(readFileSync(join(app, info.CFBundleExecutable), 'utf8'), 'fixture, not executable code');
      observed = true;
    }
    return tools.run(file, args, options);
  };
  await packageIos(f.options, { ...f, run, env: {} });
  assert(observed);
});

for (const kind of ['device', 'simulator']) {
  test(`simulated ${kind} archive flow embeds matching metadata and cleans staging`, async t => {
    const f = await fixture(t); const tools = simulatedTools({ kind });
    const assets = await packageIos({ ...f.options, kind }, { ...f, run: tools.run, env: { GITHUB_SHA: 'a'.repeat(40) } });
    assert.equal(assets.length, 1);
    assert.equal(basename(assets[0]), kind === 'device'
      ? 'dangerous-gabe-0.1.0-ios-iphone-ipad-unsigned.zip' : 'dangerous-gabe-0.1.0-ios-simulator-arm64.zip');
    assert.deepEqual(tools.archives[0].metadata, {
      schemaVersion: 1, version: '0.1.0', target: kind === 'device' ? 'aarch64-apple-ios' : 'aarch64-apple-ios-sim',
      signing: kind === 'device' ? 'unsigned' : 'ad-hoc', sourceCommit: 'a'.repeat(40),
    });
    assert.deepEqual(await readdir(f.temporaryRoot), []);
    assert.equal(await readFile(join(f.app, 'Info.plist'), 'utf8'), JSON.stringify(info));
  });
}

test('simulated signing command flow uses Payload and deletes temporary keychain and secrets', async t => {
  const f = await fixture(t); const tools = simulatedTools();
  const { readFileSync } = await import('node:fs');
  const run = (file, args, options) => {
    if (basename(file) === 'codesign' && args[0] === '--force') {
      assert.equal(readFileSync(join(args.at(-1), info.CFBundleExecutable), 'utf8'), 'fixture, not executable code');
    }
    return tools.run(file, args, options);
  };
  const assets = await packageIos(f.options, { ...f, run, env: signingEnv });
  assert.equal(basename(assets[1]), 'dangerous-gabe-0.1.0-ios-iphone-ipad.ipa');
  assert.equal(tools.archives[1].keepParent, false);
  assert.equal(tools.archives[1].metadata.signing, 'developer-signed');
  const sign = tools.calls.find(call => call.command === 'codesign' && call.args[0] === '--force');
  assert.match(sign.args.at(-1), /[/\\]Payload[/\\]DangerousGabe\.app$/u);
  assert(tools.calls.some(call => call.command === 'codesign' && call.args[0] === '--verify'));
  assert.equal(tools.calls.filter(call => call.command === 'security' && call.args[0] === 'delete-keychain').length, 1);
  assert.deepEqual(await readdir(f.temporaryRoot), []);
  assert(!tools.calls.some(call => call.args[0] === 'list-keychains'));
});

for (const step of ['create-keychain', 'import', 'set-key-partition-list', 'codesign', 'ipa-archive']) {
  test(`simulated ${step} failure propagates and still cleans signing material`, async t => {
    const f = await fixture(t);
    const tools = simulatedTools({ failAt: (command, args) =>
      (command === 'security' && args[0] === step)
      || (step === 'codesign' && command === 'codesign' && args[0] === '--force')
      || (step === 'ipa-archive' && command === 'ditto' && args.at(-2).endsWith('distribution')) });
    await assert.rejects(packageIos(f.options, { ...f, run: tools.run, env: signingEnv }), /Simulated Apple tool failure/u);
    assert(tools.calls.some(call => call.command === 'security' && call.args[0] === 'delete-keychain'));
    assert.deepEqual(await readdir(f.temporaryRoot), []);
    const output = await readdir(f.options.output);
    assert.deepEqual(output, ['dangerous-gabe-0.1.0-ios-iphone-ipad-unsigned.zip']);
  });
}

test('invalid decoded profile fails before keychain creation and still removes private files', async t => {
  const f = await fixture(t);
  const tools = simulatedTools({ profileInfo: { ...profile, ExpirationDate: '2000-01-01T00:00:00Z' } });
  await assert.rejects(packageIos(f.options, { ...f, run: tools.run, env: signingEnv }), /expired/u);
  assert(!tools.calls.some(call => call.command === 'security' && call.args[0] === 'create-keychain'));
  assert.deepEqual(await readdir(f.temporaryRoot), []);
});

test('simulated profile decode failure cleans private files without creating a keychain', async t => {
  const f = await fixture(t);
  const tools = simulatedTools({ failAt: (command, args) => command === 'security' && args[0] === 'cms' });
  await assert.rejects(packageIos(f.options, { ...f, run: tools.run, env: signingEnv }), /Simulated/u);
  assert(!tools.calls.some(call => call.command === 'security' && call.args[0] === 'create-keychain'));
  assert.deepEqual(await readdir(f.temporaryRoot), []);
});

test('simulated keychain deletion failure is fatal and still removes private files', async t => {
  const f = await fixture(t);
  const tools = simulatedTools({ failAt: (command, args) => command === 'security' && args[0] === 'delete-keychain' });
  await assert.rejects(packageIos(f.options, { ...f, run: tools.run, env: signingEnv }), /keychain cleanup failed/u);
  assert.deepEqual(await readdir(f.temporaryRoot), []);
});

test('partial secrets fail before staging and simulator refuses device signing secrets', async t => {
  const f = await fixture(t); const tools = simulatedTools();
  await assert.rejects(packageIos(f.options, { ...f, run: tools.run, env: { GABE_IOS_TEAM_ID: 'TEAM123456' } }), /together/u);
  await assert.rejects(packageIos({ ...f.options, kind: 'simulator' }, { ...f, run: tools.run, env: signingEnv }), /device packaging step/u);
  assert.equal(tools.calls.length, 0);
  assert.deepEqual(await readdir(f.temporaryRoot), []);
});

test('failed system commands never expose stdout, stderr or secret arguments', () => {
  const marker = 'UNIT_SECRET_MUST_NOT_APPEAR';
  assert.throws(() => runTool(process.execPath, ['-e', `console.error('${marker}');process.exit(1)`]), error => {
    assert(!error.message.includes(marker)); assert(!error.message.includes('console.error'));
    return /Apple packaging/u.test(error.message);
  });
});
