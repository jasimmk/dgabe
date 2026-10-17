import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, readdir, rename, rm, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';

export function runTool(file, args, { allowFailure = false } = {}) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GABE_IOS_')));
  const result = spawnSync(file, args, { encoding: 'utf8', timeout: 120_000, maxBuffer: 8 * 1024 * 1024, env });
  if (result.error || (!allowFailure && result.status !== 0)) {
    throw new Error(`${basename(file)} failed during Apple packaging (exit ${result.status ?? 'unavailable'})`);
  }
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

export function readInfo(path, run) {
  return JSON.parse(run('/usr/bin/plutil', ['-convert', 'json', '-o', '-', path]).stdout);
}

export function readProfile(path, run) {
  const get = (key, format = 'json', optional = false) => {
    const result = run('/usr/bin/plutil', ['-extract', key, format, '-o', '-', path], { allowFailure: optional });
    if (optional && result.status !== 0) return undefined;
    try { return format === 'json' ? JSON.parse(result.stdout) : result.stdout.trim(); }
    catch { throw new Error('Provisioning profile metadata cannot be parsed'); }
  };
  const certificates = get('DeveloperCertificates', 'xml1');
  const fingerprints = [...certificates.matchAll(/<data>\s*([A-Za-z0-9+/=\s]+?)\s*<\/data>/gu)]
    .map(match => createHash('sha1').update(Buffer.from(match[1].replace(/\s/gu, ''), 'base64')).digest('hex').toUpperCase());
  return {
    ExpirationDate: get('ExpirationDate', 'raw'), Platform: get('Platform'),
    TeamIdentifier: get('TeamIdentifier'), ApplicationIdentifierPrefix: get('ApplicationIdentifierPrefix'),
    Entitlements: get('Entitlements'), CertificateFingerprints: fingerprints,
    ProvisionedDevices: get('ProvisionedDevices', 'json', true),
    ProvisionsAllDevices: get('ProvisionsAllDevices', 'json', true),
  };
}

async function rejectLinks(path) {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) throw new Error('App bundle must not contain symbolic links');
  if (metadata.isDirectory()) {
    for (const name of await readdir(path)) await rejectLinks(join(path, name));
  }
}

export async function copyApp(source, destination) {
  await rejectLinks(source);
  await cp(source, destination, { recursive: true, errorOnExist: true, force: false });
}

export function inspectTarget(app, bundle, kind, run) {
  const binary = join(app, bundle.executable);
  const arch = run('/usr/bin/lipo', ['-archs', binary]).stdout.trim();
  if (arch !== 'arm64') throw new Error('Apple archive requires an arm64 executable');
  const build = run('/usr/bin/xcrun', ['vtool', '-show-build', binary]).stdout;
  const platform = kind === 'device' ? 'IOS' : 'IOSSIMULATOR';
  if (!new RegExp(`^\\s*platform ${platform}\\s*$`, 'mu').test(build)) throw new Error('App executable platform does not match requested archive kind');
}

export async function inspectAppIcons(app, bundle) {
  const catalog = await stat(join(app, 'Assets.car'));
  if (!catalog.isFile() || catalog.size === 0) throw new Error('Compiled app icon catalog is empty');
  const files = await readdir(app);
  for (const icon of bundle.iconFiles) {
    const stem = icon.replace(/\.png$/u, '');
    const pattern = new RegExp(`^${stem}(?:@[123]x)?(?:~ipad)?\\.png$`, 'u');
    const matching = files.filter(name => pattern.test(name));
    if (!matching.length) throw new Error(`Compiled app icon is missing: ${icon}`);
    for (const file of matching) {
      const image = await stat(join(app, file));
      if (!image.isFile() || image.size === 0) throw new Error(`Compiled app icon is empty: ${file}`);
    }
  }
}

export async function stripDeviceSigning(app, run) {
  await rm(join(app, 'embedded.mobileprovision'), { force: true });
  const signature = run('/usr/bin/codesign', ['--display', app], { allowFailure: true });
  if (signature.status === 0) run('/usr/bin/codesign', ['--remove-signature', app]);
  else if (!signature.stderr.includes('not signed at all')) throw new Error('Cannot inspect device app signature');
  await rm(join(app, '_CodeSignature'), { force: true, recursive: true });
}

export async function archive(source, destination, { run, keepParent = true }) {
  const temporary = `${destination}.${randomUUID()}.tmp`;
  try {
    run('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--noextattr', ...(keepParent ? ['--keepParent'] : []), source, temporary]);
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}
