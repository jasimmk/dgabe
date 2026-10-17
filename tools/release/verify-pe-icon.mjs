import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

export function verifyPeIcon(image, ico) {
  const slice = (data, offset, length) => {
    if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || offset + length > data.length) {
      throw new Error('Truncated or invalid PE/icon data range');
    }
    return data.subarray(offset, offset + length);
  };
  slice(image, 0, 64);
  if (image.toString('ascii', 0, 2) !== 'MZ') throw new Error('Expected a PE executable');
  const pe = image.readUInt32LE(60);
  slice(image, pe, 24);
  if (image.readUInt32LE(pe) !== 0x4550) throw new Error('Invalid PE signature');
  const sections = image.readUInt16LE(pe + 6);
  const optional = pe + 24;
  const optionalSize = image.readUInt16LE(pe + 20);
  slice(image, optional, optionalSize);
  const magic = image.readUInt16LE(optional);
  const directories = magic === 0x20b ? 112 : magic === 0x10b ? 96 : 0;
  if (!directories || optionalSize < directories + 24 || image.readUInt32LE(optional + directories - 4) < 3) {
    throw new Error('PE image has no resource directory');
  }
  if (!sections || sections > 96) throw new Error('Invalid PE section count');
  const table = optional + optionalSize;
  slice(image, table, sections * 40);
  const fileOffset = (rva, length) => {
    for (let index = 0; index < sections; index++) {
      const section = table + index * 40;
      const start = image.readUInt32LE(section + 12);
      const size = image.readUInt32LE(section + 16);
      const delta = rva - start;
      if (delta >= 0 && delta + length <= size) {
        const offset = image.readUInt32LE(section + 20) + delta;
        slice(image, offset, length);
        return offset;
      }
    }
    throw new Error('PE resource RVA is outside file-backed sections');
  };
  const resourceRva = image.readUInt32LE(optional + directories + 16);
  const resourceSize = image.readUInt32LE(optional + directories + 20);
  if (!resourceRva || resourceSize < 16) throw new Error('PE image has no resource directory');
  const resource = fileOffset(resourceRva, resourceSize);
  const resourceOffset = (relative, length) => {
    if (relative < 0 || relative + length > resourceSize) throw new Error('Invalid PE resource directory offset');
    return resource + relative;
  };
  const entries = relative => {
    const at = resourceOffset(relative, 16);
    const count = image.readUInt16LE(at + 12) + image.readUInt16LE(at + 14);
    resourceOffset(relative + 16, count * 8);
    return Array.from({ length: count }, (_, index) => {
      const entry = at + 16 + index * 8;
      return { id: image.readUInt32LE(entry), value: image.readUInt32LE(entry + 4) };
    });
  };
  const child = entry => {
    if (!(entry.value & 0x80000000)) throw new Error('Expected PE resource subdirectory');
    return entry.value & 0x7fffffff;
  };
  const types = entries(0);
  const resources = type => {
    const root = types.find(entry => entry.id === type);
    if (!root) throw new Error(`Missing PE resource type ${type}`);
    return entries(child(root)).flatMap(name => entries(child(name)).map(language => {
      if (language.value & 0x80000000) throw new Error('Unexpected nested PE resource directory');
      const at = resourceOffset(language.value, 16);
      const length = image.readUInt32LE(at + 4);
      if (!length) throw new Error('Empty PE icon resource');
      return { id: name.id, data: slice(image, fileOffset(image.readUInt32LE(at), length), length) };
    }));
  };
  const icons = resources(3);
  const groups = resources(14);
  slice(ico, 0, 6);
  const expectedCount = ico.readUInt16LE(4);
  if (ico.readUInt16LE(0) !== 0 || ico.readUInt16LE(2) !== 1 || !expectedCount) throw new Error('Invalid source ICO');
  slice(ico, 6, expectedCount * 16);
  const expected = Array.from({ length: expectedCount }, (_, index) => {
    const at = 6 + index * 16;
    return slice(ico, ico.readUInt32LE(at + 12), ico.readUInt32LE(at + 8));
  });
  const matches = groups.some(({ data }) => {
    slice(data, 0, 6);
    const count = data.readUInt16LE(4);
    if (data.readUInt16LE(0) !== 0 || data.readUInt16LE(2) !== 1 || count !== expected.length) return false;
    slice(data, 6, count * 14);
    return expected.every((payload, index) => {
      const at = 6 + index * 14;
      const id = data.readUInt16LE(at + 12);
      return data.readUInt32LE(at + 8) === payload.length && icons.some(icon => icon.id === id && icon.data.equals(payload));
    });
  });
  if (!matches) throw new Error('PE executable does not contain the matching favicon icon group');
  return { iconResources: icons.length, iconGroups: groups.length, matchedImages: expected.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: verify-pe-icon.mjs EXE SOURCE.ico');
    console.log(JSON.stringify(verifyPeIcon(await readFile(process.argv[2]), await readFile(process.argv[3]))));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
