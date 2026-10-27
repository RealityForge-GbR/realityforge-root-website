import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const bytes = readFileSync(new URL('../privacy-policy/manga-tracker/index.html', import.meta.url));
const html = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const article = html.match(/<article class="legal-document">([\s\S]*?)<\/article>/)?.[1];
const main = html.match(/<main id="legal-content" class="legal-shell">([\s\S]*?)<\/main>/)?.[1];
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
  assert.match(html, /<h1>DATENSCHUTZERKLÄRUNG FÜR DIE ANDROID-APP „MANGA TRACKER“<\/h1>/);
});

test('contains every section, in order, and both complete source lists', () => {
  const headings = [...article.matchAll(/<h2>([^<]+)<\/h2>/g)].map((match) => decode(match[1]));
  assert.equal(headings.length, 25);
  assert.deepEqual(headings.map((heading) => Number(heading.split('.')[0])),
    Array.from({ length: 25 }, (_, index) => index + 1));
  assert.deepEqual([...article.matchAll(/<h3>(\d+\.\d+) /g)].map((match) => match[1]),
    ['8.1', '8.2', '8.3', '8.4', '9.1', '9.2', '9.3', '9.4']);
  assert.equal([...article.matchAll(/<ul>/g)].length, 2);
  assert.equal([...article.matchAll(/<li>/g)].length, 13);
  assert.match(article, /Fassung für Version 1\.0\.4 \(versionCode 6\)/);
  assert.match(article, /Stand: 27\. Oktober 2026/);
  assert.match(article, /Ende der Datenschutzerklärung\./);
});

test('retains the complete verbatim 1.0.4 source, including title, preface and ending', () => {
  // Golden text: complete Manga_Tracker_Datenschutzerklaerung_1.0.4_2026-10-27.txt.
  // Only whitespace and semantic list markers are normalized; no wording amendments.
  // Original TXT SHA-256: ae2251c555da9f2a7faa9e5f0dc546c2830c4d9899bef87b88956b2c976c5827.
  const digest = createHash('sha256').update(text(main)).digest('hex');
  assert.equal(digest, 'ff9d46bc0ffa32cbff45d59d4f3ac6ef23552242ba4125d2613a9c41fdf90b27');
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
      if (name === 'h3') assert.equal(stack.at(-1), 'article');
      if (name === 'p') assert.notEqual(stack.at(-1), 'p');
      stack.push(name);
    }
  }
  assert.deepEqual(stack, []);
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, new Set(ids).size);
  const levels = [...main.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
  for (let index = 1; index < levels.length; index++) assert.ok(levels[index] <= levels[index - 1] + 1);
  assert.doesNotMatch(article, /<h[4-6]\b/);
  assert.doesNotMatch(html, /&(?!amp;|lt;|gt;|quot;|#39;)/);
});

test('marks every source URL and email as a valid, readable link', () => {
  const links = [...article.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)];
  assert.equal(links.length, 33);
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

test('retains the source joint analytics choice, withdrawal, minimisation and documented retention', () => {
  const analytics = text(section(8));
  for (const expected of ['standardmäßig ausgeschaltet', 'eine einzige freiwillige Einwilligung',
    '„Erlauben“ aktiviert nach erfolgreicher Speicherung', '„Nicht erlauben“ hält beide ausgeschaltet',
    'nicht automatisch als neue Zustimmung übernommen', 'einmal erneut ab',
    'keine separate Zustimmung oder einen getrennten Schalter',
    'journey_consent=extended', 'eine Ausschaltung beendet beide', 'widerrufen',
    'keine konkreten ISBNs', 'eingegebenen Suchtexte', 'zwei Monate', '14 Monate',
    'bei weiterer Aktivität zurücksetzen']) {
    assert.ok(analytics.includes(expected), expected);
  }
});

test('retains the source 1.0.4 push activation, existing-choice handling and operator notices', () => {
  const push = text(section(9));
  for (const expected of ['in Version 1.0.4 beginnt Push bei neuen Installationen deaktiviert',
    'unabhängig von der Android-Version', 'dokumentierte bewusste Nutzerentscheidung',
    'Bereits ausdrücklich ausgeschaltete Push-Funktionen bleiben aus',
    'Erst nach einer bewussten Aktivierung in der App', 'Ab Android 13',
    'App-Mitteilungen', 'Meine Reihen', 'Erscheinungstermine', 'Einkaufsliste', 'Neuheiten & Rückkehr',
    'Eine Kategorieauswahl allein aktiviert einen ausgeschalteten Push-Hauptschalter nicht',
    'keine eigene personenbezogene Datenbank der FCM-Registrierungstoken',
    'nicht automatisch die sofortige Löschung der FID',
    'Normal, Wichtig und Update erforderlich', 'keine Werbefunktion']) {
    assert.ok(push.includes(expected), expected);
  }
});

test('retains the source review/update, share-domain and external affiliate descriptions', () => {
  assert.match(text(section(12)), /Version 1\.0\.4.*Google-Play-App.*Browser/);
  assert.match(text(section(12)), /Prüfung der Update-Verfügbarkeit/);
  assert.match(text(section(14)), /https:\/\/mangatracker\.de\/manga\/\[ISBN\].*https:\/\/manga\.realityforge\.eu\/manga\/\[ISBN\]/);
  assert.match(text(section(15)), /Amazon.*Thalia\/Awin/);
  assert.match(text(section(15)), /kein Awin-Webtracking-SDK/);
});

test('retains the backup, pseudonymous telemetry, provider and data-subject disclosures', () => {
  assert.match(text(section(4)), /ZIP-basiert.*nicht durch ein eigenes Passwort verschlüsselt/);
  assert.match(text(section(6)), /HMAC-SHA-256.*128 Bit.*pseudonymer HMAC-Wert/);
  assert.match(text(section(6)), /drei Monate/);
  assert.match(text(section(19)), /Art\. 46 DSGVO/);
  assert.match(text(section(22)), /Art\. 15 DSGVO.*Art\. 16 DSGVO.*Art\. 17 DSGVO.*Art\. 18 DSGVO.*Art\. 20 DSGVO.*Art\. 21 DSGVO/);
  assert.match(text(section(24)), /Art\. 22 DSGVO/);
});

test('contains no editing notes, replacement characters, placeholders or external embeds', () => {
  assert.doesNotMatch(html, /\uFFFD|\[\[|\]\]|TODO|FIXME|Codex|Entwurf|FIREBASE_ANALYTICS_AUFBEWAHRUNG/);
  assert.doesNotMatch(html, /<(?:script|iframe|style)\b|\son[a-z]+\s*=/i);
  assert.match(html, /ÜBERTRAGUNG/);
  assert.match(html, /„MANGA TRACKER“/);
});
