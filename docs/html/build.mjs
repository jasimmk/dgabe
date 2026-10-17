import { readFile, writeFile, mkdir, copyFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const docs = path.dirname(here);
const root = path.resolve(here, '../..');
const config = JSON.parse(await readFile(path.join(here, 'site.config.json'), 'utf8'));
function publicUrl(value, name) {
  if (!value) return '';
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} must be a public HTTPS URL without credentials, query or fragment`);
  }
  if (['localhost', 'example.com', 'example.org', '127.0.0.1'].includes(url.hostname)) {
    throw new Error(`${name} must identify the actual public destination`);
  }
  return url.href.replace(/\/$/, '');
}
const repository = publicUrl(process.env.GABE_REPOSITORY_URL ?? config.repositoryUrl, 'repositoryUrl');
const site = publicUrl(process.env.GABE_SITE_URL ?? config.siteUrl, 'siteUrl');
const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const readme = await readFile(path.join(root, 'README.md'), 'utf8');
const stageSection = readme.split('### Garden stories and route guide')[1].split('#### When the last arch wakes')[0];
const stages = [...stageSection.matchAll(/#### (\d+)\. ([^\n]+)\n\n([\s\S]*?)(?=\n#### |$)/g)];
if (stages.length !== 12) throw new Error('Expected twelve stage stories in README');
const stageItems = stages.map(([, number, name, content]) => {
  const paragraphs = content.trim().split(/\n\s*\n/).map(p => p.replace(/\n/g, ' ').replace(/\*\*Challenge guide:\*\*\s*/, ''));
  return `<details class="stage" id="stage-${number}"><summary><span class="stage-number">${number.padStart(2, '0')}</span><span><small>${Number(number) <= 6 ? 'INNER GARDENS' : 'OUTER STORMWORKS'}</small><strong>${escape(name)}</strong></span><span class="stage-toggle" aria-hidden="true">+</span></summary><div class="stage-content"><p>${escape(paragraphs[0])}</p><h4>Your challenge</h4>${paragraphs.slice(1).map(p => `<p>${escape(p)}</p>`).join('')}</div></details>`;
});
const stageHtml = `<div class="stage-column">${stageItems.slice(0, 6).join('\n')}</div><div class="stage-column">${stageItems.slice(6).join('\n')}</div>`;
const glyphSource = await readFile(path.join(root, 'src/lettering.rs'), 'utf8');
const glyphs = new Map([...glyphSource.matchAll(/'([A-Z])' => \[([\s\S]*?)\]/g)].map(([, char, rows]) => [char, [...rows.matchAll(/0b([01]+)/g)].map(row => parseInt(row[1], 2))]));
function lettering(text, color) {
  let shapes = '';
  for (const [index, char] of [...text].entries()) {
    for (const [y, row] of (glyphs.get(char) ?? []).entries()) {
      for (let x = 0; x < 5; x++) if (row & (1 << (4 - x))) shapes += `<path d="M${index * 6 + x} ${y}h1v1h-1z"/>`;
    }
  }
  return `<svg viewBox="0 0 ${text.length * 6 - 1} 7" fill="${color}" aria-hidden="true" focusable="false">${shapes}</svg>`;
}
const description = 'A gardener. A storm. Twelve floating greenhouses. Meet Dangerous Gabe, an original Rust and SDL3 platform game about bringing a living sky back to light.';
const data = {
  '@context': 'https://schema.org', '@type': 'VideoGame', name: 'Dangerous Gabe',
  description, genre: ['Platform game', 'Action'], playMode: 'SinglePlayer',
  gamePlatform: ['macOS', 'Windows', 'Linux', 'iPhone', 'iPad'],
  operatingSystem: ['macOS', 'Windows', 'Linux', 'iOS'], inLanguage: 'en',
  ...(site ? { url: `${site}/`, image: `${site}/html/assets/share.png` } : {}),
  ...(repository ? { sameAs: repository } : {}),
};
const metadata = `<meta name="description" content="${description}">
<meta property="og:type" content="website"><meta property="og:site_name" content="Dangerous Gabe">
<meta property="og:title" content="Dangerous Gabe — The storm has a gardener">
<meta property="og:description" content="${description}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="Dangerous Gabe — The storm has a gardener">
<meta name="twitter:description" content="${description}">
${site ? `<link rel="canonical" href="${escape(site)}/"><meta property="og:url" content="${escape(site)}/"><meta property="og:image" content="${escape(site)}/html/assets/share.png"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630"><meta property="og:image:alt" content="Dangerous Gabe: the storm has a gardener, with an actual Dawnseed Crown game frame"><meta name="twitter:image" content="${escape(site)}/html/assets/share.png">` : ''}
<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
let html = await readFile(path.join(here, 'page.template.html'), 'utf8');
html = html.replace('<details class="build-details">', `<details id="build-notes" class="build-details"${repository ? '' : ' open'}>`);
for (const [key, value] of Object.entries({ METADATA: metadata, STAGES: stageHtml, DANGEROUS: lettering('DANGEROUS', 'currentColor'), GABE: lettering('GABE', 'currentColor'), REPO_URL: repository || '#build-notes', REPO_LABEL: repository ? 'View repository' : 'Read build requirements', REPO_NOTE: repository ? `Source and contribution details are available in the <a href="${escape(repository)}">project repository</a>.` : 'A public repository URL has not been configured for this local edition. The build commands below explain how to run a source checkout.' })) html = html.replaceAll(`{{${key}}}`, value);
for (const name of ['new-stage-12', 'gameplay', 'title', 'touch-pause']) {
  const size = name === 'new-stage-12' ? '640px' : name === 'gameplay' ? '768px' : '480px';
  html = html.replace(`src="assets/${name}.png"`, `src="assets/${name}.png" srcset="assets/${name}-960.png 960w, assets/${name}.png 1920w" sizes="(min-width: 1376px) ${size}, (min-width: 761px) 60vw, calc(100vw - 40px)"`);
}
await mkdir(path.join(here, 'assets'), { recursive: true });
for (const image of ['title.png', 'gameplay.png', 'touch-pause.png', 'new-stage-12.png']) await copyFile(path.join(root, 'docs/images', image), path.join(here, 'assets', image));
html = html.replace('href="style.css"', 'href="html/style.css"').replace('src="app.js"', 'src="html/app.js"')
  .replace(/(href|src)="assets\//g, '$1="html/assets/').replaceAll('srcset="assets/', 'srcset="html/assets/').replaceAll(', assets/', ', html/assets/');
await writeFile(path.join(docs, 'index.html'), html);
await writeFile(path.join(docs, '.nojekyll'), '');
await writeFile(path.join(docs, 'robots.txt'), `User-agent: *\nAllow: /\n${site ? `Sitemap: ${site}/sitemap.xml\n` : ''}`);
if (site) await writeFile(path.join(docs, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${escape(site)}/</loc></url></urlset>\n`);
else await rm(path.join(docs, 'sitemap.xml'), { force: true });
for (const obsolete of ['index.html', 'robots.txt', 'sitemap.xml']) await rm(path.join(here, obsolete), { force: true });
await writeFile(path.join(here, 'assets/wordmark.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 53 19"><g fill="#F2EDD6">${lettering('DANGEROUS', '#F2EDD6').replace('<svg ', '<svg y="0" width="53" height="7" ')}</g><g>${lettering('GABE', '#C5EF8A').replace('<svg ', '<svg y="10" width="53" height="9" ')}</g></svg>`);
console.log(`Built static field guide: 12 stages; repository ${repository ? 'configured' : 'unset'}; site ${site ? 'configured' : 'unset'}`);
