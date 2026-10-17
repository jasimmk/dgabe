import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyPeIcon } from './verify-pe-icon.mjs';

function fixture(pe32 = false) {
  const payload = Buffer.from('original-icon-pixels');
  const ico = Buffer.alloc(22 + payload.length);
  ico.writeUInt16LE(1, 2); ico.writeUInt16LE(1, 4);
  ico[6] = 16; ico[7] = 16;
  ico.writeUInt32LE(payload.length, 14); ico.writeUInt32LE(22, 18); payload.copy(ico, 22);
  const image = Buffer.alloc(0x1400);
  image.write('MZ'); image.writeUInt32LE(0x80, 60); image.writeUInt32LE(0x4550, 0x80);
  image.writeUInt16LE(1, 0x86); image.writeUInt16LE(0xf0, 0x94);
  const optional = 0x98; const directories = pe32 ? 96 : 112;
  image.writeUInt16LE(pe32 ? 0x10b : 0x20b, optional);
  image.writeUInt32LE(16, optional + directories - 4);
  image.writeUInt32LE(0x2000, optional + directories + 16);
  image.writeUInt32LE(0x1000, optional + directories + 20);
  const section = optional + 0xf0;
  image.writeUInt32LE(0x2000, section + 12); image.writeUInt32LE(0x1000, section + 16); image.writeUInt32LE(0x400, section + 20);
  const entry = (directory, index, id, value) => {
    const at = 0x400 + directory + 16 + index * 8;
    image.writeUInt32LE(id, at); image.writeUInt32LE(value, at + 4);
  };
  const directory = (at, count) => image.writeUInt16LE(count, 0x400 + at + 14);
  directory(0, 2); entry(0, 0, 3, 0x80000040); entry(0, 1, 14, 0x80000080);
  directory(0x40, 1); entry(0x40, 0, 7, 0x800000c0);
  directory(0x80, 1); entry(0x80, 0, 1, 0x80000100);
  directory(0xc0, 1); entry(0xc0, 0, 1033, 0x140);
  directory(0x100, 1); entry(0x100, 0, 1033, 0x150);
  image.writeUInt32LE(0x2200, 0x540); image.writeUInt32LE(payload.length, 0x544); payload.copy(image, 0x600);
  image.writeUInt32LE(0x2240, 0x550); image.writeUInt32LE(20, 0x554);
  image.writeUInt16LE(1, 0x642); image.writeUInt16LE(1, 0x644);
  image.writeUInt32LE(payload.length, 0x64e); image.writeUInt16LE(7, 0x652);
  return { image, ico, optional, directories };
}

for (const pe32 of [false, true]) {
  test(`PE${pe32 ? '32' : '32+'} resources must contain byte-identical source ICO payloads`, () => {
    const { image, ico } = fixture(pe32);
    assert.deepEqual(verifyPeIcon(image, ico), { iconResources: 1, iconGroups: 1, matchedImages: 1 });
  });
}

for (const [type, at] of [[3, 0x410], [14, 0x418]]) {
  test(`missing RT_${type === 3 ? 'ICON' : 'GROUP_ICON'} fails executable validation`, () => {
    const { image, ico } = fixture(); image.writeUInt32LE(99, at);
    assert.throws(() => verifyPeIcon(image, ico), new RegExp(`Missing PE resource type ${type}`));
  });
}

test('a generic fallback image cannot replace the original favicon pixels', () => {
  const { image, ico } = fixture(); image[0x600] ^= 1;
  assert.throws(() => verifyPeIcon(image, ico), /matching favicon/);
});

test('a group reference to a missing icon is rejected', () => {
  const { image, ico } = fixture(); image.writeUInt16LE(8, 0x652);
  assert.throws(() => verifyPeIcon(image, ico), /matching favicon/);
});

test('truncated, empty, cyclic or invalid resource offsets cannot validate', () => {
  const { image, ico, optional, directories } = fixture();
  assert.throws(() => verifyPeIcon(image.subarray(0, 30), ico), /Truncated/);
  assert.throws(() => verifyPeIcon(image, ico.subarray(0, 20)), /Truncated/);
  for (const [at, value] of [[optional + directories + 16, 0xffff0000], [0x414, 0x8000ffff], [0x4d4, 0x80000000], [0x544, 0]]) {
    const damaged = Buffer.from(image); damaged.writeUInt32LE(value, at);
    assert.throws(() => verifyPeIcon(damaged, ico));
  }
});
