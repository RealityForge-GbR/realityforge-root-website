import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const pagePath = join(root, 'privacy-policy', 'tap-sonata', 'index.html');
const html = new TextDecoder('utf-8', { fatal: true }).decode(readFileSync(pagePath));
const main = html.match(/<main id="legal-content" class="legal-shell">([\s\S]*?)<\/main>/)?.[1];
const article = html.match(/<article class="legal-document">([\s\S]*?)<\/article>/)?.[1];
const decode = (value) => value.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) =>
  ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[name]);
const text = (value) => decode(value.replace(/<\/?a\b[^>]*>/g, '').replace(/<[^>]*>/g, ' '))
  .replace(/\s+/g, ' ').trim();

test('Tap Sonata uses the existing legal design and exact English metadata', () => {
  assert.match(html, /<html lang="en" data-theme="dark">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/);
  assert.match(html, /<title>Privacy Policy for Tap Sonata \| RealityForge<\/title>/);
  assert.match(html, /<meta name="robots" content="noindex,follow">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/realityforge\.eu\/privacy-policy\/tap-sonata\/">/);
  assert.match(html, /<link rel="stylesheet" href="\/assets\/styles\.css">/);
  assert.match(html, /<link rel="icon" type="image\/png" href="\/assets\/favicon\.png">/);
  for (const name of ['legal-page privacy-page', 'site-header legal-header', 'legal-intro',
    'legal-document', 'site-footer legal-footer']) assert.ok(html.includes(`class="${name}"`));
  assert.match(html, /href="#legal-content">Skip to content/);
  assert.doesNotMatch(html, />(?:Startseite|Impressum|Kontakt|Datenschutz)</);
});

test('Tap Sonata retains the complete supplied text, all 12 sections and four list items', () => {
  // tap-sonata-privacy-policy.txt SHA-256:
  // 0485c650310a40c399bd3aeb9a532d011a4c2a051c1c517300c4506d37b211c8.
  // Complete visible declaration, normalizing only whitespace and semantic list markers.
  assert.equal(createHash('sha256').update(text(main)).digest('hex'),
    'b596c2cdf48c861e3abfe6d3b32c3a103b8b190f69e93c0e2464fcc66ae45095');
  assert.deepEqual([...article.matchAll(/<h2>(\d+)\. /g)].map((match) => Number(match[1])),
    Array.from({ length: 12 }, (_, index) => index + 1));
  assert.equal([...article.matchAll(/<ul>/g)].length, 1);
  assert.equal([...article.matchAll(/<li>/g)].length, 4);
  assert.match(article, /Last updated: October 29, 2026/);
});

test('Tap Sonata has balanced semantic HTML, unique IDs and no malformed escaping', () => {
  const stack = [];
  for (const match of html.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    const [tag, name] = match;
    if (['meta', 'link', 'br'].includes(name)) continue;
    if (tag.startsWith('</')) assert.equal(stack.pop(), name, tag);
    else {
      if (name === 'li') assert.equal(stack.at(-1), 'ul');
      if (name === 'h2') assert.equal(stack.at(-1), 'article');
      if (name === 'p') assert.notEqual(stack.at(-1), 'p');
      stack.push(name);
    }
  }
  assert.deepEqual(stack, []);
  assert.equal([...html.matchAll(/<h1>/g)].length, 1);
  assert.doesNotMatch(html, /<h[3-6]\b|&(?!amp;|lt;|gt;|quot;|#39;)|\uFFFD/);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
});

test('Tap Sonata contact matches the supplied controller and existing legal notice', () => {
  const notice = readFileSync(join(root, 'legal-notice', 'index.html'), 'utf8');
  for (const value of ['RealityForge GbR', 'Biberacher Weg 3', '12247 Berlin', 'realityforgeeu@gmail.com']) {
    assert.ok(text(article).includes(value), value);
    assert.ok(notice.includes(value), value);
  }
  assert.ok(text(article).includes('12247 Berlin Germany Email: realityforgeeu@gmail.com'));
});

test('Tap Sonata makes every supplied HTTPS URL and email clickable', () => {
  const links = [...article.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)];
  assert.equal(links.length, 9);
  for (const [, encodedHref, encodedLabel] of links) {
    const href = decode(encodedHref), label = decode(encodedLabel);
    if (href.startsWith('mailto:')) assert.equal(href, `mailto:${label}`);
    else { assert.equal(new URL(href).protocol, 'https:'); assert.equal(href, label); }
  }
  const unlinked = article.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, '');
  assert.doesNotMatch(unlinked, /https:\/\/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  assert.match(article, /href="mailto:realityforgeeu@gmail\.com"/);
});

test('Tap Sonata is fully static and adds no scripts, forms, trackers or remote embeds', () => {
  assert.doesNotMatch(html, /<(?:script|iframe|form|style|img|object|embed|audio|video)\b|\son[a-z]+\s*=/i);
  for (const [tag] of html.matchAll(/<link\b[^>]+>/g)) {
    if (!tag.includes('rel="canonical"')) assert.match(tag, /href="\/(?!\/)/);
  }
  assert.doesNotMatch(html, /http-equiv=|\[\[|TODO|FIXME|Codex/i);
});

test('Tap Sonata has no incoming links from existing pages or sitemap and is not robots-blocked', () => {
  const skip = new Set(['.git', 'node_modules', '.wrangler', 'test', 'manga-share-worker']);
  const walk = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? (skip.has(entry.name) ? [] : walk(path)) : [path];
  });
  for (const path of walk(root).filter((path) => path.endsWith('.html') && path !== pagePath)) {
    assert.doesNotMatch(readFileSync(path, 'utf8'), /\/privacy-policy\/tap-sonata(?:\/|["'#?])/i, path);
  }
  assert.doesNotMatch(readFileSync(join(root, 'index.html'), 'utf8'), /Tap Sonata|tap-sonata/i);
  assert.doesNotMatch(readFileSync(join(root, 'sitemap.xml'), 'utf8'), /tap-sonata/i);
  const robots = readFileSync(join(root, 'robots.txt'), 'utf8');
  assert.match(robots, /Allow:\s*\//);
  assert.doesNotMatch(robots, /^Disallow:\s*\/(?:\s*$|privacy-policy)/im);
});
