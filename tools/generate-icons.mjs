import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// macOS ImageIO rasterizes the original SVG; iconutil writes the native ICNS.
// No browser, external dependency, downloaded artwork or game build is required.
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(root, 'assets/icons');
function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`${command} failed: ${result.error?.message ?? result.stderr}`);
}

// ImageIO's BMP encoder emits 32-bit BGRA. Strip the unused alpha into a normal
// 24-bit BMP so SDL_LoadBMP needs no image extension and iOS PNGs have no alpha.
function bmp24(input) {
  const width = input.readInt32LE(18); const height = input.readInt32LE(22);
  if (input.toString('ascii', 0, 2) === 'BM' && width > 0 && height !== 0 && input.readUInt16LE(28) === 24 && input.readUInt32LE(30) === 0) return input;
  if (input.toString('ascii', 0, 2) !== 'BM' || width <= 0 || height === 0 || input.readUInt16LE(28) !== 32) throw new Error('Expected native 32-bit BMP conversion');
  const offset = input.readUInt32LE(10); const rows = Math.abs(height); const stride = (width * 3 + 3) & ~3;
  if (offset + width * rows * 4 > input.length) throw new Error('Truncated native BMP');
  const result = Buffer.alloc(54 + stride * rows);
  result.write('BM'); result.writeUInt32LE(result.length, 2); result.writeUInt32LE(54, 10); result.writeUInt32LE(40, 14);
  result.writeInt32LE(width, 18); result.writeInt32LE(height, 22); result.writeUInt16LE(1, 26); result.writeUInt16LE(24, 28); result.writeUInt32LE(stride * rows, 34);
  for (let y = 0; y < rows; y++) for (let x = 0; x < width; x++) input.copy(result, 54 + y * stride + x * 3, offset + (y * width + x) * 4, offset + (y * width + x) * 4 + 3);
  return result;
}

if (process.platform !== 'darwin') throw new Error('Regenerate native icons on macOS with sips and iconutil; generated assets are checked in for every build platform');
const temporary = await mkdtemp(join(tmpdir(), 'gabe-icons-'));
try {
  await mkdir(output, { recursive: true });
  const source = await readFile(join(root, 'docs/html/assets/favicon.svg'), 'utf8');
  await writeFile(join(output, 'app.svg'), source);
  // The emblem itself is untouched. Midnight fills only transparent outer corners
  // so iOS can apply its own system mask to an opaque square app icon.
  const opaque = source.replace(/(<svg\b[^>]*>)/u, '$1<rect width="40" height="40" fill="#101B32"/>');
  const svg = join(temporary, 'opaque.svg'); await writeFile(svg, opaque);
  run('/usr/bin/sips', ['-s', 'format', 'png', '-z', '1024', '1024', svg, '--out', join(temporary, 'render.png')]);
  run('/usr/bin/sips', ['-s', 'format', 'bmp', join(temporary, 'render.png'), '--out', join(temporary, 'render.bmp')]);
  await writeFile(join(temporary, 'opaque.bmp'), bmp24(await readFile(join(temporary, 'render.bmp'))));
  run('/usr/bin/sips', ['-s', 'format', 'png', join(temporary, 'opaque.bmp'), '--out', join(output, 'app.png')]);
  const cache = new Map([[1024, join(output, 'app.png')]]);
  function png(size) {
    if (!cache.has(size)) {
      const file = join(temporary, `${size}.png`);
      run('/usr/bin/sips', ['-z', String(size), String(size), join(output, 'app.png'), '--out', file]); cache.set(size, file);
    }
    return cache.get(size);
  }
  await copyFile(png(512), join(output, 'app-512.png'));
  run('/usr/bin/sips', ['-s', 'format', 'bmp', png(256), '--out', join(temporary, 'window.bmp')]);
  await writeFile(join(output, 'app.bmp'), bmp24(await readFile(join(temporary, 'window.bmp'))));
  const sizes = [16, 32, 48, 64, 128, 256]; const payloads = await Promise.all(sizes.map(size => readFile(png(size))));
  const ico = Buffer.alloc(6 + sizes.length * 16 + payloads.reduce((n, data) => n + data.length, 0));
  ico.writeUInt16LE(1, 2); ico.writeUInt16LE(sizes.length, 4); let offset = 6 + sizes.length * 16;
  for (const [index, size] of sizes.entries()) {
    const entry = 6 + index * 16; ico[entry] = size % 256; ico[entry + 1] = size % 256;
    ico.writeUInt16LE(1, entry + 4); ico.writeUInt16LE(24, entry + 6); ico.writeUInt32LE(payloads[index].length, entry + 8); ico.writeUInt32LE(offset, entry + 12); payloads[index].copy(ico, offset); offset += payloads[index].length;
  }
  await writeFile(join(output, 'app.ico'), ico);
  const iconset = join(temporary, 'app.iconset'); await mkdir(iconset);
  for (const size of [16, 32, 128, 256, 512]) for (const scale of [1, 2]) await copyFile(png(size * scale), join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`));
  run('/usr/bin/iconutil', ['-c', 'icns', iconset, '-o', join(output, 'app.icns')]);
  const catalog = join(output, 'Assets.xcassets'); const appIcon = join(catalog, 'AppIcon.appiconset'); await mkdir(appIcon, { recursive: true });
  await writeFile(join(catalog, 'Contents.json'), `${JSON.stringify({ info: { version: 1, author: 'Dangerous Gabe' } }, null, 2)}\n`);
  const images = [];
  for (const [idiom, entries] of [['iphone', [[20, 2], [20, 3], [29, 2], [29, 3], [40, 2], [40, 3], [60, 2], [60, 3]]], ['ipad', [[20, 1], [20, 2], [29, 1], [29, 2], [40, 1], [40, 2], [76, 1], [76, 2], [83.5, 2]]], ['ios-marketing', [[1024, 1]]]]) {
    for (const [size, scale] of entries) {
      const filename = `${idiom}-${size}@${scale}x.png`; await copyFile(png(size * scale), join(appIcon, filename));
      images.push({ idiom, size: `${size}x${size}`, scale: `${scale}x`, filename });
    }
  }
  await writeFile(join(appIcon, 'Contents.json'), `${JSON.stringify({ images, info: { version: 1, author: 'Dangerous Gabe' } }, null, 2)}\n`);
  await writeFile(join(output, 'provenance.json'), `${JSON.stringify({ source: 'docs/html/assets/favicon.svg', sha256: createHash('sha256').update(source).digest('hex'), license: '0BSD', rendering: 'macOS sips SVG rasterization; original artwork and colors; opaque Midnight corners; iconutil ICNS', windowIcon: { file: 'app.bmp', size: 256, bitsPerPixel: 24 }, windowsSizes: sizes, macIconsetSizes: [16, 32, 64, 128, 256, 512, 1024], iosImages: images.length }, null, 2)}\n`);
  console.log(`Generated native icons from favicon.svg in ${output}`);
} finally { await rm(temporary, { recursive: true, force: true }); }
