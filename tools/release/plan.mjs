import { execFileSync } from 'node:child_process';
import { appendFile, writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import semanticRelease from 'semantic-release';
import { releaseOptions } from '../../release.config.mjs';
import { requestedType } from './analyzer.mjs';

export function assertSource({ cwd, env }) {
  if (!env.RELEASE_BRANCH || env.GITHUB_REF !== `refs/heads/${env.RELEASE_BRANCH}`) {
    throw new Error('Releases must run on the default branch');
  }
  if (!/^[a-f0-9]{40}$/.test(env.RELEASE_SOURCE_SHA ?? '')) throw new Error('Invalid source SHA');
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  if (git('rev-parse', 'HEAD') !== env.RELEASE_SOURCE_SHA) throw new Error('Checkout differs from planned source SHA');
  if (git('status', '--porcelain')) throw new Error('Release checkout must be clean');
  const remote = git('ls-remote', 'origin', `refs/heads/${env.RELEASE_BRANCH}`).split(/\s/)[0];
  if (remote !== env.RELEASE_SOURCE_SHA) throw new Error('Default branch moved; dispatch a fresh release');
  if (!/^[1-9][0-9]*$/.test(env.RELEASE_BUILD_NUMBER ?? env.GITHUB_RUN_NUMBER ?? '')) {
    throw new Error('A positive release build number is required');
  }
  requestedType(env.RELEASE_TYPE ?? 'auto');
}

export async function createPlan({ cwd = process.cwd(), env = process.env, run = semanticRelease, options } = {}) {
  assertSource({ cwd, env });
  const result = await run({ ci: true, ...(options ?? releaseOptions(env)), dryRun: true }, { cwd, env });
  return {
    schemaVersion: 1,
    release: Boolean(result),
    sourceCommit: env.RELEASE_SOURCE_SHA,
    branch: env.RELEASE_BRANCH,
    buildNumber: env.RELEASE_BUILD_NUMBER ?? env.GITHUB_RUN_NUMBER,
    requestedType: env.RELEASE_TYPE ?? 'auto',
    ...(result ? { version: result.nextRelease.version, releaseType: result.nextRelease.type } : {}),
  };
}

export async function main() {
  const plan = await createPlan();
  await writeFile('release-plan.json', `${JSON.stringify(plan, null, 2)}\n`);
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `release=${plan.release}\nversion=${plan.version ?? ''}\n`);
  }
  console.log(JSON.stringify(plan));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
