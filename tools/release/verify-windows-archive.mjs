import assert from 'node:assert/strict';
import { basename } from 'node:path';
import { archiveMetadata } from './manifest.mjs';
import { runCommand, sourceCommit } from './package-desktop.mjs';
import { flags, isMain, stableVersion } from './version.mjs';

export function verifyWindowsArchive({ archive, version, commit }, run = runCommand) {
  stableVersion(version);
  const name = `dangerous-gabe-${version}-x86_64-pc-windows-msvc`;
  assert.equal(basename(archive), `${name}.zip`);
  const metadata = archiveMetadata(archive, run);
  assert.equal(metadata.version, version);
  assert.equal(metadata.target, 'x86_64-pc-windows-msvc');
  assert.equal(metadata.signing, 'unsigned');
  if (commit) assert.equal(metadata.sourceCommit, sourceCommit(commit));
  const entries = run('unzip', ['-Z1', archive]).split(/\r?\n/).filter(Boolean);
  assert.deepEqual(entries.sort(), ['README.md', 'THIRD_PARTY_NOTICES.txt', 'dangerous-gabe.exe', 'release-metadata.json']
    .map(file => `${name}/${file}`).sort());
  for (const file of ['README.md', 'THIRD_PARTY_NOTICES.txt']) {
    assert.ok(run('unzip', ['-p', archive, `${name}/${file}`]).length > 0, `Empty ${file}`);
  }
  const executable = run('unzip', ['-p', archive, `${name}/dangerous-gabe.exe`], { encoding: null });
  assert.equal(executable.subarray(0, 2).toString(), 'MZ');
  return metadata;
}

if (isMain(import.meta.url)) {
  try { console.log(JSON.stringify(verifyWindowsArchive(flags(process.argv.slice(2), ['archive', 'version', 'commit'])))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
