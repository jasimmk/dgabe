import { randomBytes } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { archive, copyApp, readProfile } from './ios-tools.mjs';
import { profileEntitlements } from './ios-metadata.mjs';

export async function signDevice({ app, bundle, signing, destination, metadata, noticeFile, run, temporaryRoot = tmpdir() }) {
  const temporary = await mkdtemp(join(temporaryRoot, 'gabe-ios-sign-'));
  const keychain = join(temporary, 'signing.keychain-db');
  let keychainAttempted = false;
  try {
    const certificate = join(temporary, 'certificate.p12');
    const provision = join(temporary, 'profile.mobileprovision');
    const decoded = join(temporary, 'profile.plist');
    await writeFile(certificate, signing.certificate, { mode: 0o600 });
    await writeFile(provision, signing.profile, { mode: 0o600 });
    run('/usr/bin/security', ['cms', '-D', '-i', provision, '-o', decoded]);
    const entitlements = profileEntitlements(readProfile(decoded, run), bundle, signing);
    const entitlementJson = join(temporary, 'entitlements.json');
    const entitlementPlist = join(temporary, 'entitlements.plist');
    await writeFile(entitlementJson, JSON.stringify(entitlements), { mode: 0o600 });
    run('/usr/bin/plutil', ['-convert', 'xml1', '-o', entitlementPlist, entitlementJson]);
    const password = randomBytes(32).toString('hex');
    keychainAttempted = true;
    run('/usr/bin/security', ['create-keychain', '-p', password, keychain]);
    run('/usr/bin/security', ['set-keychain-settings', '-lut', '3600', keychain]);
    run('/usr/bin/security', ['unlock-keychain', '-p', password, keychain]);
    run('/usr/bin/security', ['import', certificate, '-k', keychain, '-P', signing.password, '-T', '/usr/bin/codesign']);
    run('/usr/bin/security', ['set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, keychain]);
    const identities = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning', keychain]).stdout;
    if (!identities.includes(signing.identity)) throw new Error('Imported signing identity does not match configured fingerprint');
    const distribution = join(temporary, 'distribution');
    const payload = join(distribution, 'Payload');
    await mkdir(payload, { recursive: true });
    const staged = join(payload, basename(app));
    await copyApp(app, staged);
    await copyFile(provision, join(staged, 'embedded.mobileprovision'));
    run('/usr/bin/codesign', ['--force', '--sign', signing.identity, '--keychain', keychain,
      '--entitlements', entitlementPlist, '--generate-entitlement-der', '--timestamp=none', staged]);
    run('/usr/bin/codesign', ['--verify', '--strict', '--verbose=2', staged]);
    const signature = run('/usr/bin/codesign', ['--display', '--verbose=4', staged]);
    if (!signature.stderr.split('\n').includes(`TeamIdentifier=${signing.team}`)) throw new Error('Signed app team does not match provisioning profile');
    await writeFile(join(distribution, 'release-metadata.json'), `${JSON.stringify({ ...metadata, signing: 'developer-signed' }, null, 2)}\n`);
    await copyFile(noticeFile, join(distribution, 'THIRD_PARTY_NOTICES.txt'));
    await archive(distribution, destination, { run, keepParent: false });
  } finally {
    let cleanupFailed = false;
    if (keychainAttempted) {
      try { run('/usr/bin/security', ['delete-keychain', keychain]); }
      catch { cleanupFailed = true; }
    }
    await rm(temporary, { recursive: true, force: true });
    if (cleanupFailed) throw new Error('Temporary signing keychain cleanup failed');
  }
}
