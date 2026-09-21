const DEFAULT_API_BASE = "https://manga-tracker-api.realityforgeeu.workers.dev";
const SITE_ORIGIN = "https://manga.realityforge.eu";
const PLAY_STORE_URL = "https://play.google.com/store/apps/details?id=eu.realityforge.mangatracker";
const FALLBACK_IMAGE = `${SITE_ORIGIN}/manga-tracker-og.png`;
const ROOT_IMPRINT = "https://realityforge.eu/legal-notice/";
const ROOT_PRIVACY = "https://realityforge.eu/privacy-policy/";
const MANGA_PRIVACY = "https://realityforge.eu/privacy-policy/manga-tracker/";
const FETCH_TIMEOUT_MS = 5000;
const CACHE_VERSION = "2";

const SECURITY_HEADERS = {
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
};

export function isValidIsbn13(value) {
  if (!/^(?:978|979)\d{10}$/.test(value)) return false;
  const digits = [...value].map(Number);
  const sum = digits.slice(0, 12).reduce((total, digit, index) => total + digit * (index % 2 ? 3 : 1), 0);
  return (10 - (sum % 10)) % 10 === digits[12];
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function cleanText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cleanPositiveInteger(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function normalizeContributors(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const name = cleanText(entry?.name);
    if (!name) return [];
    return [{ name, role: cleanText(entry?.role) }];
  });
}

function normalizePrices(value) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const amount = Number(entry?.amount);
    const currency = cleanText(entry?.currency).toUpperCase();
    if (!Number.isFinite(amount) || amount <= 0 || !/^[A-Z]{3}$/.test(currency)) return [];
    return [{ amount, currency, type: cleanText(entry?.type) }];
  });
}

export function normalizeManga(raw) {
  if (!raw || typeof raw !== "object") return null;
  const title = cleanText(raw.title);
  const isbn = cleanText(raw.isbn);
  if (!title || !isValidIsbn13(isbn)) return null;
  return {
    isbn,
    title,
    subtitle: cleanText(raw.subtitle),
    series: cleanText(raw.series),
    volume: cleanText(raw.volume),
    publisher: cleanText(raw.publisher),
    contributors: normalizeContributors(raw.contributors),
    publicationDate: cleanText(raw.publication_date),
    prices: normalizePrices(raw.prices),
    edition: cleanText(raw.edition),
    description: cleanText(raw.description),
    descriptionType: cleanText(raw.description_type),
    language: cleanText(raw.language),
    binding: cleanText(raw.binding),
    pageCount: cleanPositiveInteger(raw.page_count),
    ageRecommendation: cleanText(raw.age_recommendation),
  };
}

function dateInfo(value) {
  let year;
  let month;
  let day;
  let match = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(value);
  if (match) [, day, month, year] = match;
  else {
    match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;
    [, year, month, day] = match;
  }
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return {
    date,
    display: new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric", timeZone: "UTC" }).format(date),
    iso: `${year}-${month}-${day}`,
  };
}

function displayPrice(prices) {
  const preferred = prices.filter((price) => price.currency === "EUR" && price.type === "04");
  const candidates = preferred.length ? preferred : prices.filter((price) => price.currency === "EUR");
  if (!candidates.length) return "";
  const price = candidates.reduce((current, entry) => entry.amount > current.amount ? entry : current);
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" }).format(price.amount);
}

function displayLanguage(value) {
  const aliases = { de: "Deutsch", deu: "Deutsch", ger: "Deutsch", en: "Englisch", eng: "Englisch", ja: "Japanisch", jpn: "Japanisch" };
  const normalized = value.toLowerCase();
  if (aliases[normalized]) return aliases[normalized];
  return value.length > 3 && /^[\p{L} .()-]+$/u.test(value) ? value : "";
}

function displayBinding(value) {
  const aliases = { bc: "Softcover", bb: "Hardcover", "03": "Hardcover", "04": "Softcover" };
  const normalized = value.toLowerCase();
  if (aliases[normalized]) return aliases[normalized];
  return value.length > 2 && /^[\p{L} .()-]+$/u.test(value) ? value : "";
}

function authorNames(contributors) {
  const authors = contributors.filter(({ role }) => /^(autor|autorin|author)$/i.test(role)).map(({ name }) => name);
  return [...new Set(authors)];
}

function htmlResponse(html, status, cacheControl, apiOrigin = DEFAULT_API_BASE) {
  let imageOrigin = DEFAULT_API_BASE;
  try { imageOrigin = new URL(apiOrigin).origin; } catch { /* use the fixed safe default */ }
  return new Response(html, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": cacheControl,
      "Content-Security-Policy": `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' ${imageOrigin}; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`,
      ...SECURITY_HEADERS,
    },
  });
}

function shell({ title, socialTitle = title, description, canonical, image, body, type = "website", robots = "index,follow", jsonLd = "" }) {
  const safeTitle = escapeHtml(title);
  const safeSocialTitle = escapeHtml(socialTitle);
  const safeDescription = escapeHtml(description);
  const safeCanonical = escapeHtml(canonical);
  const safeImage = escapeHtml(image);
  return `<!doctype html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="theme-color" content="#100b1d">
  <meta name="robots" content="${robots}">
  <title>${safeTitle}</title>
  <meta name="description" content="${safeDescription}">
  <link rel="canonical" href="${safeCanonical}">
  <meta property="og:locale" content="de_DE">
  <meta property="og:type" content="${type}">
  <meta property="og:site_name" content="Manga Tracker">
  <meta property="og:title" content="${safeSocialTitle}">
  <meta property="og:description" content="${safeDescription}">
  <meta property="og:url" content="${safeCanonical}">
  <meta property="og:image" content="${safeImage}">
  <meta property="og:image:alt" content="Cover zu ${safeSocialTitle}">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${safeSocialTitle}">
  <meta name="twitter:description" content="${safeDescription}">
  <meta name="twitter:image" content="${safeImage}">
  ${jsonLd}
  <style>${STYLES}</style>
</head>
<body>
  <header class="site-header"><a class="brand" href="/" aria-label="Manga Tracker Startseite"><span aria-hidden="true">M</span>Manga Tracker</a></header>
  ${body}
  <footer><nav aria-label="Rechtliches"><a href="${ROOT_IMPRINT}">Impressum</a><a href="${ROOT_PRIVACY}">Datenschutz</a><a href="${MANGA_PRIVACY}">Datenschutz Manga Tracker</a></nav><p>RealityForge GbR</p></footer>
</body>
</html>`;
}

const STYLES = `
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f7f2ff;background:#0d0916;font-synthesis:none}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at 80% -10%,#3b1d63 0,transparent 34rem),linear-gradient(180deg,#120b20,#0b0811 70%);color:#f7f2ff}.site-header{max-width:74rem;margin:auto;padding:1.25rem 1rem}.brand{display:inline-flex;align-items:center;gap:.65rem;color:#fff;text-decoration:none;font-weight:800;letter-spacing:-.02em}.brand span{display:grid;width:2rem;height:2rem;place-items:center;border-radius:.55rem;background:linear-gradient(135deg,#af65ff,#7446ed);box-shadow:0 0 24px #9c58ff66}main{width:min(74rem,100%);margin:auto;padding:1.5rem 1rem 5rem}.hero{display:grid;gap:2rem}.cover-wrap{width:min(76vw,22rem);aspect-ratio:2/3;margin:auto;padding:.55rem;border:1px solid #ffffff20;border-radius:1.3rem;background:#ffffff0a;box-shadow:0 2rem 5rem #0009}.cover{width:100%;height:100%;display:block;object-fit:contain;border-radius:.9rem;background:#17101f}.eyebrow{margin:0 0 .8rem;color:#c7a8f7;font-size:.78rem;font-weight:800;letter-spacing:.15em;text-transform:uppercase}.title{max-width:18ch;margin:0;font-size:clamp(2.25rem,9vw,5.4rem);line-height:.96;letter-spacing:-.055em;overflow-wrap:anywhere}.subtitle{margin:.85rem 0 0;color:#cfc3dc;font-size:clamp(1.05rem,3vw,1.45rem);line-height:1.4;overflow-wrap:anywhere}.authors{margin:1rem 0 0;color:#e7dbf4;font-weight:650;overflow-wrap:anywhere}.key-facts{display:flex;flex-wrap:wrap;gap:.65rem;margin:1.6rem 0 0;padding:0;list-style:none}.key-facts li{padding:.55rem .8rem;border:1px solid #ffffff1a;border-radius:999px;background:#ffffff0a;color:#ddd1e8;font-size:.9rem}.cta{display:inline-flex;align-items:center;justify-content:center;margin-top:1.8rem;padding:.9rem 1.2rem;border-radius:.8rem;background:#f1e7ff;color:#1c0c2e;text-decoration:none;font-weight:850;box-shadow:0 .6rem 2rem #a662ff33}.cta:focus-visible,a:focus-visible{outline:3px solid #d5a9ff;outline-offset:4px}.content{display:grid;gap:2rem;margin-top:4rem}.panel{padding:clamp(1.25rem,4vw,2rem);border:1px solid #ffffff17;border-radius:1.2rem;background:#151020cc;box-shadow:0 1.5rem 4rem #0005}.panel h2{margin:0 0 1rem;font-size:1.35rem}.description p{margin:0 0 1rem;color:#d8cede;line-height:1.75}.description p:last-child{margin-bottom:0}.details{display:grid;grid-template-columns:repeat(auto-fit,minmax(10rem,1fr));gap:1.25rem;margin:0}.details div{min-width:0}.details dt{color:#a99bb7;font-size:.78rem;font-weight:750;text-transform:uppercase;letter-spacing:.08em}.details dd{margin:.35rem 0 0;color:#f7f2ff;overflow-wrap:anywhere}.app-promo{margin-top:2rem;text-align:center}.app-promo p{max-width:44rem;margin:.7rem auto 0;color:#d8cede;line-height:1.7}footer{padding:2.5rem 1rem 3rem;border-top:1px solid #ffffff12;color:#9e91aa;text-align:center;font-size:.88rem}footer nav{display:flex;justify-content:center;flex-wrap:wrap;gap:.8rem 1.25rem}footer a{color:#d6c7e3;text-underline-offset:.22em}footer p{margin:1rem 0 0}.state{max-width:42rem;margin:4rem auto;text-align:center}.state h1{font-size:clamp(2.2rem,8vw,4.5rem);letter-spacing:-.045em;margin:0}.state p{color:#cfc3dc;line-height:1.65}.state ul{display:flex;flex-wrap:wrap;justify-content:center;gap:.55rem;margin:1.2rem 0 0;padding:0;list-style:none}.state li{padding:.45rem .7rem;border:1px solid #ffffff17;border-radius:999px;color:#d8cede}.state .cover-wrap{margin-bottom:2rem;width:min(68vw,16rem)}@media(min-width:760px){.site-header,main{padding-left:2rem;padding-right:2rem}.hero{grid-template-columns:minmax(16rem,22rem) 1fr;align-items:center;gap:clamp(3rem,7vw,7rem);min-height:37rem}.cover-wrap{width:100%}.content{grid-template-columns:minmax(0,1.45fr) minmax(18rem,.75fr)}}@media(prefers-reduced-motion:no-preference){.cta{transition:transform .2s ease,box-shadow .2s ease}.cta:hover{transform:translateY(-2px);box-shadow:0 .9rem 2.5rem #a662ff55}}`;

function renderDescription(text) {
  return text.split(/\r?\n\s*\r?\n/).map((paragraph) => `<p>${escapeHtml(paragraph.replace(/\r?\n/g, " ").trim())}</p>`).join("");
}

function detail(label, value) {
  return value ? `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>` : "";
}

function bookJsonLd(manga, canonical, image, authors, publicationDate) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Book",
    name: manga.title,
    url: canonical,
    isbn: manga.isbn,
    image,
  };
  if (manga.subtitle) data.alternativeHeadline = manga.subtitle;
  if (authors.length) data.author = authors.map((name) => ({ "@type": "Person", name }));
  if (manga.publisher) data.publisher = { "@type": "Organization", name: manga.publisher };
  if (publicationDate) data.datePublished = publicationDate;
  if (manga.description) data.description = manga.description;
  if (manga.language) data.inLanguage = manga.language;
  if (manga.pageCount) data.numberOfPages = manga.pageCount;
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`;
}

export function renderMangaPage(manga, coverUrl) {
  const canonical = `${SITE_ORIGIN}/manga/${manga.isbn}`;
  const image = coverUrl || FALLBACK_IMAGE;
  const authors = authorNames(manga.contributors);
  const release = dateInfo(manga.publicationDate);
  const releaseDate = release?.display || "";
  const price = displayPrice(manga.prices);
  const language = displayLanguage(manga.language);
  const binding = displayBinding(manga.binding);
  const today = new Date();
  const released = release && release.date.getTime() < Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const metaDescription = release ? `${manga.title} ${released ? "ist erschienen" : `erscheint am ${releaseDate}`}. In Manga Tracker ansehen.` : `${manga.title} in Manga Tracker ansehen.`;
  const facts = [price, releaseDate, manga.publisher].filter(Boolean).map((value) => `<li>${escapeHtml(value)}</li>`).join("");
  const details = [
    detail("ISBN", manga.isbn), detail("Verlag", manga.publisher), detail("Erscheinungsdatum", releaseDate),
    detail("Format", binding), detail("Sprache", language), detail("Seiten", manga.pageCount ? String(manga.pageCount) : ""),
    detail("Auflage", manga.edition), detail("Altersempfehlung", manga.ageRecommendation ? `ab ${manga.ageRecommendation} Jahren` : ""),
    detail("Reihe", manga.series), detail("Band", manga.volume),
  ].join("");
  const descriptionHeading = manga.descriptionType.toLowerCase() === "flap_text" ? "Klappentext" : "Beschreibung";
  const content = [
    manga.description ? `<section class="panel description" aria-labelledby="description"><h2 id="description">${descriptionHeading}</h2>${renderDescription(manga.description)}</section>` : "",
    details ? `<section class="panel" aria-labelledby="details"><h2 id="details">Details</h2><dl class="details">${details}</dl></section>` : "",
  ].filter(Boolean).join("");
  const body = `<main><article><section class="hero"><div class="cover-wrap"><img class="cover" src="${escapeHtml(image)}" alt="Cover von ${escapeHtml(manga.title)}" width="600" height="900"></div><div><p class="eyebrow">Manga Tracker</p><h1 class="title">${escapeHtml(manga.title)}</h1>${manga.subtitle ? `<p class="subtitle">${escapeHtml(manga.subtitle)}</p>` : ""}${authors.length ? `<p class="authors">${escapeHtml(authors.join(", "))}</p>` : ""}${facts ? `<ul class="key-facts" aria-label="Kurzinformationen">${facts}</ul>` : ""}<a class="cta" href="${PLAY_STORE_URL}">Manga Tracker bei Google Play</a></div></section>${content ? `<div class="content">${content}</div>` : ""}<section class="panel app-promo" aria-labelledby="app"><h2 id="app">Manga Tracker</h2><p>Entdecke deutsche Manga-Neuerscheinungen, verwalte deine Sammlung und behalte neue Bände deiner Reihen im Blick.</p><a class="cta" href="${PLAY_STORE_URL}">Manga Tracker bei Google Play</a></section></article></main>`;
  return shell({
    title: `${manga.title} | Manga Tracker`, socialTitle: manga.title, description: metaDescription, canonical, image, body, type: "book",
    jsonLd: bookJsonLd(manga, canonical, image, authors, release?.iso || ""),
  });
}

function renderStatePage(status, heading, message) {
  const canonical = status === 404 ? `${SITE_ORIGIN}/404` : SITE_ORIGIN;
  const body = `<main><section class="state"><div class="cover-wrap"><img class="cover" src="${FALLBACK_IMAGE}" alt="Manga Tracker" width="1200" height="630"></div><p class="eyebrow">Manga Tracker</p><h1>${escapeHtml(heading)}</h1><p>${escapeHtml(message)}</p><a class="cta" href="${PLAY_STORE_URL}">Manga Tracker bei Google Play</a></section></main>`;
  return shell({ title: `${heading} | Manga Tracker`, description: message, canonical, image: FALLBACK_IMAGE, body, robots: status === 404 ? "noindex,follow" : "noindex,nofollow" });
}

function renderLandingPage() {
  const description = "Deutsche Manga-Neuerscheinungen entdecken und die eigene Sammlung verwalten.";
  const body = `<main><section class="state"><div class="cover-wrap"><img class="cover" src="${FALLBACK_IMAGE}" alt="Manga Tracker" width="1200" height="630"></div><p class="eyebrow">Deine Manga. Deine Sammlung.</p><h1>Manga Tracker</h1><p>${description}</p><ul aria-label="Funktionen"><li>Bibliothek</li><li>Neue Bände</li><li>Einkaufsliste</li><li>Budget</li></ul><a class="cta" href="${PLAY_STORE_URL}">Manga Tracker bei Google Play</a></section></main>`;
  return shell({ title: "Manga Tracker", description, canonical: `${SITE_ORIGIN}/`, image: FALLBACK_IMAGE, body });
}

async function fetchWithTimeout(fetcher, url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try { return await fetcher(url, { ...options, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}

function apiBase(env) {
  const candidate = cleanText(env?.MANGA_API_BASE) || DEFAULT_API_BASE;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:") return DEFAULT_API_BASE;
    return candidate.replace(/\/+$/, "");
  } catch { return DEFAULT_API_BASE; }
}

async function coverExists(fetcher, url) {
  try {
    const response = await fetchWithTimeout(fetcher, url, { method: "GET", headers: { Accept: "image/*", Range: "bytes=0-0" } });
    const valid = response.ok && (response.headers.get("content-type") || "").toLowerCase().startsWith("image/");
    await response.body?.cancel().catch(() => {});
    return valid;
  } catch { return false; }
}

async function loadManga(isbn, env) {
  const base = apiBase(env);
  const fetcher = env?.MANGA_API?.fetch
    ? (url, init) => env.MANGA_API.fetch(new Request(url, init))
    : env?.FETCH || fetch;
  let response;
  try { response = await fetchWithTimeout(fetcher, `${base}/manga/${isbn}`, { headers: { Accept: "application/json" } }); }
  catch { return { status: 503, base }; }
  if (response.status === 404) return { status: 404, base };
  if (!response.ok) return { status: 503, base };
  let payload;
  try { payload = await response.json(); } catch { return { status: 503, base }; }
  const manga = normalizeManga(payload?.manga);
  if (!manga || manga.isbn !== isbn) return { status: 503, base };
  const coverUrl = `${base}/manga/${isbn}/cover`;
  const hasCover = await coverExists(fetcher, coverUrl);
  return { status: 200, manga, coverUrl: hasCover ? coverUrl : "", base };
}

function assetLinks(env) {
  const fingerprintPattern = /^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$/i;
  const fingerprints = cleanText(env?.ANDROID_SHA256_CERT_FINGERPRINTS).split(",").map((value) => value.trim().toUpperCase()).filter((value) => fingerprintPattern.test(value));
  const payload = [{ relation: ["delegate_permission/common.handle_all_urls"], target: { namespace: "android_app", package_name: "eu.realityforge.mangatracker", sha256_cert_fingerprints: [...new Set(fingerprints)] } }];
  return new Response(JSON.stringify(payload, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=300", "X-Assetlinks-Configuration": fingerprints.length ? "complete" : "incomplete", ...SECURITY_HEADERS } });
}

function asHead(request, response) {
  return request.method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
}

async function cached(request, ctx, createResponse) {
  const cache = globalThis.caches?.default;
  const url = new URL(request.url);
  url.search = "";
  url.pathname = `/__manga-share-cache-v${CACHE_VERSION}${url.pathname}`;
  const key = new Request(url.toString(), { method: "GET" });
  if (cache) {
    const match = await cache.match(key);
    if (match) return asHead(request, match);
  }
  const response = await createResponse();
  if (cache && response.status < 500 && request.method === "GET") ctx?.waitUntil?.(cache.put(key, response.clone()));
  return asHead(request, response);
}

export async function handleRequest(request, env = {}, ctx = {}) {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD", ...SECURITY_HEADERS } });
  const url = new URL(request.url);
  if (url.pathname === "/.well-known/assetlinks.json") return asHead(request, assetLinks(env));
  if (url.pathname === "/manga-tracker-og.png" && env.ASSETS) return env.ASSETS.fetch(request);
  if (url.pathname === "/" || url.pathname === "") return cached(request, ctx, async () => htmlResponse(renderLandingPage(), 200, "public, max-age=60, s-maxage=900"));
  const match = /^\/manga\/([^/]+)\/?$/.exec(url.pathname);
  if (!match || !isValidIsbn13(match[1])) return cached(request, ctx, async () => htmlResponse(renderStatePage(404, "Manga nicht gefunden", "Diese Manga-Seite ist nicht verfügbar. Prüfe den Link oder öffne Manga Tracker."), 404, "public, max-age=30, s-maxage=120"));
  const isbn = match[1];
  return cached(request, ctx, async () => {
    const result = await loadManga(isbn, env);
    if (result.status === 404) return htmlResponse(renderStatePage(404, "Manga nicht gefunden", "Dieser Manga wurde nicht gefunden."), 404, "public, max-age=30, s-maxage=120", result.base);
    if (result.status !== 200) return htmlResponse(renderStatePage(503, "Kurz nicht erreichbar", "Der Manga kann gerade nicht geladen werden. Bitte versuche es später erneut."), 503, "no-store", result.base);
    return htmlResponse(renderMangaPage(result.manga, result.coverUrl), 200, "public, max-age=60, s-maxage=900, stale-while-revalidate=300", result.base);
  });
}
