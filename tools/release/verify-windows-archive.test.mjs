import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyWindowsArchive } from './verify-windows-archive.mjs';

const root = 'dangerous-gabe-1.2.3-x86_64-pc-windows-msvc';
const options = { archive: `${root}.zip`, version: '1.2.3', commit: 'a'.repeat(40) };
const files = ['README.md', 'THIRD_PARTY_NOTICES.txt', 'dangerous-gabe.exe', 'release-metadata.json'];
function runner({ separator = '/', metadata = {}, empty = '', executable = 'MZfixture' } = {}) {
  return (_command, args) => {
    if (args[0] === '-Z1') return files.map(file => `${root}${separator}${file}`).join('\n');
    const file = args[2].split('/').at(-1);
    if (file === 'release-metadata.json') return JSON.stringify({ schemaVersion: 1, version: '1.2.3',
      target: 'x86_64-pc-windows-msvc', signing: 'unsigned', sourceCommit: options.commit, ...metadata });
    if (file === 'dangerous-gabe.exe') return Buffer.from(executable);
    return file === empty ? '' : 'fixture content';
  };
}
test('portable Windows archive has canonical paths, native executable and matching release metadata', () => {
  assert.equal(verifyWindowsArchive(options, runner()).sourceCommit, options.commit);
});
test('Windows backslash entries remain rejected by the publication validator', () => {
  assert.throws(() => verifyWindowsArchive(options, runner({ separator: '\\' })), /Unsafe archive path/);
});
test('roundtrip rejects mismatched metadata, empty notices and non-PE payloads', () => {
  for (const change of [{ metadata: { version: '9.9.9' } }, { metadata: { sourceCommit: 'b'.repeat(40) } },
    { metadata: { target: 'aarch64-apple-darwin' } }, { metadata: { signing: 'ad-hoc' } },
    { empty: 'THIRD_PARTY_NOTICES.txt' }, { executable: 'not PE' }]) {
    assert.throws(() => verifyWindowsArchive(options, runner(change)));
  }
});
