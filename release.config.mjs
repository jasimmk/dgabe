import { fileURLToPath } from 'node:url';

export function releaseOptions(env = process.env) {
  const branch = env.RELEASE_BRANCH;
  if (!branch) throw new Error('RELEASE_BRANCH must identify the default branch');
  const repositoryUrl = env.RELEASE_REPOSITORY_URL
    ?? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${env.GITHUB_REPOSITORY}.git`;
  if (!env.RELEASE_REPOSITORY_URL && !env.GITHUB_REPOSITORY) {
    throw new Error('GITHUB_REPOSITORY or RELEASE_REPOSITORY_URL is required');
  }
  return {
    branches: [branch],
    repositoryUrl,
    tagFormat: 'v${version}',
    plugins: [
      [fileURLToPath(new URL('./tools/release/analyzer.mjs', import.meta.url)), {
        releaseType: env.RELEASE_TYPE ?? 'auto',
        expectedVersion: env.RELEASE_EXPECTED_VERSION,
        buildNumber: env.RELEASE_BUILD_NUMBER ?? env.GITHUB_RUN_NUMBER,
        sourceCommit: env.RELEASE_SOURCE_SHA,
        directory: 'dist',
      }],
      '@semantic-release/release-notes-generator',
      ['@semantic-release/git', {
        assets: ['Cargo.toml', 'Cargo.lock', 'platform/Info.plist'],
        message: 'chore(release): ${nextRelease.version} [skip ci]',
      }],
      ['@semantic-release/github', {
        assets: ['dist/*'],
        successComment: false,
        failComment: false,
        failTitle: false,
        releasedLabels: false,
        addReleases: false,
      }],
    ],
  };
}

export default process.env.RELEASE_BRANCH && (process.env.GITHUB_REPOSITORY || process.env.RELEASE_REPOSITORY_URL)
  ? releaseOptions()
  : { plugins: [] };
