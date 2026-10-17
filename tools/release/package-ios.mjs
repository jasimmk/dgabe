import { copyFile, mkdtemp, mkdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assetNames, signingConfiguration, validateBundle } from './ios-metadata.mjs';
import { archive, copyApp, inspectAppIcons, inspectTarget, readInfo, runTool, stripDeviceSigning } from './ios-tools.mjs';
import { signDevice } from './ios-signing.mjs';
import { sourceCommit } from './package-desktop.mjs';

const NOTICE_FILE = fileURLToPath(new URL('../../THIRD_PARTY_NOTICES.txt', import.meta.url));

export function parseArguments(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--kind', '--app', '--version', '--output'].includes(key) || !args[index + 1] || key in values) {
      throw new Error('Usage: package-ios.mjs --kind device|simulator --app PATH --version V --output DIR');
    }
    values[key] = args[index + 1];
  }
  if (Object.keys(values).length !== 4) throw new Error('kind, app, version and output are required');
  return { kind: values['--kind'], app: values['--app'], version: values['--version'], output: values['--output'] };
}

export async function packageIos(options, { env = process.env, run = runTool, temporaryRoot = tmpdir(), noticeFile = NOTICE_FILE } = {}) {
  const names = assetNames(options.version, options.kind);
  const signing = signingConfiguration(env);
  if (options.kind === 'simulator' && signing) throw new Error('Signing secrets belong only on the device packaging step');
  const app = await realpath(options.app);
  if (!app.endsWith('.app')) throw new Error('Input must be an .app bundle');
  const info = readInfo(join(app, 'Info.plist'), run);
  const bundle = validateBundle(info, options.version, env.GABE_IOS_BUNDLE_ID);
  await inspectAppIcons(app, bundle);
  const commit = sourceCommit(env.GITHUB_SHA ?? '');
  const metadata = { schemaVersion: 1, version: options.version,
    target: options.kind === 'device' ? 'aarch64-apple-ios' : 'aarch64-apple-ios-sim',
    signing: options.kind === 'device' ? 'unsigned' : 'ad-hoc', ...(commit ? { sourceCommit: commit } : {}) };
  inspectTarget(app, bundle, options.kind, run);
  const output = resolve(options.output);
  await mkdir(output, { recursive: true });
  const temporary = await mkdtemp(join(temporaryRoot, 'gabe-ios-package-'));
  try {
    const packageRoot = join(temporary, basename(names.archive, '.zip'));
    await mkdir(packageRoot);
    const staged = join(packageRoot, basename(app));
    await copyApp(app, staged);
    if (options.kind === 'device') await stripDeviceSigning(staged, run);
    else {
      run('/usr/bin/codesign', ['--verify', '--strict', staged]);
      const signature = run('/usr/bin/codesign', ['--display', '--verbose=4', staged]);
      if (!signature.stderr.includes('Signature=adhoc')) throw new Error('Simulator app must be ad-hoc signed');
    }
    const assets = [join(output, names.archive)];
    await writeFile(join(packageRoot, 'release-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
    await copyFile(noticeFile, join(packageRoot, 'THIRD_PARTY_NOTICES.txt'));
    await archive(packageRoot, assets[0], { run });
    if (signing) {
      const destination = join(output, names.signed);
      await signDevice({ app: staged, bundle, signing, destination, metadata, noticeFile, run, temporaryRoot });
      assets.push(destination);
    }
    return assets;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const assets = await packageIos(parseArguments(process.argv.slice(2)));
    for (const asset of assets) console.log(asset);
  } catch (error) {
    console.error(`Apple packaging failed: ${error.message}`);
    process.exitCode = 1;
  }
}
