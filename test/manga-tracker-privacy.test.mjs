import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bytes = readFileSync(new URL('../privacy-policy/manga-tracker/index.html', import.meta.url));
const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const article = html.match(/<article class="legal-document">([\s\S]*?)<\/article>/)?.[1];
const decode = (text) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, entity) =>
  ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" })[entity]);
const text = (markup) => decode(markup.replace(/<\/?a\b[^>]*>/g, '').replace(/<[^>]*>/g, ' '))
  .replace(/\s+/g, ' ').trim();
const section = (number) => article.match(new RegExp(`<h2>${number}\\.[\\s\\S]*?(?=<h2>|$)`))?.[0];

test('preserves the public identity, metadata and existing page shell', () => {
  assert.match(html, /<html lang="de" data-theme="dark">/);
  assert.match(html, /<meta charset="utf-8">/);
  assert.match(html, /<title>Datenschutzerklärung für Manga Tracker · RealityForge<\/title>/);
  assert.match(html, /<meta name="description" content="Datenschutzerklärung für die Android-App Manga Tracker der RealityForge GbR\.">/);
  assert.match(html, /<meta name="robots" content="noindex,follow">/);
  assert.match(html, /<link rel="canonical" href="https:\/\/realityforge\.eu\/privacy-policy\/manga-tracker\/">/);
  assert.match(html, /<link rel="icon" type="image\/png" href="\/assets\/favicon\.png">/);
  assert.match(html, /<link rel="stylesheet" href="\/assets\/styles\.css">/);
  assert.match(html, /<body class="legal-page privacy-page">/);
  assert.match(html, /<main id="legal-content" class="legal-shell">/);
  assert.match(html, /<a class="skip-link" href="#legal-content">Zum Inhalt springen<\/a>/);
  assert.equal([...html.matchAll(/<h1\b/g)].length, 1);
  assert.match(html, /<h1>Datenschutzerklärung für die Android-App „Manga Tracker“<\/h1>/);
});

test('contains every section, in order, and both complete source lists', () => {
  const headings = [...article.matchAll(/<h2>([^<]+)<\/h2>/g)].map((match) => decode(match[1]));
  assert.equal(headings.length, 25);
  assert.deepEqual(headings.map((heading) => Number(heading.split('.')[0])),
    Array.from({ length: 25 }, (_, index) => index + 1));
  assert.equal([...article.matchAll(/<ul>/g)].length, 2);
  assert.equal([...article.matchAll(/<li>/g)].length, 18);
  assert.match(article, /Stand: 17\. Oktober 2026/);
});

test('retains the complete source wording except the documented version-specific corrections', () => {
  // Golden text: complete 2026-10-17 TXT sections 1–25, without list markers;
  // only sections 12, 14 and 15 have the factual version distinctions recorded in PR #3.
  // Original TXT SHA-256: 2c2eb0dfa5ebbbb6dbd0146ed3ea377091d583160b012ee7e77b0c3cc363aa3c.
  const policy = article.slice(article.indexOf('<h2>1.'));
  const digest = createHash('sha256').update(text(policy)).digest('hex');
  assert.equal(digest, 'bc84bcee9828edf7ddc8276d64067df4c6a72ad7f1e2ade545038128f94381b9');
});

test('has balanced semantic HTML, valid list nesting, unique IDs and no heading-level skips', () => {
  const stack = [];
  const voids = new Set(['meta', 'link', 'br']);
  for (const match of html.matchAll(/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi)) {
    const [tag, rawName] = match;
    const name = rawName.toLowerCase();
    if (voids.has(name)) continue;
    if (tag.startsWith('</')) assert.equal(stack.pop(), name, `Unbalanced ${tag}`);
    else {
      if (name === 'li') assert.equal(stack.at(-1), 'ul');
      if (name === 'h2') assert.equal(stack.at(-1), 'article');
      if (name === 'p') assert.notEqual(stack.at(-1), 'p');
      stack.push(name);
    }
  }
  assert.deepEqual(stack, []);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  assert.doesNotMatch(article, /<h[3-6]\b/);
  assert.doesNotMatch(html, /&(?!amp;|lt;|gt;|quot;|#39;)/);
});

test('marks every source URL and email as a valid, readable link', () => {
  const links = [...article.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)];
  assert.ok(links.length >= 30);
  for (const [, encodedHref, encodedLabel] of links) {
    const href = decode(encodedHref);
    const label = decode(encodedLabel);
    if (href.startsWith('mailto:')) assert.equal(href, `mailto:${label}`);
    else {
      assert.equal(new URL(href).protocol, 'https:');
      assert.equal(href, label);
    }
  }
  const unlinked = article.replace(/<a\b[^>]*>[\s\S]*?<\/a>/g, '');
  assert.doesNotMatch(unlinked, /https:\/\/|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
  assert.match(article, /href="mailto:realityforgeeu@gmail\.com"/);
});

test('retains Analytics opt-in, withdrawal, event minimisation and verified retention', () => {
  const analytics = text(section(8));
  for (const expected of ['standardmäßig deaktiviert', 'gesonderten ausdrücklichen Zustimmung',
    'nicht für eine spätere Übermittlung gepuffert', 'widerrufen', 'keine konkreten ISBNs',
    'eingegebenen Suchbegriffe', 'zwei Monate', '14 Monate', 'bei neuer Aktivität zurückgesetzt']) {
    assert.ok(analytics.includes(expected), expected);
  }
});

test('preserves the requested explicit push opt-in as a release requirement, not a default-on claim', () => {
  const push = text(section(9));
  for (const expected of ['Bei Neuinstallationen ist die externe Push-Zustellung zunächst deaktiviert',
    'ausdrücklich aktiviert', 'Ab Android 13', 'Auf Android 8 bis 12', 'bereits getroffene',
    'lokal auf dem Gerät', 'keine nutzerspezifische FCM-Token-Datenbank', 'bis zu 180 Tagen',
    'nicht zugesagt', 'widerrufen']) assert.ok(push.includes(expected), expected);
  assert.doesNotMatch(push, /standardmäßig eingeschaltet|voreingeschaltet/);
});

test('distinguishes published and planned review, share-domain and Thalia behavior', () => {
  assert.match(text(section(12)), /1\.0\.1.*In-App-Review-Schnittstelle.*1\.0\.2.*Store-Seite/);
  assert.match(text(section(14)), /1\.0\.1.*manga\.realityforge\.eu\/manga\/.*1\.0\.2.*mangatracker\.de\/manga\//);
  assert.match(text(section(15)), /1\.0\.1 bietet Amazon-Kaufaktionen.*Thalia-\/Awin-Kaufaktion ist für Version 1\.0\.2 vorgesehen/);
});

test('retains the backup, pseudonymous telemetry, provider and data-subject disclosures', () => {
  assert.match(text(section(4)), /ZIP-basiertes Archiv.*nicht mit einem Passwort verschlüsselt/);
  assert.match(text(section(6)), /HMAC-SHA-256.*128 Bit.*pseudonymisiert, nicht anonymisiert/);
  assert.match(text(section(6)), /drei Monate/);
  assert.match(text(section(19)), /Art\. 46 DSGVO/);
  assert.match(text(section(22)), /Art\. 15 DSGVO.*Art\. 16 DSGVO.*Art\. 17 DSGVO.*Art\. 18 DSGVO.*Art\. 20 DSGVO.*Art\. 21 DSGVO/);
  assert.match(text(section(24)), /Art\. 22 DSGVO/);
});

test('contains no editing notes, replacement characters, placeholders or external embeds', () => {
  assert.doesNotMatch(html, /\uFFFD|\[\[|\]\]|TODO|FIXME|Codex|Entwurf|FIREBASE_ANALYTICS_AUFBEWAHRUNG/);
  assert.doesNotMatch(html, /<(?:script|iframe|style)\b|\son[a-z]+\s*=/i);
  assert.match(html, /Übermittlung|Überblick/);
  assert.match(html, /ausdrückliche/);
});
