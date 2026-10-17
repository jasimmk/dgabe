import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import semanticRelease from 'semantic-release';
import { releaseOptions } from '../../release.config.mjs';
import { assertSource, createPlan } from './plan.mjs';
import { assertExpectedVersion } from './analyzer.mjs';

export function verifyPlan(plan, env) {
  if (plan.schemaVersion !== 1 || plan.release !== true) throw new Error('A releasable schema-1 plan is required');
  if (plan.sourceCommit !== env.RELEASE_SOURCE_SHA || plan.branch !== env.RELEASE_BRANCH
      || plan.buildNumber !== (env.RELEASE_BUILD_NUMBER ?? env.GITHUB_RUN_NUMBER)
      || plan.requestedType !== (env.RELEASE_TYPE ?? 'auto')) {
    throw new Error('Plan source, branch, build number or requested type changed');
  }
  if (!/^\d+\.\d+\.\d+$/.test(plan.version ?? '')) throw new Error('Plan must contain a stable version');
}

export async function publishPlan({ plan, cwd = process.cwd(), env = process.env,
  run = semanticRelease, validate, options } = {}) {
  verifyPlan(plan, env);
  assertSource({ cwd, env });
  const fresh = await createPlan({ cwd, env, run, options });
  assertExpectedVersion(plan.version, fresh.version);
  const validator = validate ?? (await import('./manifest.mjs')).validateArtifacts;
  await validator({ version: plan.version, directory: `${cwd}/dist`, sourceCommit: plan.sourceCommit });
  const publishEnv = { ...env, RELEASE_EXPECTED_VERSION: plan.version };
  const configured = options ?? releaseOptions(publishEnv);
  const result = await run({ ci: true, ...configured, dryRun: false }, { cwd, env: publishEnv });
  if (!result) throw new Error('semantic-release did not publish the planned release');
  assertExpectedVersion(plan.version, result.nextRelease.version);
  return result;
}

export async function main() {
  const plan = JSON.parse(await readFile('release-plan.json', 'utf8'));
  await publishPlan({ plan });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error); process.exitCode = 1; });
}
