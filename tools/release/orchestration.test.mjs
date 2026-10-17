import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import semanticRelease from 'semantic-release';
import { analyzeCommits, assertExpectedVersion, requestedType } from './analyzer.mjs';
import { assertSource, createPlan } from './plan.mjs';
import { publishPlan, verifyPlan } from './publish.mjs';
import { releaseOptions } from '../../release.config.mjs';

const logger = { log() {}, error() {} };
const analyzer = fileURLToPath(new URL('./analyzer.mjs', import.meta.url));

async function fixture(t, message = 'fix: repaired controls', tagged = true) {
  const root = await mkdtemp(join(tmpdir(), 'gabe-semantic-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cwd = join(root, 'source');
  const remote = join(root, 'remote.git');
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '--bare', '--initial-branch=main', remote], { stdio: 'ignore' });
  execFileSync('git', ['clone', remote, cwd], { stdio: 'ignore' });
  git('checkout', '-b', 'main');
  git('config', 'user.email', 'fixture@example.invalid');
  git('config', 'user.name', 'Release fixture');
  await writeFile(join(cwd, '.gitignore'), 'dist/\nrelease-plan.json\n');
  git('add', '.gitignore');
  git('commit', '-m', 'chore: fixture baseline');
  if (tagged) git('tag', 'v1.2.3');
  await writeFile(join(cwd, 'payload'), 'fixture\n');
  git('add', 'payload');
  git('commit', '-m', message);
  git('push', '--tags', 'origin', 'main');
  const env = { ...process.env, GITHUB_ACTIONS: '', CI: '',
    GITHUB_REF: 'refs/heads/main', RELEASE_BRANCH: 'main', RELEASE_SOURCE_SHA: git('rev-parse', 'HEAD'),
    RELEASE_TYPE: 'auto', RELEASE_BUILD_NUMBER: '17', RELEASE_REPOSITORY_URL: remote };
  const options = { ci: false, branches: ['main'], repositoryUrl: remote, tagFormat: 'v${version}',
    plugins: [[analyzer, { releaseType: env.RELEASE_TYPE }]] };
  const sink = new Writable({ write(_chunk, _encoding, done) { done(); } });
  const run = (opts, config) => semanticRelease(opts, { ...config, stdout: sink, stderr: sink });
  return { cwd, env, options, run, git };
}

for (const [message, expected] of [
  ['fix: repair', 'patch'], ['perf: faster', 'patch'], ['feat: flight', 'minor'],
  ['feat!: change controls', 'major'], ['fix(input)!: remap keys', 'major'],
  ['fix: remap\n\nBREAKING CHANGE: old controls removed', 'major'], ['docs: guide', null],
]) {
  test(`Conventional Commit ${message.split('\n')[0]} => ${expected}`, async () => {
    assert.equal(await analyzeCommits({ releaseType: 'auto' }, { commits: [{ message }], logger }), expected);
  });
}

test('forced release includes docs and never lowers breaking/minor changes', async () => {
  assert.equal(await analyzeCommits({ releaseType: 'patch' }, { commits: [{ message: 'docs: guide' }], logger }), 'patch');
  assert.equal(await analyzeCommits({ releaseType: 'patch' }, { commits: [{ message: 'feat!: incompatible' }], logger }), 'major');
  assert.equal(await analyzeCommits({ releaseType: 'patch' }, { commits: [{ message: 'feat: new stage' }], logger }), 'minor');
  assert.throws(() => requestedType('latest'), /Invalid release type/);
  assert.throws(() => assertExpectedVersion(undefined, '1.0.0'), /Planned version/);
  assert.throws(() => assertExpectedVersion('1.0.0', '2.0.0'), /differs/);
});

for (const [message, tagged, expected] of [
  ['fix: repaired controls', true, '1.2.4'], ['feat: new stage', true, '1.3.0'],
  ['feat!: new controls', true, '2.0.0'], ['fix: first release', false, '1.0.0'],
  ['docs: words', true, undefined],
]) {
  test(`real semantic-release dry-run ${message}, tagged=${tagged}`, async t => {
    const f = await fixture(t, message, tagged);
    const plan = await createPlan(f);
    assert.equal(plan.version, expected);
    assert.equal(plan.release, Boolean(expected));
    assert.equal(f.git('rev-parse', 'HEAD'), f.env.RELEASE_SOURCE_SHA);
    assert.equal(f.git('tag', '--list').split('\n').filter(Boolean).length, tagged ? 1 : 0);
  });
}

test('real semantic-release forced patch on docs', async t => {
  const f = await fixture(t, 'docs: guide');
  f.env.RELEASE_TYPE = 'patch';
  f.options.plugins[0][1].releaseType = 'patch';
  assert.equal((await createPlan(f)).version, '1.2.4');
});

test('source guard rejects other branches, stale SHA, dirty tree and advanced default', async t => {
  const f = await fixture(t);
  assert.throws(() => assertSource({ ...f, env: { ...f.env, GITHUB_REF: 'refs/heads/topic' } }), /default branch/);
  assert.throws(() => assertSource({ ...f, env: { ...f.env, RELEASE_SOURCE_SHA: 'a'.repeat(40) } }), /Checkout differs/);
  await writeFile(join(f.cwd, 'untracked'), 'x');
  assert.throws(() => assertSource(f), /clean/);
  await rm(join(f.cwd, 'untracked'));
  f.git('commit', '--allow-empty', '-m', 'docs: branch advanced');
  assert.throws(() => assertSource({ ...f, env: { ...f.env, RELEASE_SOURCE_SHA: f.git('rev-parse', 'HEAD') } }), /Default branch moved/);
});

test('publish refuses changed version or missing assets before any real publication', async t => {
  const f = await fixture(t);
  const plan = await createPlan(f);
  const calls = [];
  const run = async options => {
    calls.push(options.dryRun);
    return { nextRelease: { version: '1.2.5', type: 'patch' } };
  };
  await assert.rejects(publishPlan({ ...f, plan, run, validate: async () => assert.fail('Must not validate stale version') }), /differs/);
  assert.deepEqual(calls, [true]);
  calls.length = 0;
  const same = async options => { calls.push(options.dryRun); return { nextRelease: { version: plan.version, type: 'patch' } }; };
  await assert.rejects(publishPlan({ ...f, plan, run: same, validate: async () => { throw new Error('Missing required asset'); } }), /Missing required asset/);
  assert.deepEqual(calls, [true]);
});

test('publish validates full assets and performs exactly one real semantic-release invocation', async t => {
  const f = await fixture(t);
  const plan = await createPlan(f);
  await mkdir(join(f.cwd, 'dist'));
  await writeFile(join(f.cwd, 'dist', 'downloaded.zip'), 'fixture downloaded asset');
  await writeFile(join(f.cwd, 'release-plan.json'), JSON.stringify(plan));
  assertSource(f);
  let validated = false;
  const calls = [];
  const run = async (options, config) => {
    calls.push(options.dryRun);
    if (!options.dryRun) {
      assert.equal(validated, true);
      assert.equal(config.env.RELEASE_EXPECTED_VERSION, plan.version);
    }
    return { nextRelease: { version: plan.version, type: 'patch' } };
  };
  await publishPlan({ ...f, plan, run, validate: async input => {
    assert.equal(input.sourceCommit, f.env.RELEASE_SOURCE_SHA);
    assert.equal(input.version, plan.version);
    validated = true;
  } });
  assert.deepEqual(calls, [true, false]);
  assert.throws(() => verifyPlan({ ...plan, buildNumber: '18' }, f.env), /Plan source/);
  assert.throws(() => verifyPlan({ ...plan, release: false }, f.env), /releasable/);
});

test('production configuration commits only metadata and never publishes npm', () => {
  const config = releaseOptions({ RELEASE_BRANCH: 'main', GITHUB_REPOSITORY: 'fixture/example' });
  const git = config.plugins.find(p => Array.isArray(p) && p[0] === '@semantic-release/git');
  assert.deepEqual(git[1].assets, ['Cargo.toml', 'Cargo.lock', 'platform/Info.plist']);
  assert.match(git[1].message, /\[skip ci\]/);
  assert.equal(config.plugins.some(p => String(p).includes('@semantic-release/npm')), false);
});
