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
const trainer = read(F('trainer.js')); const online = read(F('online.js'));
const must = (cond, msg) => { if (!cond) { console.error('build failed:', msg); process.exit(1); } };
must(html.includes('/*TRAINER*/'), 'trainer marker');
must(html.includes('<!--DATA-->'), 'data marker');
const styles = ['styles.js', 'profile.js', 'opening.js', 'personas.js'].map(f => read(F(f))).join('\n');
must(html.includes('/*STYLES*/'), 'styles marker');
html = html.replace('/*STYLES*/', () => styles);
html = html.replace('/*TRAINER*/', () => trainer + '\n' + online);
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
html = html.replace('<span>Keys: ← → step · Home / End · F flips</span>', '<span><a href="/privacy.html">Privacy</a> · <a href="https://github.com/kokkio-hub/woodpusher" target="_blank" rel="noopener">Source code</a> · Keys: ← → step · Home / End · F flips</span>');
for (const [a, b] of [["const BOOK_BASE = 'books/';", "const BOOK_BASE = '/books/';"], ["url: 'stockfish.js'", "url: '/stockfish.js'"], ["url: 'stockfish.asm.js'", "url: '/stockfish.asm.js'"], ["s.src = 'chess.js'", "s.src = '/chess.js'"]]) { must(app.includes(a), a); app = app.replace(a, b); }
const cut = html.indexOf('</style>') + '</style>'.length;
const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Play chess online, against Stockfish, solve puzzles and learn openings on a hand-drawn wooden board.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
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
fs.copyFileSync(F('favicon.svg'), P('favicon.svg'));
fs.mkdirSync(P('fonts'), { recursive: true }); for (const f of fs.readdirSync(F('fonts'))) fs.copyFileSync(F('fonts/' + f), P('fonts/' + f));
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
stamp('app.js', [["const BOOK_QS = '';", `const BOOK_QS = '${q}';`]]);
console.log('built public/ (version ' + ver + '):', fs.readdirSync(P('')).join(', '));
