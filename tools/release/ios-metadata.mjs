const SIGNING_KEYS = [
  'GABE_IOS_CERTIFICATE_BASE64', 'GABE_IOS_CERTIFICATE_PASSWORD',
  'GABE_IOS_PROVISION_PROFILE_BASE64', 'GABE_IOS_SIGNING_IDENTITY', 'GABE_IOS_TEAM_ID',
];

export function validateVersion(version) {
  if (typeof version !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u.test(version)) {
    throw new Error('iOS package version must be a numeric major.minor.patch without a tag prefix');
  }
  return version;
}

export function assetNames(version, kind) {
  validateVersion(version);
  if (!['device', 'simulator'].includes(kind)) throw new Error('kind must be device or simulator');
  const stem = `dangerous-gabe-${version}-ios-`;
  return kind === 'device'
    ? { archive: `${stem}iphone-ipad-unsigned.zip`, signed: `${stem}iphone-ipad.ipa` }
    : { archive: `${stem}simulator-arm64.zip` };
}

function decodeSecret(value, label) {
  const text = value.replace(/\s/gu, '');
  if (!text || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(text)) {
    throw new Error(`${label} must contain valid base64`);
  }
  const decoded = Buffer.from(text, 'base64');
  if (decoded.length === 0 || decoded.length > 8 * 1024 * 1024 || decoded.toString('base64') !== text) {
    throw new Error(`${label} has invalid encoded content or size`);
  }
  return decoded;
}

export function signingConfiguration(env) {
  const present = SIGNING_KEYS.filter(key => typeof env[key] === 'string' && env[key].length > 0);
  if (present.length === 0) return null;
  if (present.length !== SIGNING_KEYS.length) throw new Error('All five GABE_IOS signing secrets must be provided together');
  const identity = env.GABE_IOS_SIGNING_IDENTITY.trim().toUpperCase();
  const team = env.GABE_IOS_TEAM_ID.trim();
  if (!/^[A-F0-9]{40}$/u.test(identity)) throw new Error('Signing identity must be a 40-digit SHA-1 certificate fingerprint');
  if (!/^[A-Z0-9]{10}$/u.test(team)) throw new Error('Signing team must be a ten-character Apple team identifier');
  return {
    certificate: decodeSecret(env.GABE_IOS_CERTIFICATE_BASE64, 'Signing certificate'),
    password: env.GABE_IOS_CERTIFICATE_PASSWORD,
    profile: decodeSecret(env.GABE_IOS_PROVISION_PROFILE_BASE64, 'Provisioning profile'),
    identity, team,
  };
}

export function validateBundle(info, version, expectedBundleId) {
  validateVersion(version);
  if (info.CFBundleShortVersionString !== version) throw new Error('App version does not match requested package version');
  if (!/^\d+(?:\.\d+){0,2}$/u.test(info.CFBundleVersion ?? '')) throw new Error('App has no valid stamped build number');
  const family = info.UIDeviceFamily;
  if (!Array.isArray(family) || family.length !== 2 || !family.includes(1) || !family.includes(2)) {
    throw new Error('App must support both iPhone and iPad with UIDeviceFamily [1, 2]');
  }
  if (!/^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(info.CFBundleIdentifier ?? '')) throw new Error('App bundle identifier is invalid');
  if (expectedBundleId && info.CFBundleIdentifier !== expectedBundleId) throw new Error('App bundle identifier does not match configured bundle identifier');
  if (!/^[A-Za-z0-9_-]+$/u.test(info.CFBundleExecutable ?? '') || info.CFBundlePackageType !== 'APPL') {
    throw new Error('App executable or package type is invalid');
  }
  return { identifier: info.CFBundleIdentifier, executable: info.CFBundleExecutable };
}

function permits(pattern, value) {
  if (typeof pattern !== 'string') return false;
  if (pattern.endsWith('*') && pattern.indexOf('*') === pattern.length - 1) return value.startsWith(pattern.slice(0, -1));
  return pattern === value;
}

export function profileEntitlements(profile, bundle, signing, now = Date.now()) {
  const expiration = Date.parse(profile.ExpirationDate);
  if (!Number.isFinite(expiration) || expiration <= now) throw new Error('Provisioning profile is expired or has invalid expiry');
  if (!Array.isArray(profile.Platform) || !profile.Platform.includes('iOS')) throw new Error('Provisioning profile does not support iOS');
  if (!Array.isArray(profile.TeamIdentifier) || !profile.TeamIdentifier.includes(signing.team)) throw new Error('Provisioning profile team does not match signing team');
  const allowed = profile.Entitlements;
  if (!allowed || allowed['com.apple.developer.team-identifier'] !== signing.team) throw new Error('Provisioning entitlement team does not match signing team');
  const prefix = typeof allowed['application-identifier'] === 'string' ? allowed['application-identifier'].split('.')[0] : undefined;
  if (!prefix || !Array.isArray(profile.ApplicationIdentifierPrefix) || !profile.ApplicationIdentifierPrefix.includes(prefix)) {
    throw new Error('Provisioning profile application prefix is inconsistent');
  }
  const application = `${prefix}.${bundle.identifier}`;
  if (!permits(allowed['application-identifier'], application)) throw new Error('Provisioning profile does not authorize this bundle identifier');
  if (!Array.isArray(profile.CertificateFingerprints) || !profile.CertificateFingerprints.includes(signing.identity)) {
    throw new Error('Signing certificate is not authorized by provisioning profile');
  }
  const devices = profile.ProvisionedDevices;
  const registered = Array.isArray(devices) && devices.length > 0 && devices.every(id => typeof id === 'string' && id.length > 0);
  if (!registered && profile.ProvisionsAllDevices !== true) throw new Error('Profile must support registered-device or enterprise installation; App Store-only profiles are unsupported');
  const result = { 'application-identifier': application, 'com.apple.developer.team-identifier': signing.team };
  for (const key of ['get-task-allow', 'beta-reports-active']) {
    if (key in allowed) {
      if (typeof allowed[key] !== 'boolean') throw new Error('Provisioning profile has invalid boolean entitlements');
      result[key] = allowed[key];
    }
  }
  if (Array.isArray(allowed['keychain-access-groups']) && allowed['keychain-access-groups'].some(group => permits(group, application))) {
    result['keychain-access-groups'] = [application];
  }
  return result;
}
