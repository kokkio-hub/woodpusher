// Builds public/ (the website) from front/ sources: HTML shell, app.js, data.js, engine files.
// Every build stamps its own version on the files the page loads (/app.js?v=…), so after a deploy
// browsers fetch the new code instead of reusing a cached copy. See the cache headers in server/index.js.
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const F = (p) => path.join(root, 'front', p); const P = (p) => path.join(root, 'public', p);
const read = (p) => fs.readFileSync(p, 'utf8');
let html = read(F('app.html'));
// After the trainer: online play, then the parts that need the Woodpusher server (each checks for it)
const trainer = ['trainer.js', 'online.js', 'importer.js', 'sync.js', 'players.js', 'install.js'].map(f => read(F(f))).join('\n');
const must = (cond, msg) => { if (!cond) { console.error('build failed:', msg); process.exit(1); } };
must(html.includes('/*TRAINER*/'), 'trainer marker');
must(html.includes('<!--DATA-->'), 'data marker');
const styles = ['styles.js', 'profile.js', 'opening.js', 'personas.js', 'commentary.js'].map(f => read(F(f))).join('\n');
must(html.includes('/*STYLES*/'), 'styles marker');
html = html.replace('/*STYLES*/', () => styles);
html = html.replace('/*TRAINER*/', () => trainer);
// The saved look is read before first paint. The site's security policy blocks inline scripts, so it becomes /look.js.
const lookM = html.match(/<script>\/\*LOOK\*\/([\s\S]*?)<\/script>/);
must(lookM, 'look script');
html = html.replace(lookM[0], '<script src="/look.js"></script>');
const start = html.indexOf('<script>\n"use strict";'); const end = html.lastIndexOf('</script>');
must(start > 0 && end > start, 'main script');
let app = html.slice(start + '<script>'.length, end);
html = html.slice(0, start) + '<script src="/socket.io/socket.io.js"></script>\n<script src="/app.js"></script>' + html.slice(end + '</script>'.length);
html = html.replace('<!--DATA-->', '<script src="/data.js"></script>');
html = html.replace(/<script src="https:\/\/cdnjs\.cloudflare\.com\/ajax\/libs\/chess\.js\/[^"]+"><\/script>/, '<script src="/chess.js"></script>');
html = html.replace('<meta name="claude:viewport-fit-sides" content="cover">\n', '');
html = html.replace(/<link rel="preconnect"[^>]*>\n/g, '').replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*">/, '<link rel="stylesheet" href="/fonts/fonts.css">');
must(!html.includes('fonts.googleapis.com'), 'google fonts removed');
const KEYS = '<span>Keys: ← → step · Home / End · F flips · Space plays a review</span>';
must(html.includes(KEYS), 'keys line');
html = html.replace(KEYS, '<span><span id="footInstall" hidden><a href="#" data-install>Install the app</a> · </span><a href="/leaderboard">Leaderboard</a> · <a href="/privacy.html">Privacy</a> · <a href="https://github.com/kokkio-hub/woodpusher" target="_blank" rel="noopener">Source code</a> · Keys: ← → step · Home / End · F flips · Space plays a review</span>');
for (const [a, b] of [["const BOOK_BASE = 'books/';", "const BOOK_BASE = '/books/';"], ["url: 'stockfish.js'", "url: '/stockfish.js'"], ["url: 'stockfish.asm.js'", "url: '/stockfish.asm.js'"], ["s.src = 'chess.js'", "s.src = '/chess.js'"]]) { must(app.includes(a), a); app = app.replace(a, b); }
// The website serves its own engine files, so the CDN copy of the engine (for app.html on its own) goes
const cdnEngine = /\n  \/\/ Only for opening app\.html on its own[^\n]*\n[^\n]*\n  \{ url: 'https:\/\/cdn\.jsdelivr\.net\/npm\/stockfish@[^\n]*blob: true \},/;
must(cdnEngine.test(app), 'CDN engine line'); app = app.replace(cdnEngine, '');
must(!app.includes('cdn.jsdelivr.net') && !app.includes('cdnjs.cloudflare.com'), 'no CDN left in app.js');
const cut = html.indexOf('</style>') + '</style>'.length;
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Play chess online, against Stockfish, solve puzzles and learn openings on a hand-drawn wooden board.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="application-name" content="Woodpusher">
<meta name="apple-mobile-web-app-title" content="Woodpusher">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="preload" href="/fonts/outfit-latin-600-normal.woff2" as="font" type="font/woff2" crossorigin>
<meta name="theme-color" content="#f3f1ef">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}img{max-width:100%}[hidden]{display:none!important}</style>
${html.slice(0, cut)}
</head>
<body>
${html.slice(cut)}
</body>
</html>
`;
fs.mkdirSync(P(''), { recursive: true });
fs.writeFileSync(P('index.html'), page);
fs.writeFileSync(P('app.js'), app.trim() + '\n');
fs.writeFileSync(P('look.js'), lookM[1].trim() + '\n');
fs.writeFileSync(P('data.js'), ['openings.js', 'puzzles.js', 'personas.js'].filter(f => fs.existsSync(F('data/' + f))).map(f => read(F('data/' + f))).join('\n'));
fs.rmSync(P('books'), { recursive: true, force: true }); fs.mkdirSync(P('books'), { recursive: true });
if (fs.existsSync(F('data/books'))) for (const f of fs.readdirSync(F('data/books'))) fs.copyFileSync(F('data/books/' + f), P('books/' + f));
for (const f of ['stockfish.js', 'stockfish.wasm', 'stockfish.asm.js', 'chess.js']) fs.copyFileSync(F('vendor/' + f), P(f));
fs.copyFileSync(F('privacy.html'), P('privacy.html'));
// The page for addresses that don't exist (sent by server/index.js with status 404)
fs.copyFileSync(F('404.html'), P('404.html'));
fs.copyFileSync(F('favicon.svg'), P('favicon.svg'));
fs.mkdirSync(P('fonts'), { recursive: true }); for (const f of fs.readdirSync(F('fonts'))) fs.copyFileSync(F('fonts/' + f), P('fonts/' + f));
// Installing as an app: manifest and icons
fs.copyFileSync(F('manifest.webmanifest'), P('manifest.webmanifest'));
fs.rmSync(P('icons'), { recursive: true, force: true }); fs.mkdirSync(P('icons'), { recursive: true });
for (const f of fs.readdirSync(F('icons'))) fs.copyFileSync(F('icons/' + f), P('icons/' + f));
// ---- version stamp
const V = crypto.createHash('sha256');
for (const f of ['app.js', 'data.js', 'look.js', 'chess.js', 'fonts/fonts.css', 'favicon.svg']) V.update(fs.readFileSync(P(f)));
for (const f of fs.readdirSync(P('books')).sort()) V.update(fs.readFileSync(P('books/' + f)));
const ver = V.digest('hex').slice(0, 10);
const stamp = (file, pairs) => { let s = read(P(file)); for (const [a, b] of pairs) { must(s.includes(a), file + ': ' + a); s = s.split(a).join(b); } fs.writeFileSync(P(file), s); };
const q = '?v=' + ver;
stamp('index.html', [['src="/app.js"', `src="/app.js${q}"`], ['src="/data.js"', `src="/data.js${q}"`], ['src="/look.js"', `src="/look.js${q}"`],
  ['src="/chess.js"', `src="/chess.js${q}"`], ['href="/fonts/fonts.css"', `href="/fonts/fonts.css${q}"`], ['href="/favicon.svg"', `href="/favicon.svg${q}"`]]);
stamp('privacy.html', [['href="/fonts/fonts.css"', `href="/fonts/fonts.css${q}"`], ['src="/look.js"', `src="/look.js${q}"`], ['href="/favicon.svg"', `href="/favicon.svg${q}"`]]);
stamp('404.html', [['href="/fonts/fonts.css"', `href="/fonts/fonts.css${q}"`], ['src="/look.js"', `src="/look.js${q}"`], ['href="/favicon.svg"', `href="/favicon.svg${q}"`]]);
stamp('app.js', [["const BOOK_QS = '';", `const BOOK_QS = '${q}';`]]);
// ---- service worker: the files the site needs to open without a connection, and a version that
// changes whenever any of them does (a new version replaces the cached copy of the site).
// stockfish.asm.js, the fallback for very old browsers, is left out: it is cached only if it is used.
const woff = fs.readdirSync(P('fonts')).filter(f => f.endsWith('.woff2')).sort();
const icons = fs.readdirSync(P('icons')).sort(); const books = fs.readdirSync(P('books')).sort();
const pre = ['/', `/app.js${q}`, `/data.js${q}`, `/look.js${q}`, `/chess.js${q}`, `/fonts/fonts.css${q}`, `/favicon.svg${q}`, '/stockfish.js', '/stockfish.wasm', '/manifest.webmanifest', '/privacy.html',
  ...woff.map(f => '/fonts/' + f), ...icons.map(f => '/icons/' + f), ...books.map(f => `/books/${f}${q}`)];
const SV = crypto.createHash('sha256');
for (const f of ['index.html', 'app.js', 'data.js', 'look.js', 'chess.js', 'stockfish.js', 'stockfish.wasm', 'manifest.webmanifest', 'privacy.html', ...woff.map(f => 'fonts/' + f), ...icons.map(f => 'icons/' + f), ...books.map(f => 'books/' + f)]) SV.update(fs.readFileSync(P(f)));
let sw = read(F('sw.js'));
must(sw.includes("'__VERSION__'") && sw.includes('[/*PRECACHE*/]'), 'service worker markers');
sw = sw.replace("'__VERSION__'", JSON.stringify(SV.digest('hex').slice(0, 10))).replace('[/*PRECACHE*/]', JSON.stringify(pre, null, 0));
fs.writeFileSync(P('sw.js'), sw);
console.log('built public/ (version ' + ver + '):', fs.readdirSync(P('')).join(', '));
