import assert from "node:assert/strict";
import test from "node:test";

import { handleRequest, isValidIsbn13, normalizeManga, renderMangaPage } from "../src/app.js";

const ISBN = "9783551771575";

function checkedIsbn(prefix12) {
  const sum = [...prefix12].reduce((total, digit, index) => total + Number(digit) * (index % 2 ? 3 : 1), 0);
  return `${prefix12}${(10 - (sum % 10)) % 10}`;
}

const sampleManga = {
  isbn: ISBN,
  title: "Rental Girlfriend 1",
  subtitle: "Ein neuer Anfang",
  series: "Rental Girlfriend",
  volume: "1",
  publisher: "Carlsen",
  contributors: [
    { name: "Reiji Miyajima", role: "Autor" },
    { name: "Jens Ossa", role: "Übersetzung" },
  ],
  publication_date: "28.01.2020",
  prices: [
    { amount: "7", currency: "EUR", type: "04" },
    { amount: "7.2", currency: "EUR", type: "04" },
  ],
  edition: "5",
  description: "Erster Absatz.\n\nZweiter Absatz.",
  description_type: "description",
  language: "Deutsch",
  binding: "Großtaschenbuch",
  page_count: 192,
  age_recommendation: "14",
};

function request(path, method = "GET") {
  return new Request(`https://manga.realityforge.eu${path}`, { method });
}

function environment({ apiStatus = 200, apiBody = { ok: true, manga: sampleManga }, coverStatus = 200, coverType = "image/jpeg", fetchImpl } = {}) {
  const calls = [];
  const mockFetch = fetchImpl || (async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/cover")) return new Response(new Uint8Array([255, 216, 255]), { status: coverStatus, headers: { "Content-Type": coverType } });
    return new Response(typeof apiBody === "string" ? apiBody : JSON.stringify(apiBody), { status: apiStatus, headers: { "Content-Type": "application/json" } });
  });
  return { env: { MANGA_API_BASE: "https://api.example.test", FETCH: mockFetch }, calls };
}

test("ISBN-13 validation accepts valid 978 and 979 identifiers", () => {
  assert.equal(isValidIsbn13(ISBN), true);
  assert.equal(isValidIsbn13(checkedIsbn("979123456789")), true);
});

test("ISBN-13 validation rejects checksum, length, letters and non-book prefixes", () => {
  assert.equal(isValidIsbn13("9783551771574"), false);
  assert.equal(isValidIsbn13("978355177157"), false);
  assert.equal(isValidIsbn13("978355177157X"), false);
  assert.equal(isValidIsbn13(checkedIsbn("977123456789")), false);
});

test("normalization whitelists fields and rejects incomplete records", () => {
  const normalized = normalizeManga({ ...sampleManga, injected: "ignored" });
  assert.equal(normalized.title, sampleManga.title);
  assert.equal("injected" in normalized, false);
  assert.equal(normalizeManga({ isbn: ISBN }), null);
});

test("SSR contains real content, metadata, canonical URL, JSON-LD and exact CTA", async () => {
  const { env } = environment();
  const response = await handleRequest(request(`/manga/${ISBN}`), env);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<h1 class="title">Rental Girlfriend 1<\/h1>/);
  assert.match(html, /Reiji Miyajima/);
  assert.match(html, /7,20&nbsp;€|7,20 €/);
  assert.match(html, /28\. Januar 2020/);
  assert.match(html, /<link rel="canonical" href="https:\/\/manga\.realityforge\.eu\/manga\/9783551771575">/);
  assert.match(html, /property="og:title" content="Rental Girlfriend 1"/);
  assert.match(html, /property="og:description" content="Rental Girlfriend 1 ist erschienen\. In Manga Tracker ansehen\."/);
  assert.match(html, /name="twitter:card" content="summary_large_image"/);
  assert.match(html, /property="og:url" content="https:\/\/manga\.realityforge\.eu\/manga\/9783551771575"/);
  assert.match(html, /property="og:image" content="https:\/\/api\.example\.test\/manga\/9783551771575\/cover"/);
  assert.match(html, /"@type":"Book"/);
  assert.match(html, />Manga Tracker bei Google Play<\/a>/);
  assert.doesNotMatch(html, /amazon/i);
});

test("cover endpoint is checked with GET and used in visible and social markup", async () => {
  const { env, calls } = environment();
  const response = await handleRequest(request(`/manga/${ISBN}`), env);
  const html = await response.text();
  const coverCall = calls.find(({ url }) => url.endsWith("/cover"));
  assert.equal(coverCall.init.method, "GET");
  assert.equal(coverCall.init.headers.Range, "bytes=0-0");
  assert.match(html, /https:\/\/api\.example\.test\/manga\/9783551771575\/cover/);
});

test("missing cover uses the neutral local fallback without failing the page", async () => {
  const { env } = environment({ coverStatus: 404, coverType: "application/json" });
  const response = await handleRequest(request(`/manga/${ISBN}`), env);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /https:\/\/manga\.realityforge\.eu\/manga-tracker-og\.png/);
});

test("paragraphs are preserved and flap text receives the requested heading", () => {
  const manga = normalizeManga({ ...sampleManga, description_type: "flap_text" });
  const html = renderMangaPage(manga, "");
  assert.match(html, /<h2 id="description">Klappentext<\/h2><p>Erster Absatz\.<\/p><p>Zweiter Absatz\.<\/p>/);
});

test("missing optional values omit their visual sections", () => {
  const manga = normalizeManga({ isbn: ISBN, title: "Nur ein Titel" });
  const html = renderMangaPage(manga, "");
  assert.doesNotMatch(html, /class="subtitle"/);
  assert.doesNotMatch(html, /class="authors"/);
  assert.doesNotMatch(html, /id="description"/);
  assert.match(html, />ISBN<\/dt>/);
});

test("missing price, author, volume and series do not create empty labels", () => {
  const manga = normalizeManga({ isbn: ISBN, title: "Schlichter Manga", publisher: "Verlag" });
  const html = renderMangaPage(manga, "");
  assert.doesNotMatch(html, /class="authors"/);
  assert.doesNotMatch(html, />Preis<\/dt>|>Band<\/dt>|>Reihe<\/dt>/);
  assert.match(html, />Verlag<\/dt><dd>Verlag<\/dd>/);
});

test("long titles and contributor names remain escape-safe and wrappable", () => {
  const longTitle = "Ein außergewöhnlich langer Manga-Titel ".repeat(8).trim();
  const longAuthor = "Autorin mit einem sehr langen Namen ".repeat(6).trim();
  const manga = normalizeManga({ ...sampleManga, title: longTitle, contributors: [{ name: longAuthor, role: "Autorin" }] });
  const html = renderMangaPage(manga, "");
  assert.match(html, /class="title"/);
  assert.match(html, new RegExp(longAuthor));
  assert.match(html, /overflow-wrap:anywhere/);
});

test("backend data is escaped in HTML attributes, visible content and JSON-LD", async () => {
  const dangerous = {
    ...sampleManga,
    title: `Bad <script>alert("x")</script> & title`,
    subtitle: `\"><img src=x onerror=alert(1)>`,
    publisher: `A & B`,
    description: `Hello </script><script>alert(2)</script> & goodbye`,
    contributors: [{ name: `<svg onload=alert(3)>`, role: "Autor" }],
  };
  const { env } = environment({ apiBody: { manga: dangerous } });
  const html = await (await handleRequest(request(`/manga/${ISBN}`), env)).text();
  assert.doesNotMatch(html, /<script>alert/);
  assert.doesNotMatch(html, /<img src=x/);
  assert.doesNotMatch(html, /<svg onload/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /A &amp; B/);
  assert.match(html, /\\u003c\/script>/);
});

test("invalid ISBN and path injection produce a friendly 404 without backend access", async () => {
  for (const path of ["/manga/9783551771574", "/manga/978355177157", "/manga/97835517715755", "/manga/978355177157X", "/manga/978355177157!", "/manga/9783551771575%2Fadmin", "/manga/%3Cscript%3E"]) {
    const { env, calls } = environment();
    const response = await handleRequest(request(path), env);
    assert.equal(response.status, 404);
    assert.equal(calls.length, 0);
    assert.match(await response.text(), /Manga nicht gefunden/);
  }
});

test("backend 404 maps to public 404 and skips the cover request", async () => {
  const { env, calls } = environment({ apiStatus: 404, apiBody: { ok: false } });
  const response = await handleRequest(request(`/manga/${ISBN}`), env);
  assert.equal(response.status, 404);
  assert.match(response.headers.get("cache-control"), /s-maxage=120/);
  assert.equal(calls.length, 1);
});

test("backend 500 maps to an uncached 503", async () => {
  const { env } = environment({ apiStatus: 500, apiBody: { ok: false } });
  const response = await handleRequest(request(`/manga/${ISBN}`), env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("invalid backend JSON maps to an uncached 503", async () => {
  const { env } = environment({ apiBody: "{" });
  const response = await handleRequest(request(`/manga/${ISBN}`), env);
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("cache-control"), "no-store");
});

test("network failures and aborts map to an uncached 503", async () => {
  for (const error of [new Error("offline"), new DOMException("timed out", "AbortError")]) {
    const { env } = environment({ fetchImpl: async () => { throw error; } });
    const response = await handleRequest(request(`/manga/${ISBN}`), env);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
});

test("GET and HEAD return matching status and headers while HEAD has no body", async () => {
  const getEnv = environment().env;
  const headEnv = environment().env;
  const getResponse = await handleRequest(request(`/manga/${ISBN}`), getEnv);
  const headResponse = await handleRequest(request(`/manga/${ISBN}`, "HEAD"), headEnv);
  assert.equal(headResponse.status, getResponse.status);
  assert.equal(headResponse.headers.get("content-type"), getResponse.headers.get("content-type"));
  assert.equal(await headResponse.text(), "");
});

test("unsupported methods return 405 and an Allow header", async () => {
  const response = await handleRequest(request(`/manga/${ISBN}`, "POST"));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
});

test("assetlinks route is valid preparation without an invented fingerprint", async () => {
  const response = await handleRequest(request("/.well-known/assetlinks.json"));
  const payload = await response.json();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-assetlinks-configuration"), "incomplete");
  assert.equal(payload[0].target.package_name, "eu.realityforge.mangatracker");
  assert.deepEqual(payload[0].target.sha256_cert_fingerprints, []);
});

test("assetlinks includes only valid configured SHA-256 fingerprints", async () => {
  const fingerprint = Array(32).fill("AB").join(":");
  const response = await handleRequest(request("/.well-known/assetlinks.json"), { ANDROID_SHA256_CERT_FINGERPRINTS: `${fingerprint},invalid` });
  const payload = await response.json();
  assert.equal(response.headers.get("x-assetlinks-configuration"), "complete");
  assert.deepEqual(payload[0].target.sha256_cert_fingerprints, [fingerprint]);
});

test("landing page is SSR, tracking-free and links to the Play Store", async () => {
  const response = await handleRequest(request("/"));
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /<h1>Manga Tracker<\/h1>/);
  assert.match(html, /play\.google\.com/);
  assert.doesNotMatch(html, /google-analytics|googletagmanager|facebook\.net/i);
  assert.doesNotMatch(html, /<script src=/i);
});

test("security and cache headers are present on successful pages", async () => {
  const { env } = environment();
  const response = await handleRequest(request(`/manga/${ISBN}`), env);
  assert.match(response.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(response.headers.get("cache-control"), /s-maxage=900/);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
});
