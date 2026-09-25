// Builds the GitHub Pages doc site for this repo's Nostr Community Conventions.
//
// Convention: any top-level directory named `ncc-<digits>` (e.g. ncc-00, ncc-02,
// ncc-07, ncc-12) that contains a README.md is treated as a published NCC and
// gets its own doc page automatically. To publish a new NCC's docs, just add
// its folder with a README.md and push to master -- no changes needed here.

import { readdirSync, existsSync, readFileSync, mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const SITE_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = join(SITE_DIR, '..');
const OUT_DIR = join(ROOT, '_site');

const NCC_DIR_PATTERN = /^ncc-(\d+)$/;

function discoverConventions() {
  return readdirSync(ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && NCC_DIR_PATTERN.test(entry.name))
    .map((entry) => {
      const match = entry.name.match(NCC_DIR_PATTERN);
      const readmePath = join(ROOT, entry.name, 'README.md');
      if (!existsSync(readmePath)) return null;
      return {
        id: entry.name,
        number: match[1],
        label: `NCC-${match[1]}`,
        readmePath,
      };
    })
    .filter(Boolean)
    .sort((a, b) => Number(a.number) - Number(b.number));
}

function extractTitle(markdown, fallback, number) {
  let title = fallback;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const heading = line.match(/^#{1,2}\s+(.+)$/);
    title = heading ? heading[1].trim() : line;
    break;
  }
  // Strip a redundant "NCC-XX:" prefix since the label is shown alongside the title.
  const ownPrefix = new RegExp(`^NCC-0*${number}\\s*[:\\-–—]\\s*`, 'i');
  return title.replace(ownPrefix, '').trim() || fallback;
}

function layout({ title, nav, body }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${nav.assetPrefix}assets/style.css">
</head>
<body>
<header class="site-header">
  <a class="site-title" href="${nav.rootHref}">Nostr Community Conventions</a>
</header>
<div class="layout">
  <nav class="sidebar">
    <ul>
      ${nav.items.map((item) => `<li><a href="${item.href}"${item.current ? ' class="current"' : ''}>${escapeHtml(item.label)}</a></li>`).join('\n      ')}
    </ul>
  </nav>
  <main class="content">
    ${body}
  </main>
</div>
</body>
</html>
`;
}

function escapeHtml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function buildNavItems(conventions, currentId) {
  return [
    { href: currentId ? '../' : './', label: 'Overview', current: !currentId },
    ...conventions.map((c) => ({
      href: currentId ? (c.id === currentId ? './' : `../${c.id}/`) : `${c.id}/`,
      label: `${c.label} — ${c.title}`,
      current: c.id === currentId,
    })),
  ];
}

function main() {
  const conventions = discoverConventions().map((c) => ({
    ...c,
    markdown: readFileSync(c.readmePath, 'utf8'),
  }));
  conventions.forEach((c) => {
    c.title = extractTitle(c.markdown, c.label, c.number);
  });

  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(join(OUT_DIR, 'assets'), { recursive: true });
  copyFileSync(join(SITE_DIR, 'style.css'), join(OUT_DIR, 'assets', 'style.css'));

  // Index page
  const indexNav = { assetPrefix: '', rootHref: './', items: buildNavItems(conventions, null) };
  const indexBody = `
    <h1>Nostr Community Conventions</h1>
    <p>Documented shared usage patterns for existing Nostr primitives. Each convention below is generated directly from its <code>ncc-XX/README.md</code> in the repository.</p>
    <ul class="ncc-list">
      ${conventions
        .map(
          (c) => `<li><a href="${c.id}/">${escapeHtml(c.label)}</a> — ${escapeHtml(c.title)}</li>`
        )
        .join('\n      ')}
    </ul>
  `;
  writeFileSync(join(OUT_DIR, 'index.html'), layout({ title: 'Nostr Community Conventions', nav: indexNav, body: indexBody }));

  // Per-NCC pages
  for (const c of conventions) {
    const pageDir = join(OUT_DIR, c.id);
    mkdirSync(pageDir, { recursive: true });
    const nav = { assetPrefix: '../', rootHref: '../', items: buildNavItems(conventions, c.id) };
    const body = marked.parse(c.markdown);
    writeFileSync(join(pageDir, 'index.html'), layout({ title: `${c.label} — ${c.title}`, nav, body }));
  }

  console.log(`Built docs for ${conventions.length} convention(s): ${conventions.map((c) => c.label).join(', ')}`);
}

main();
