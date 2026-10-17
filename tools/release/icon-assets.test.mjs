import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const asset = name => readFile(new URL(`../../assets/icons/${name}`, import.meta.url));
function png(data, size) {
  assert.equal(data.subarray(1, 4).toString(), 'PNG');
  assert.equal(data.readUInt32BE(16), size); assert.equal(data.readUInt32BE(20), size);
  assert.equal(data[25], 2, 'native PNG uses RGB without alpha');
}

test('native assets retain the exact favicon source and source hash', async () => {
  const source = await readFile(new URL('../../docs/html/assets/favicon.svg', import.meta.url));
  assert.deepEqual(await asset('app.svg'), source);
  const provenance = JSON.parse(await asset('provenance.json'));
  assert.equal(provenance.sha256, createHash('sha256').update(source).digest('hex'));
  assert.equal(provenance.license, '0BSD');
});

test('Git Windows-style checkout preserves the exact provenance bytes', async t => {
  const root = await mkdtemp(join(tmpdir(), 'gabe-icon-eol-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await readFile(new URL('../../docs/html/assets/favicon.svg', import.meta.url));
  const attributes = await readFile(new URL('../../.gitattributes', import.meta.url), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  await mkdir(join(root, 'docs/html/assets'), { recursive: true });
  await mkdir(join(root, 'assets/icons'), { recursive: true });
  await writeFile(join(root, '.gitattributes'), attributes);
  await writeFile(join(root, 'docs/html/assets/favicon.svg'), source);
  await writeFile(join(root, 'assets/icons/app.svg'), source);
  const git = args => execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  git(['init', '--quiet']);
  git(['-c', 'core.autocrlf=false', 'add', '.']);
  git(['-c', 'core.autocrlf=true', 'checkout-index', '--all', '--prefix=export/']);
  for (const file of ['docs/html/assets/favicon.svg', 'assets/icons/app.svg']) {
    assert.deepEqual(await readFile(join(root, 'export', file)), source);
  }
});

test('SDL BMP is core-readable24bit256px with original Midnight and Seed pixels', async () => {
  const bmp = await asset('app.bmp');
  assert.equal(bmp.toString('ascii', 0, 2), 'BM'); assert.equal(bmp.readInt32LE(18), 256); assert.equal(Math.abs(bmp.readInt32LE(22)), 256);
  assert.equal(bmp.readUInt16LE(28), 24); assert.equal(bmp.readUInt32LE(30), 0);
  const pixel = (x, y) => {
    const row = bmp.readInt32LE(22) < 0 ? y : 255 - y;
    const offset = bmp.readUInt32LE(10) + row * 768 + x * 3;
    return [bmp[offset + 2], bmp[offset + 1], bmp[offset]];
  };
  assert.deepEqual(pixel(0, 0), [16, 27, 50]); assert.deepEqual(pixel(128, 50), [197, 239, 138]);
});

test('Windows ICO contains all six real PNG resolutions, and ICNS has a complete native container', async () => {
  const ico = await asset('app.ico'); assert.equal(ico.readUInt16LE(2), 1); assert.equal(ico.readUInt16LE(4), 6);
  for (const [i, size] of [16, 32, 48, 64, 128, 256].entries()) {
    const entry = 6 + i * 16; const offset = ico.readUInt32LE(entry + 12); const length = ico.readUInt32LE(entry + 8);
    assert.equal(ico[entry] || 256, size); png(ico.subarray(offset, offset + length), size);
  }
  const icns = await asset('app.icns'); assert.equal(icns.toString('ascii', 0, 4), 'icns'); assert.equal(icns.readUInt32BE(4), icns.length);
  const types = []; let cursor = 8;
  while (cursor < icns.length) { types.push(icns.toString('ascii', cursor, cursor + 4)); const length = icns.readUInt32BE(cursor + 4); assert(length > 8); cursor += length; }
  assert.equal(cursor, icns.length); for (const type of ['ic07', 'ic08', 'ic09', 'ic10']) assert(types.includes(type));
});

test('opaque desktop and all18iPhone/iPad/marketing slots match declared pixel sizes', async () => {
  png(await asset('app.png'), 1024); png(await asset('app-512.png'), 512);
  const base = 'Assets.xcassets/AppIcon.appiconset/'; const contents = JSON.parse(await asset(`${base}Contents.json`));
  assert.equal(contents.images.length, 18);
  for (const image of contents.images) png(await asset(`${base}${image.filename}`), Number.parseFloat(image.size) * Number.parseInt(image.scale, 10));
  for (const required of ['iphone:60x60:3x', 'ipad:83.5x83.5:2x', 'ios-marketing:1024x1024:1x']) assert(contents.images.some(image => `${image.idiom}:${image.size}:${image.scale}` === required));
});
