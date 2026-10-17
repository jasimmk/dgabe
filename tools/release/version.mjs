import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export function stableVersion(value) {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value)
      || value.split('.').some(part => !Number.isSafeInteger(Number(part)))) {
    throw new Error('Version must be stable SemVer: MAJOR.MINOR.PATCH without prefixes or prereleases');
  }
  return value;
}

export function buildNumber(value) {
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error('Build number must be a positive decimal integer');
  }
  return value;
}

export function flags(arguments_, required, optional = []) {
  const values = {};
  for (let index = 0; index < arguments_.length; index += 2) {
    const key = arguments_[index];
    const value = arguments_[index + 1];
    if (!key?.startsWith('--') || ![...required, ...optional].includes(key.slice(2))
        || typeof value !== 'string' || value.startsWith('--') || Object.hasOwn(values, key.slice(2))) {
      throw new Error(`Invalid or duplicate option: ${key}`);
    }
    values[key.slice(2)] = value;
  }
  for (const key of required) if (!values[key]) throw new Error(`Missing --${key}`);
  return values;
}

function replaceOne(text, expression, replacement, label) {
  let matches = 0;
  const changed = text.replace(expression, (...parts) => { matches += 1; return replacement(...parts); });
  if (matches !== 1) throw new Error(`Expected exactly one ${label}; found ${matches}`);
  return changed;
}

export function packageVersion(text) {
  const section = text.match(/^\[package\][ \t]*\r?\n([\s\S]*?)(?=^\[|$(?![\s\S]))/m)?.[1];
  const version = section?.match(/^version\s*=\s*"([^"]+)"[ \t]*$/m)?.[1];
  if (!version) throw new Error('Missing root package version');
  return stableVersion(version);
}

export async function syncVersion(root, version, build) {
  stableVersion(version);
  buildNumber(build);
  root = resolve(root);
  const paths = ['Cargo.toml', 'Cargo.lock', 'platform/Info.plist'].map(path => resolve(root, path));
  const original = await Promise.all(paths.map(path => readFile(path, 'utf8')));
  packageVersion(original[0]);
  const cargo = replaceOne(original[0], /(^\[package\][ \t]*\r?\n)([\s\S]*?)(?=^\[|$(?![\s\S]))/gm,
    (_all, header, section) => header + replaceOne(section, /^(version\s*=\s*")[^"]+("[ \t]*)$/gm,
      (_line, start, end) => `${start}${version}${end}`, 'root version'), 'root package');
  const lock = replaceOne(original[1], /^\[\[package\]\][ \t]*\r?\n(?:(?!^\[\[package\]\])[\s\S])*?^name\s*=\s*"dangerous-gabe"[ \t]*\r?\n(?:(?!^\[\[package\]\])[\s\S])*?(?=^\[\[package\]\]|$(?![\s\S]))/gm,
    section => replaceOne(section, /^(version\s*=\s*")[^"]+("[ \t]*)$/gm,
      (_line, start, end) => `${start}${version}${end}`, 'lock package version'), 'dangerous-gabe lock package');
  let plist = original[2];
  for (const [key, value] of [['CFBundleShortVersionString', version], ['CFBundleVersion', build]]) {
    plist = replaceOne(plist, new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`, 'g'),
      (_all, start, end) => `${start}${value}${end}`, key);
  }
  const temporary = paths.map(path => `${path}.release-${process.pid}-${Date.now()}`);
  try {
    await Promise.all(temporary.map((path, index) => writeFile(path, [cargo, lock, plist][index], { flag: 'wx' })));
    for (let index = 0; index < paths.length; index += 1) await rename(temporary[index], paths[index]);
  } finally {
    await Promise.all(temporary.map(path => rm(path, { force: true })));
  }
  return { version, buildNumber: build, files: paths };
}

export function isMain(url) {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(url);
}

if (isMain(import.meta.url)) {
  try {
    const [version, build, ...arguments_] = process.argv.slice(2);
    const options = flags(arguments_, [], ['root']);
    const root = options.root ?? resolve(dirname(fileURLToPath(import.meta.url)), '../..');
    console.log(JSON.stringify(await syncVersion(root, version, build)));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
