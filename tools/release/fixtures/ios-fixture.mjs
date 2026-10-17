import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

export const profile = JSON.parse(readFileSync(new URL('./ios-profile.json', import.meta.url), 'utf8'));
const certificate = Buffer.from(profile.DeveloperCertificateBase64, 'base64');
export const fingerprint = createHash('sha1').update(certificate).digest('hex').toUpperCase();
profile.CertificateFingerprints = [fingerprint];
export const info = {
  CFBundleShortVersionString: '0.1.0', CFBundleVersion: '123.1',
  CFBundleIdentifier: 'dev.dangerousgabe.game', CFBundleExecutable: 'dangerous-gabe',
  CFBundlePackageType: 'APPL', UIDeviceFamily: [1, 2],
  CFBundleIcons: { CFBundlePrimaryIcon: { CFBundleIconName: 'AppIcon', CFBundleIconFiles: ['AppIcon60x60'] } },
  'CFBundleIcons~ipad': { CFBundlePrimaryIcon: { CFBundleIconName: 'AppIcon', CFBundleIconFiles: ['AppIcon76x76'] } },
};
export const signingEnv = {
  GABE_IOS_CERTIFICATE_BASE64: Buffer.from('not-a-real-pkcs12').toString('base64'),
  GABE_IOS_CERTIFICATE_PASSWORD: 'fixture-password',
  GABE_IOS_PROVISION_PROFILE_BASE64: Buffer.from('not-a-real-cms-profile').toString('base64'),
  GABE_IOS_SIGNING_IDENTITY: fingerprint, GABE_IOS_TEAM_ID: 'TEAM123456',
};

export function simulatedTools({ kind = 'device', failAt, appInfo = info, profileInfo = profile } = {}) {
  const calls = [];
  const archives = [];
  let signed = false;
  const run = (file, args) => {
    const command = basename(file);
    calls.push({ command, args });
    if (failAt?.(command, args)) throw new Error('Simulated Apple tool failure');
    const ok = (stdout = '', stderr = '') => ({ status: 0, stdout, stderr });
    if (command === 'plutil' && args[0] === '-extract') {
      const key = args[1];
      if (key === 'DeveloperCertificates') return ok(`<plist><array><data>${profile.DeveloperCertificateBase64}</data></array></plist>`);
      if (!(key in profileInfo)) return { status: 1, stdout: '', stderr: 'missing fixture key' };
      return ok(args[2] === 'raw' ? profileInfo[key] : JSON.stringify(profileInfo[key]));
    }
    if (command === 'plutil' && args[1] === 'json') return ok(JSON.stringify(appInfo));
    if (command === 'plutil') { writeFileSync(args[3], 'simulated-entitlements'); return ok(); }
    if (command === 'lipo') return ok('arm64\n');
    if (command === 'xcrun') return ok(`  platform ${kind === 'device' ? 'IOS' : 'IOSSIMULATOR'}\n`);
    if (command === 'security') {
      if (args[0] === 'cms') writeFileSync(args.at(-1), 'simulated-decoded-profile');
      if (args[0] === 'create-keychain') writeFileSync(args.at(-1), 'simulated-keychain');
      if (args[0] === 'find-identity') return ok(`1) ${fingerprint} "Fixture identity"\n`);
      return ok();
    }
    if (command === 'codesign') {
      if (args[0] === '--force') signed = true;
      if (args[0] === '--display' && args.includes('--verbose=4')) {
        return ok('', signed ? 'TeamIdentifier=TEAM123456\n' : 'Signature=adhoc\n');
      }
      if (args[0] === '--display') return { status: 1, stdout: '', stderr: 'code object is not signed at all' };
      return ok();
    }
    if (command === 'ditto') {
      const source = args.at(-2);
      archives.push({ source, metadata: JSON.parse(readFileSync(join(source, 'release-metadata.json'), 'utf8')), keepParent: args.includes('--keepParent') });
      writeFileSync(args.at(-1), 'simulated archive: not a signed IPA');
      return ok();
    }
    throw new Error('Unexpected simulated command');
  };
  return { run, calls, archives };
}
