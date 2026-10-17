import { chmod, copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { flags, isMain, packageVersion, stableVersion } from './version.mjs';

export const DESKTOP_TARGETS = Object.freeze({
  'aarch64-apple-darwin': { platform: 'darwin', extension: 'zip', signing: 'ad-hoc' },
  'x86_64-pc-windows-msvc': { platform: 'win32', extension: 'zip', signing: 'unsigned' },
  'x86_64-unknown-linux-gnu': { platform: 'linux', extension: 'tar.gz', signing: 'unsigned' },
  'aarch64-unknown-linux-gnu': { platform: 'linux', extension: 'tar.gz', signing: 'unsigned' },
});

export function sourceCommit(value = process.env.GITHUB_SHA) {
  if (value === undefined || value === '') return undefined;
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(value)) throw new Error('Invalid source commit');
  return value.toLowerCase();
}

export function runCommand(command, arguments_, options = {}) {
  const result = spawnSync(command, arguments_, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr}`);
  return result.stdout;
}

export function archiveCommand({ target, source, destination }) {
  const type = Object.hasOwn(DESKTOP_TARGETS, target) ? DESKTOP_TARGETS[target] : undefined;
  if (!type) throw new Error(`Unsupported desktop target: ${target}`);
  if (type.platform === 'darwin') return ['/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', source, destination]];
  if (type.platform === 'win32') return ['powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
    fileURLToPath(new URL('./zip-desktop.ps1', import.meta.url)), '-Source', source, '-Destination', destination]];
  return ['tar', ['-czf', destination, '-C', dirname(source), basename(source)]];
}

export async function packageDesktop(options, runtime = {}) {
  const { target } = options;
  const version = stableVersion(options.version);
  const type = Object.hasOwn(DESKTOP_TARGETS, target) ? DESKTOP_TARGETS[target] : undefined;
  if (!type) throw new Error(`Unsupported desktop target: ${target}`);
  const platform = runtime.platform ?? process.platform;
  if (platform !== type.platform) throw new Error(`Package ${target} on its native ${type.platform} runner`);
  const run = runtime.run ?? runCommand;
  const root = resolve(options.root ?? dirname(fileURLToPath(import.meta.url)), options.root ? '.' : '../..');
  if (packageVersion(await readFile(join(root, 'Cargo.toml'), 'utf8')) !== version) throw new Error('Package version differs from Cargo.toml');
  const binary = resolve(options.binary);
  const binaryInfo = await stat(binary);
  if (!binaryInfo.isFile() || binaryInfo.size === 0) throw new Error('Binary must be a nonempty regular file');
  const readme = await readFile(join(root, 'README.md'));
  const notices = await readFile(join(root, 'THIRD_PARTY_NOTICES.txt'));
  if (!notices.length) throw new Error('Dependency notices are empty');
  const iconRoot = join(root, 'assets', 'icons');
  const iconFiles = type.platform === 'darwin' ? ['app.icns'] : type.platform === 'linux' ? ['app.svg', 'app-512.png'] : [];
  for (const file of iconFiles) if ((await stat(join(iconRoot, file))).size === 0) throw new Error(`App icon is empty: ${file}`);
  const commit = sourceCommit(options.sourceCommit);
  const name = `dangerous-gabe-${version}-${target}`;
  const output = resolve(options.output);
  await mkdir(output, { recursive: true });
  const archive = join(output, `${name}.${type.extension}`);
  try { await stat(archive); throw new Error(`Archive already exists: ${archive}`); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const workspace = await mkdtemp(join(tmpdir(), 'gabe-release-'));
  const source = join(workspace, name);
  const temporary = join(output, `.partial-${process.pid}-${name}.${type.extension}`);
  try {
    await mkdir(source);
    await writeFile(join(source, 'README.md'), readme);
    await writeFile(join(source, 'THIRD_PARTY_NOTICES.txt'), notices);
    const metadata = { schemaVersion: 1, version, target, signing: type.signing, ...(commit ? { sourceCommit: commit } : {}) };
    await writeFile(join(source, 'release-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    if (type.platform === 'darwin') {
      const contents = join(source, 'Dangerous Gabe.app', 'Contents');
      const executable = join(contents, 'MacOS', 'dangerous-gabe');
      await mkdir(dirname(executable), { recursive: true });
      await mkdir(join(contents, 'Resources'));
      await copyFile(join(iconRoot, 'app.icns'), join(contents, 'Resources', 'app.icns'));
      await copyFile(binary, executable);
      await chmod(executable, 0o755);
      const sourcePlist = await readFile(join(root, 'platform', 'Info.plist'), 'utf8');
      const build = sourcePlist.match(/<key>CFBundleVersion<\/key>\s*<string>([1-9]\d*)<\/string>/)?.[1];
      const short = sourcePlist.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/)?.[1];
      if (!build || short !== version) throw new Error('Apple source version/build metadata is not synchronized');
      await writeFile(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>CFBundleExecutable</key><string>dangerous-gabe</string><key>CFBundleIdentifier</key><string>dev.dangerousgabe.game</string><key>CFBundleName</key><string>Dangerous Gabe</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleShortVersionString</key><string>${version}</string><key>CFBundleVersion</key><string>${build}</string><key>CFBundleIconFile</key><string>app.icns</string><key>NSHighResolutionCapable</key><true/></dict></plist>\n`);
      const app = dirname(contents);
      run('/usr/bin/plutil', ['-lint', join(contents, 'Info.plist')]);
      run('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', app]);
      run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
    } else {
      const executable = join(source, type.platform === 'win32' ? 'dangerous-gabe.exe' : 'dangerous-gabe');
      await copyFile(binary, executable);
      if (type.platform !== 'win32') await chmod(executable, 0o755);
      if (type.platform === 'linux') {
        await mkdir(join(source, 'icons'));
        await copyFile(join(iconRoot, 'app.svg'), join(source, 'icons', 'app.svg'));
        await copyFile(join(iconRoot, 'app-512.png'), join(source, 'icons', 'app.png'));
      }
    }
    const [command, arguments_] = archiveCommand({ target, source, destination: temporary });
    run(command, arguments_);
    if ((await stat(temporary)).size === 0) throw new Error('Archive tool produced an empty file');
    await rename(temporary, archive);
    return { archive, metadata };
  } finally {
    await rm(workspace, { recursive: true, force: true });
    await rm(temporary, { force: true });
  }
}

if (isMain(import.meta.url)) {
  try { console.log(JSON.stringify(await packageDesktop(flags(process.argv.slice(2), ['target', 'version', 'binary', 'output'], ['root'])))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
