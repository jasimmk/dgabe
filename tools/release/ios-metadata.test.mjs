import test from 'node:test';
import assert from 'node:assert/strict';
import { assetNames, profileEntitlements, signingConfiguration, validateBundle } from './ios-metadata.mjs';
import { fingerprint, info, profile, signingEnv } from './fixtures/ios-fixture.mjs';

test('Apple asset names identify universal device, arm64 simulator and optional IPA', () => {
  assert.deepEqual(assetNames('0.1.0', 'device'), {
    archive: 'dangerous-gabe-0.1.0-ios-iphone-ipad-unsigned.zip', signed: 'dangerous-gabe-0.1.0-ios-iphone-ipad.ipa',
  });
  assert.deepEqual(assetNames('0.1.0', 'simulator'), { archive: 'dangerous-gabe-0.1.0-ios-simulator-arm64.zip' });
  for (const version of ['v0.1.0', '../0.1.0', '0.1.0-beta', '01.0.0']) assert.throws(() => assetNames(version, 'device'));
  assert.throws(() => assetNames('0.1.0', 'desktop'));
});

test('bundle metadata must match version, build, universal family and configured identifier', () => {
  assert.equal(validateBundle(info, '0.1.0').identifier, info.CFBundleIdentifier);
  for (const changes of [
    { CFBundleShortVersionString: '0.2.0' }, { CFBundleVersion: '' },
    { UIDeviceFamily: [1] }, { UIDeviceFamily: [2] }, { UIDeviceFamily: [1, 1, 2] },
    { CFBundleExecutable: '../secret' }, { CFBundlePackageType: 'FMWK' },
    { CFBundleIcons: {} }, { 'CFBundleIcons~ipad': {} },
    { CFBundleIcons: { CFBundlePrimaryIcon: { CFBundleIconName: 'Wrong', CFBundleIconFiles: ['AppIcon60x60'] } } },
    { CFBundleIcons: { CFBundlePrimaryIcon: { CFBundleIconName: 'AppIcon', CFBundleIconFiles: ['../secret'] } } },
  ]) assert.throws(() => validateBundle({ ...info, ...changes }, '0.1.0'));
  assert.throws(() => validateBundle(info, '0.1.0', 'other.bundle'));
});

test('absent signing is explicit while every partial or malformed secret set fails', () => {
  assert.equal(signingConfiguration({}), null);
  for (const key of Object.keys(signingEnv)) {
    const partial = { ...signingEnv }; delete partial[key];
    assert.throws(() => signingConfiguration(partial), /provided together/u);
  }
  for (const changes of [
    { GABE_IOS_CERTIFICATE_BASE64: 'not-base64' }, { GABE_IOS_PROVISION_PROFILE_BASE64: '!!!' },
    { GABE_IOS_SIGNING_IDENTITY: 'friendly certificate name' }, { GABE_IOS_TEAM_ID: 'wrong' },
  ]) assert.throws(() => signingConfiguration({ ...signingEnv, ...changes }));
  assert.equal(signingConfiguration(signingEnv).identity, fingerprint);
});

test('profile wildcard allowlist resolves only the game application and keychain identifiers', () => {
  const result = profileEntitlements(profile, { identifier: info.CFBundleIdentifier }, signingConfiguration(signingEnv));
  assert.deepEqual(result, {
    'application-identifier': 'TEAM123456.dev.dangerousgabe.game',
    'com.apple.developer.team-identifier': 'TEAM123456', 'get-task-allow': true,
    'keychain-access-groups': ['TEAM123456.dev.dangerousgabe.game'],
  });
  assert.equal(profile.Entitlements['application-identifier'], 'TEAM123456.dev.dangerousgabe.*');
});

test('expired, unrelated, unauthorized and App Store-only profiles are rejected', () => {
  const signing = signingConfiguration(signingEnv);
  const bundle = { identifier: info.CFBundleIdentifier };
  for (const changes of [
    { ExpirationDate: '2000-01-01T00:00:00Z' }, { ExpirationDate: 'invalid' },
    { Platform: ['macOS'] }, { TeamIdentifier: ['OTHER12345'] }, { CertificateFingerprints: [] },
    { ApplicationIdentifierPrefix: ['OTHER12345'] }, { ProvisionedDevices: [] },
    { Entitlements: { ...profile.Entitlements, 'application-identifier': 'TEAM123456.other.game' } },
    { Entitlements: { ...profile.Entitlements, 'com.apple.developer.team-identifier': 'OTHER12345' } },
  ]) assert.throws(() => profileEntitlements({ ...profile, ...changes }, bundle, signing));
  const enterprise = profileEntitlements({ ...profile, ProvisionedDevices: [], ProvisionsAllDevices: true }, bundle, signing);
  assert.equal(enterprise['application-identifier'], 'TEAM123456.dev.dangerousgabe.game');
});
