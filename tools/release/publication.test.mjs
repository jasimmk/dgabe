import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import semanticRelease from 'semantic-release';
import { createPlan } from './plan.mjs';
import { publishPlan } from './publish.mjs';
import { expectedAssets } from './manifest.mjs';

test('real local release prepares exactly three metadata files before tagging, without GitHub or npm', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gabe-local-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const remote = join(root, 'origin.git');
  const cwd = join(root, 'checkout');
  const invoke = (command, args, directory = cwd) => execFileSync(command, args,
    { cwd: directory, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  invoke('git', ['init', '--bare', '--initial-branch=main', remote], root);
  invoke('git', ['clone', remote, cwd], root);
  const git = (...args) => invoke('git', args);
  git('checkout', '-b', 'main');
  git('config', 'user.name', 'Fixture release');
  git('config', 'user.email', 'fixture@example.invalid');
  await mkdir(join(cwd, 'platform'));
  await writeFile(join(cwd, '.gitignore'), 'dist/\nrelease-plan.json\n');
  await writeFile(join(cwd, 'Cargo.toml'), '[package]\nname = "dangerous-gabe"\nversion = "1.2.3"\n');
  await writeFile(join(cwd, 'Cargo.lock'), 'version = 4\n\n[[package]]\nname = "dangerous-gabe"\nversion = "1.2.3"\n');
  await writeFile(join(cwd, 'platform/Info.plist'), '<plist><dict><key>CFBundleShortVersionString</key><string>1.2.3</string><key>CFBundleVersion</key><string>1</string></dict></plist>');
  git('add', '.'); git('commit', '-m', 'chore: fixture baseline'); git('tag', 'v1.2.3');
  git('commit', '--allow-empty', '-m', 'fix: release fixture'); git('push', '--tags', 'origin', 'main');
  const source = git('rev-parse', 'HEAD');
  const env = { ...process.env, GITHUB_ACTIONS: '', CI: '', GITHUB_REF: 'refs/heads/main',
    RELEASE_BRANCH: 'main', RELEASE_TYPE: 'auto', RELEASE_BUILD_NUMBER: '42', RELEASE_SOURCE_SHA: source };
  const guard = { releaseType: 'auto', expectedVersion: '1.2.4', buildNumber: '42', sourceCommit: source, directory: 'dist' };
  const options = { ci: false, repositoryUrl: remote, branches: ['main'], plugins: [
    [fileURLToPath(new URL('./analyzer.mjs', import.meta.url)), guard],
    [fileURLToPath(import.meta.resolve('@semantic-release/git')), {
      assets: ['Cargo.toml', 'Cargo.lock', 'platform/Info.plist'],
      message: 'chore(release): ${nextRelease.version} [skip ci]',
    }],
  ] };
  const sink = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const run = (config, context) => semanticRelease(config, { ...context, stdout: sink, stderr: sink });
  const plan = await createPlan({ cwd, env, options, run });
  assert.equal(plan.version, '1.2.4');
  await mkdir(join(cwd, 'dist'));
  for (const [index, asset] of expectedAssets(plan.version).entries()) {
    const name = `asset-${index}`;
    await mkdir(join(root, name));
    await writeFile(join(root, name, 'release-metadata.json'), JSON.stringify({ schemaVersion: 1,
      version: plan.version, target: asset.target, signing: asset.signing, sourceCommit: source }));
    const path = join(cwd, 'dist', asset.file);
    if (asset.file.endsWith('.tar.gz')) invoke('tar', ['-czf', path, '-C', root, name], root);
    else invoke('zip', ['-q', '-r', path, name], root);
  }
  await writeFile(join(cwd, 'release-plan.json'), JSON.stringify(plan));
  const result = await publishPlan({ cwd, env, options, run, plan });
  assert.equal(result.nextRelease.version, plan.version);
  assert.equal(git('rev-parse', 'v1.2.4'), git('rev-parse', 'HEAD'));
  assert.equal(git('rev-parse', 'HEAD^'), source);
  assert.equal(git('log', '-1', '--format=%s'), 'chore(release): 1.2.4 [skip ci]');
  assert.deepEqual(git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').sort(),
    ['Cargo.lock', 'Cargo.toml', 'platform/Info.plist']);
  assert.match(await readFile(join(cwd, 'platform/Info.plist'), 'utf8'), /<string>42<\/string>/);
  assert.equal(JSON.parse(await readFile(join(cwd, 'dist/release-manifest.json'), 'utf8')).sourceCommit, source);
});
