const viewer = document.querySelector('#image-viewer');
const picture = document.querySelector('#viewer-image');
const caption = document.querySelector('#viewer-caption');
const releasePage = 'https://github.com/jasimmk/dgabe/releases/latest';
const downloadLink = document.querySelector('#download-link');
const downloadLabel = document.querySelector('#download-label');
const downloadStatus = document.querySelector('#download-status');
const downloadPlatform = document.querySelector('#download-platform');

async function detectDownloadPlatform() {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) return {};
  let hints;
  try {
    hints = await navigator.userAgentData?.getHighEntropyValues(['architecture', 'bitness', 'platform']);
  } catch { hints = undefined; }
  const platform = hints?.platform || navigator.userAgentData?.platform || navigator.platform || ua;
  const os = /win/i.test(platform) ? 'windows' : /mac|darwin/i.test(platform) ? 'macos' : /linux/i.test(platform) ? 'linux' : null;
  const arch = hints?.architecture === 'arm' && hints.bitness === '64' ? 'arm64'
    : hints?.architecture === 'x86' && hints.bitness === '64' ? 'x86_64'
    : /aarch64|arm64/i.test(ua) ? 'arm64'
    : /x86_64|x64|amd64|Win64|WOW64/i.test(ua) ? 'x86_64' : null;
  return { os, arch };
}

function matchDownload(assets, os, arch) {
  const platforms = {
    macos: /darwin|macos|osx|\.dmg$|\.pkg$/i,
    windows: /windows|(?:^|[-_.])win(?:32|64)?(?:[-_.]|$)|\.exe$/i,
    linux: /linux|\.appimage$|\.deb$|\.tar\.gz$/i,
  };
  if (!platforms[os]) return null;
  const candidates = assets.filter(asset => {
    if (typeof asset.name !== 'string' || typeof asset.browser_download_url !== 'string') return false;
    const name = asset.name;
    if (!platforms[os].test(name) || /ios|android|checksum|sha256|\.sig$|\.blockmap$|\.json$|\.txt$/i.test(name)) return false;
    if (os !== 'macos' && /darwin|macos|osx|\.dmg$|\.pkg$/i.test(name)) return false;
    if (os !== 'windows' && /windows|\.exe$|\.msi$/i.test(name)) return false;
    if (os !== 'linux' && /linux|\.appimage$|\.deb$/i.test(name)) return false;
    if (!/\.(dmg|pkg|exe|msi|zip|appimage|deb|tar\.gz)$/i.test(name)) return false;
    const arm = /arm64|aarch64/i.test(name);
    const x86 = /x86_64|amd64|x64|win64/i.test(name);
    const universal = /universal/i.test(name);
    if (arm && !universal && arch !== 'arm64') return false;
    if (x86 && !universal && arch !== 'x86_64') return false;
    if (!arch && !universal) return false;
    if (/i[3-6]86|armv7|win32/i.test(name)) return false;
    try {
      const url = new URL(asset.browser_download_url);
      return url.origin === 'https://github.com' && url.pathname.startsWith('/jasimmk/dgabe/releases/download/');
    } catch { return false; }
  });
  const rank = name => /\.(dmg|exe|appimage)$/i.test(name) ? 0 : /\.(pkg|msi|deb)$/i.test(name) ? 1 : 2;
  return candidates.sort((a, b) => rank(a.name) - rank(b.name))[0] || null;
}

async function initializeDownload() {
  if (!downloadLink || !downloadLabel || !downloadStatus || !downloadPlatform) return;
  let release;
  let detected = {};
  const names = { macos: 'macOS', windows: 'Windows', linux: 'Linux' };
  function render() {
    const [os, arch] = downloadPlatform.value === 'auto'
      ? [detected.os, detected.arch] : downloadPlatform.value.split('-');
    const asset = release && matchDownload(release.assets, os, arch);
    downloadLink.href = asset ? asset.browser_download_url : releasePage;
    downloadLabel.textContent = asset ? `Download dgabe for ${names[os]}` : 'Download dgabe';
    const version = release ? `Version ${release.tag_name}. ` : '';
    downloadStatus.textContent = asset ? `Version ${release.tag_name} · ${arch || 'Universal'}`
      : version + (os && arch ? `No matching download for ${names[os]} ${arch}. Browse releases for alternatives.`
        : 'Choose your OS and architecture, or browse releases.');
  }
  downloadPlatform.addEventListener('change', render);
  downloadStatus.textContent = 'Finding the latest release…';
  try {
    const [response, platform] = await Promise.all([
      fetch('https://api.github.com/repos/jasimmk/dgabe/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(10000),
      }),
      detectDownloadPlatform(),
    ]);
    if (!response.ok) throw new Error(`Release lookup failed: ${response.status}`);
    const data = await response.json();
    if (!Array.isArray(data.assets) || typeof data.tag_name !== 'string') throw new Error('Invalid release data');
    release = data;
    detected = platform;
    render();
  } catch {
    downloadStatus.textContent = 'Latest release details are unavailable. Download from GitHub.';
  }
}
initializeDownload();
document.querySelectorAll('a[href="#build-notes"]').forEach(link => {
  link.addEventListener('click', () => { document.querySelector('#build-notes').open = true; });
});
if (viewer && typeof viewer.showModal === 'function') {
  document.querySelectorAll('[data-gallery]').forEach(link => {
    link.addEventListener('click', event => {
      event.preventDefault();
      picture.src = link.href;
      picture.alt = link.querySelector('img').alt;
      caption.textContent = link.dataset.caption;
      viewer.showModal();
    });
  });
  document.querySelector('#close-viewer').addEventListener('click', () => viewer.close());
  viewer.addEventListener('click', event => { if (event.target === viewer) viewer.close(); });
}
