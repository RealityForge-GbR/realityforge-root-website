import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

import { handleRequest, isValidIsbn13, normalizeManga, probeCover, renderMangaPage } from "../src/app.js";

const ISBN = "9783551771575";
const CANONICAL_API = "https://api.manga.realityforge.eu";
const LEGACY_API = "https://manga-tracker-api.realityforgeeu.workers.dev";
const FALLBACK = "https://manga.realityforge.eu/manga-tracker-og.png";

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

function environment({ apiStatus = 200, apiBody = { ok: true, manga: sampleManga }, coverStatus = 200, coverType = "image/jpeg", coverBody = new Uint8Array([255, 216, 255]), fetchImpl } = {}) {
  const calls = [];
  const mockFetch = fetchImpl || (async (input, init = {}) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/cover")) return new Response(coverBody, { status: coverStatus, headers: { "Content-Type": coverType } });
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
  assert.equal(coverCall.init.headers.Range, "bytes=0-31");
  assert.equal(coverCall.init.redirect, "manual");
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

test("assetlinks excludes invalid fingerprints and diagnoses a mixed configuration", async () => {
  const fingerprint = Array(32).fill("AB").join(":");
  const response = await handleRequest(request("/.well-known/assetlinks.json"), { ANDROID_SHA256_CERT_FINGERPRINTS: `${fingerprint},invalid` });
  const payload = await response.json();
  assert.equal(response.headers.get("x-assetlinks-configuration"), "invalid");
  assert.equal(response.headers.get("cache-control"), "no-store");
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

test("canonical production API yields a direct 200 cover and matching CSP/social URLs", async () => {
  const { env, calls } = environment();
  delete env.MANGA_API_BASE;
  const response = await handleRequest(request(`/manga/${ISBN}`), env);
  const html = await response.text();
  const image = `${CANONICAL_API}/manga/${ISBN}/cover`;
  assert.equal(response.status, 200);
  assert.deepEqual(calls.map(({ url }) => url), [`${CANONICAL_API}/manga/${ISBN}`, image]);
  assert.ok(html.includes(`src="${image}"`));
  assert.ok(html.includes(`property="og:image" content="${image}"`));
  assert.ok(html.includes(`name="twitter:image" content="${image}"`));
  assert.ok(html.includes(`"image":"${image}"`));
  assert.ok(response.headers.get("content-security-policy").includes(`img-src 'self' ${CANONICAL_API};`));
  assert.ok(!html.includes(LEGACY_API));
  assert.ok(!response.headers.get("content-security-policy").includes(LEGACY_API));
});

test("old API configuration is canonicalized while the existing service binding is preferred", async () => {
  const urls = [];
  const env = {
    MANGA_API_BASE: `${LEGACY_API}/`,
    FETCH: () => assert.fail("must use the service binding"),
    MANGA_API: { fetch: async (input) => {
      assert.ok(input instanceof Request);
      urls.push(input.url);
      if (input.url.endsWith("/cover")) {
        assert.equal(input.redirect, "manual");
        return new Response(new Uint8Array([255, 216, 255]), { headers: { "Content-Type": "image/jpeg" } });
      }
      return Response.json({ manga: sampleManga });
    } },
  };
  const response = await handleRequest(request(`/manga/${ISBN}`), env);
  assert.equal(response.status, 200);
  assert.deepEqual(urls, [`${CANONICAL_API}/manga/${ISBN}`, `${CANONICAL_API}/manga/${ISBN}/cover`]);
});

test("a legacy cover 307 follows only the existing canonical API bridge", async () => {
  const legacyUrl = `${LEGACY_API}/manga/${ISBN}/cover`;
  const canonicalUrl = `${CANONICAL_API}/manga/${ISBN}/cover`;
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, "manual");
    if (url === legacyUrl) return new Response(null, { status: 307, headers: { Location: canonicalUrl } });
    return new Response(new Uint8Array([255, 216, 255]), { headers: { "Content-Type": "image/jpeg" } });
  };
  assert.equal(await probeCover(fetcher, legacyUrl), canonicalUrl);
  assert.deepEqual(calls, [legacyUrl, canonicalUrl]);
  const html = renderMangaPage(normalizeManga(sampleManga), canonicalUrl);
  assert.ok(html.includes(`src="${canonicalUrl}"`));
  assert.ok(!html.includes(legacyUrl));
});

test("unexpected cover redirects and redirect loops fail closed without extra origins", async () => {
  for (const location of ["https://untrusted.example/cover", `${CANONICAL_API}/other`, `${LEGACY_API}/manga/${ISBN}/cover`]) {
    let calls = 0;
    assert.equal(await probeCover(async () => {
      calls++;
      return new Response(null, { status: 307, headers: { Location: location } });
    }, `${LEGACY_API}/manga/${ISBN}/cover`), "");
    assert.equal(calls, 1);
  }
  let calls = 0;
  assert.equal(await probeCover(async () => {
    calls++;
    return new Response(null, { status: 307, headers: { Location: `${CANONICAL_API}/manga/${ISBN}/cover` } });
  }, `${LEGACY_API}/manga/${ISBN}/cover`), "");
  assert.equal(calls, 2);
});

test("404, 502, non-image, empty and forged image responses use fallback in visible/social markup", async () => {
  for (const options of [
    { coverStatus: 404 }, { coverStatus: 502 },
    { coverType: "text/html", coverBody: "<html>error</html>" },
    { coverType: "image/jpeg", coverBody: "not an image" },
    { coverType: "image/png", coverBody: new Uint8Array() },
  ]) {
    const response = await handleRequest(request(`/manga/${ISBN}`), environment(options).env);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.ok(html.includes(`src="${FALLBACK}"`));
    assert.ok(html.includes(`property="og:image" content="${FALLBACK}"`));
    assert.ok(html.includes(`name="twitter:image" content="${FALLBACK}"`));
    assert.ok(html.includes(`"image":"${FALLBACK}"`));
  }
});

test("an existing fallback asset is served via ASSETS without API calls", async () => {
  const image = readFileSync(new URL("../public/manga-tracker-og.png", import.meta.url));
  const response = await handleRequest(request("/manga-tracker-og.png"), {
    FETCH: () => assert.fail("fallback must not call the API"),
    ASSETS: { fetch: async (input) => {
      assert.ok(input.url.endsWith("/manga-tracker-og.png"));
      return new Response(image, { headers: { "Content-Type": "image/png" } });
    } },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.deepEqual(new Uint8Array(await response.arrayBuffer()), new Uint8Array(image));
});

function clientScriptFrom(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1];
}

function runClient({ ua = "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0", complete = false, naturalWidth = 600 } = {}) {
  const html = renderMangaPage(normalizeManga(sampleManga), `${CANONICAL_API}/manga/${ISBN}/cover`);
  const intent = /data-android-intent="([^"]+)"/.exec(html)[1];
  const listeners = [];
  const cover = { src: `${CANONICAL_API}/manga/${ISBN}/cover`, dataset: { fallback: FALLBACK }, complete, naturalWidth,
    addEventListener: (...args) => listeners.push(args) };
  const openApp = { href: `https://manga.realityforge.eu/manga/${ISBN}`, hidden: true, dataset: { androidIntent: intent } };
  runInNewContext(clientScriptFrom(html), {
    document: { querySelector: () => cover, getElementById: () => openApp }, navigator: { userAgent: ua },
  });
  return { cover, openApp, listeners };
}

test("CSP hash authorizes exactly the fixed fallback script, with no inline handler allowance", async () => {
  const response = await handleRequest(request(`/manga/${ISBN}`), environment().env);
  const html = await response.text();
  const hash = createHash("sha256").update(clientScriptFrom(html)).digest("base64");
  const csp = response.headers.get("content-security-policy");
  assert.ok(csp.includes(`script-src 'sha256-${hash}';`));
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline|unsafe-eval/);
  assert.doesNotMatch(html, /<[^>]+\sonerror=/);
});

test("browser decode/late HTTP errors fall back once, including errors before listener attachment", () => {
  const { cover, listeners } = runClient();
  assert.equal(listeners[0][0], "error");
  assert.equal(listeners[0][2].once, true);
  listeners[0][1]();
  assert.equal(cover.src, FALLBACK);
  // Even a repeated callback cannot restart a failing fallback request.
  listeners[0][1]();
  assert.equal(cover.src, FALLBACK);
  assert.equal(runClient({ complete: true, naturalWidth: 0 }).cover.src, FALLBACK);
  assert.notEqual(runClient({ complete: true, naturalWidth: 600 }).cover.src, FALLBACK);
});

test("explicit Android Chrome action targets only Manga Tracker and falls back to this webpage", () => {
  const { openApp } = runClient({ ua: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/140.0.0.0 Mobile Safari/537.36" });
  assert.equal(openApp.hidden, false);
  assert.equal(openApp.href, `intent://manga.realityforge.eu/manga/${ISBN}#Intent;scheme=https;package=eu.realityforge.mangatracker;S.browser_fallback_url=${encodeURIComponent(`https://manga.realityforge.eu/manga/${ISBN}`)};end`);
});

test("other platforms, browsers and WebViews do not receive the Android intent action", () => {
  for (const ua of [
    "Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0",
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0) Safari/604.1",
    "Mozilla/5.0 (Android 15) Firefox/140.0",
    "Mozilla/5.0 (Android 15) Chrome/140.0 SamsungBrowser/28.0",
    "Mozilla/5.0 (Android 15) Chrome/140.0 EdgA/140.0",
    "Mozilla/5.0 (Android 15; wv) Version/4.0 Chrome/140.0",
  ]) {
    const { openApp } = runClient({ ua });
    assert.equal(openApp.hidden, true);
    assert.ok(openApp.href.startsWith("https://manga.realityforge.eu/manga/"));
  }
});

test("valid certificate lists yield HTTP 200 JSON, complete configuration and no redirect", async () => {
  const fingerprint = Array(32).fill("AB").join(":"); // Test fixture only, never production configuration.
  for (const method of ["GET", "HEAD"]) {
    const response = await handleRequest(request("/.well-known/assetlinks.json", method), {
      ANDROID_SHA256_CERT_FINGERPRINTS: `${fingerprint.toLowerCase()},${fingerprint}`,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /^application\/json/);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("x-assetlinks-configuration"), "complete");
    if (method === "HEAD") assert.equal(await response.text(), "");
    else {
      const payload = await response.json();
      assert.deepEqual(payload[0].relation, ["delegate_permission/common.handle_all_urls"]);
      assert.equal(payload[0].target.namespace, "android_app");
      assert.equal(payload[0].target.package_name, "eu.realityforge.mangatracker");
      assert.deepEqual(payload[0].target.sha256_cert_fingerprints, [fingerprint]);
    }
  }
});

test("missing/invalid certificate values never fabricate a fingerprint or cache broken configuration", async () => {
  for (const value of [undefined, "", "  ", "invalid", "AB:CD", Array(31).fill("AB").join(":"), Array(32).fill("GG").join(":")]) {
    const response = await handleRequest(request("/.well-known/assetlinks.json"), { ANDROID_SHA256_CERT_FINGERPRINTS: value });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("location"), null);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal(response.headers.get("x-assetlinks-configuration"), value?.trim() ? "invalid" : "incomplete");
    assert.deepEqual((await response.json())[0].target.sha256_cert_fingerprints, []);
  }
});

test("production configuration preserves domains/service bindings and uses the verified Play certificate", async () => {
  const readConfig = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8").replace(/^\s*\/\/.*$/gm, ""));
  const production = readConfig("wrangler.production.jsonc");
  const development = readConfig("wrangler.jsonc");
  for (const config of [production, development]) {
    assert.equal(config.vars.MANGA_API_BASE, CANONICAL_API);
    assert.equal(config.workers_dev, true);
    assert.deepEqual(config.services, [{ binding: "MANGA_API", service: "manga-tracker-api", remote: true }]);
  }
  assert.deepEqual(production.routes, [{ pattern: "manga.realityforge.eu", custom_domain: true }]);
  const response = await handleRequest(request("/.well-known/assetlinks.json"), production.vars);
  assert.equal(response.headers.get("x-assetlinks-configuration"), "complete");
  assert.deepEqual((await response.json())[0].target.sha256_cert_fingerprints, ["E8:A3:66:B3:9E:0F:C4:91:2A:6F:25:27:A6:A0:AA:54:1D:05:CA:44:F1:48:41:5B:29:88:AA:5F:3A:1A:34:05"]);
});

test("existing manga URLs including the reproduction and trailing slash retain SSR and social metadata", async () => {
  for (const isbn of [ISBN, "9783964335388", checkedIsbn("979123456789")]) {
    for (const suffix of ["", "/"]) {
      const env = environment({ apiBody: { manga: { ...sampleManga, isbn } } }).env;
      const response = await handleRequest(request(`/manga/${isbn}${suffix}`), env);
      const html = await response.text();
      assert.equal(response.status, 200);
      assert.ok(html.includes(`<link rel="canonical" href="https://manga.realityforge.eu/manga/${isbn}">`));
      assert.match(html, /property="og:type" content="book"/);
      assert.match(html, /name="twitter:card" content="summary_large_image"/);
      assert.match(html, /"@type":"Book"/);
      assert.match(html, /play\.google\.com\/store\/apps\/details\?id=eu\.realityforge\.mangatracker/);
    }
  }
});

test("cache namespace changes bypass the previous broken HTML without deleting production caches", async () => {
  const previous = globalThis.caches;
  const pending = [];
  const keys = [];
  globalThis.caches = { default: {
    match: async (key) => {
      keys.push(key.url);
      return key.url.includes("/__manga-share-cache-v2/") ? new Response("old broken HTML") : undefined;
    },
    put: async (key) => keys.push(key.url),
  } };
  try {
    const response = await handleRequest(request(`/manga/${ISBN}?shared=true`), environment().env, { waitUntil: (promise) => pending.push(promise) });
    await Promise.all(pending);
    assert.match(await response.text(), /Rental Girlfriend/);
    assert.ok(keys.every((key) => key.includes(`/__manga-share-cache-v3/manga/${ISBN}`) && !key.includes("?")));
  } finally {
    if (previous === undefined) delete globalThis.caches;
    else globalThis.caches = previous;
  }
});
