import { analyzeCommits as conventionalAnalyze } from '@semantic-release/commit-analyzer';

const ranks = ['patch', 'minor', 'major'];

export function requestedType(value = 'auto') {
  if (value !== 'auto' && !ranks.includes(value)) {
    throw new Error(`Invalid release type: ${value}`);
  }
  return value;
}

export async function analyzeCommits(config, context) {
  const forced = requestedType(config.releaseType);
  const inferred = await conventionalAnalyze({ parserOpts: {
    headerPattern: /^(\w*)(?:\((.*)\))?!?: (.*)$/,
    breakingHeaderPattern: /^(\w*)(?:\((.*)\))?!: (.*)$/,
    headerCorrespondence: ['type', 'scope', 'subject'],
    noteKeywords: ['BREAKING CHANGE', 'BREAKING CHANGES'],
  } }, context);
  if (forced === 'auto') return inferred;
  return ranks[Math.max(ranks.indexOf(forced), ranks.indexOf(inferred))];
}

export function assertExpectedVersion(expected, actual) {
  if (!expected || expected !== actual) {
    throw new Error(`Planned version ${expected ?? '(missing)'} differs from semantic-release ${actual}`);
  }
}

export async function prepare(config, context) {
  assertExpectedVersion(config.expectedVersion, context.nextRelease.version);
  const { validateArtifacts } = await import('./manifest.mjs');
  const { syncVersion } = await import('./version.mjs');
  await validateArtifacts({
    version: context.nextRelease.version,
    directory: `${context.cwd}/${config.directory}`,
    sourceCommit: config.sourceCommit,
  });
  await syncVersion(context.cwd, context.nextRelease.version, config.buildNumber);
}
