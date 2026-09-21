# Manga Tracker Share Worker

Serverseitig gerenderte Share-Seiten für `manga.realityforge.eu`. Der Worker ist vom statischen GitHub-Pages-Auftritt unter `realityforge.eu` getrennt.

## Lokale Entwicklung

Voraussetzungen: Node.js 20 oder neuer und ein Cloudflare-Konto mit Zugriff auf die Zone `realityforge.eu`.

```powershell
npm install
npm test
npm run dev
```

Die lokale Startseite liegt anschließend unter der von Wrangler ausgegebenen Adresse. Beispielroute: `/manga/9783551771575`.

## Konfiguration

- `MANGA_API_BASE` verweist ausschließlich auf die bestehende Manga-API. Der Standard ist `https://manga-tracker-api.realityforgeeu.workers.dev`.
- `MANGA_API` ist eine Cloudflare-Service-Bindung zum bestehenden Worker `manga-tracker-api`. Produktionsabfragen bleiben dadurch intern im Cloudflare-Netz; `MANGA_API_BASE` liefert weiterhin die öffentlichen Cover-URLs.
- `ANDROID_SHA256_CERT_FINGERPRINTS` enthält einen oder mehrere, durch Kommas getrennte SHA-256-Fingerprints des bei Google Play verwendeten App-Signing-Zertifikats. Der Fingerprint ist kein Geheimnis, muss jedoch exakt aus der Play Console übernommen werden.

Ohne `ANDROID_SHA256_CERT_FINGERPRINTS` liefert `/.well-known/assetlinks.json` eine syntaktisch gültige Vorbereitung mit leerer Fingerprint-Liste und dem Header `X-Assetlinks-Configuration: incomplete`. Android App Links werden damit noch nicht verifiziert. Es wurde bewusst kein Fingerprint erfunden; im Android-Repository liegt keiner vor.

Beispiel für die Produktionsvariable:

```powershell
npx wrangler secret put ANDROID_SHA256_CERT_FINGERPRINTS --config wrangler.production.jsonc
```

Die Variable enthält zwar kein Geheimnis, `secret put` verhindert aber, dass sie versehentlich in Git landet. Nach dem Setzen muss der Worker erneut veröffentlicht und `/.well-known/assetlinks.json` geprüft werden.

## Veröffentlichung

`wrangler.jsonc` dient Entwicklung und Dry-Run. `wrangler.production.jsonc` ergänzt die Custom Domain.

```powershell
npm run check
npm run deploy
```

Vor der ersten Produktionsveröffentlichung muss der bestehende DNS-CNAME von `manga.realityforge.eu` zu GitHub Pages entfernt werden. Cloudflare kann eine Worker-Custom-Domain nicht auf einem Hostnamen mit vorhandenem CNAME anlegen. Danach erzeugt Cloudflare den benötigten DNS-Eintrag und das Zertifikat für die Custom Domain.

Die Root-Website und ihr GitHub-Pages-Workflow bleiben unverändert. Der Worker benötigt keine Secrets für die Manga-API und greift nur über feste, serverseitig konfigurierte URLs darauf zu.

## Cache und Fehlerverhalten

- Erfolgreiche SSR-Seiten: 15 Minuten Edge-Cache, 1 Minute Browser-Cache.
- Nicht gefundene Manga: 2 Minuten Edge-Cache.
- Backendfehler, Timeouts und ungültige Antworten: HTTP 503 und `no-store`.
- Cover werden direkt vom bestehenden Backend ausgeliefert. Ist dort kein Bild verfügbar, wird `public/manga-tracker-og.png` verwendet.

## Kontrollliste nach dem Deployment

1. Startseite und vier Manga-Routen im Browser prüfen.
2. Quelltext ohne JavaScript auslesen und Titel, Beschreibung, Canonical, Open Graph und Twitter Card kontrollieren.
3. `/.well-known/assetlinks.json` auf den echten Release-Fingerprint und `X-Assetlinks-Configuration: complete` prüfen.
4. Darstellung bei 360, 390, 412, 768, 1280 und 1920 Pixel Breite kontrollieren.
5. Einen ungültigen ISBN-Link, einen nicht vorhandenen Manga und einen simulierten Backendfehler prüfen.
