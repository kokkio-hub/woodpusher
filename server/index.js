import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import session from 'express-session';
import connectPg from 'connect-pg-simple';
import helmet from 'helmet';
import { Server } from 'socket.io';
import { pool, migrate } from './db.js';
import { authRouter, publicRouter } from './auth.js';
import { Lobby } from './games.js';
import { importRouter } from './import.js';
import { progressRouter } from './progress.js';
import { playersRouter } from './players.js';
import { puzzlesRouter, startPuzzleImport } from './puzzles.js';
import { moderationRouter, pruneReports } from './moderation.js';
import { FairPlay } from './fairplay.js';
import { deepEngineRouter, warmDeepEngine, DEEP_ENGINE_ORIGIN } from './deep-engine.js';

const PORT = Number(process.env.PORT) || 3000;
const PROD = process.env.NODE_ENV === 'production';
const SECRET = process.env.SESSION_SECRET;
if (!SECRET || SECRET.length < 24) {
  if (PROD) { console.error('SESSION_SECRET must be set to a long random string (24+ characters).'); process.exit(1); }
  console.warn('SESSION_SECRET is not set; using an insecure development secret.');
}
const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

await migrate();

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      'script-src': ["'self'", "'wasm-unsafe-eval'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'font-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'worker-src': ["'self'", 'blob:'],
      // DEEP_ENGINE_ORIGIN: the page downloads the deep review engine from there (front/deep.js)
      'connect-src': ["'self'", (req) => `wss://${req.headers.host}`, (req) => `ws://${req.headers.host}`, DEEP_ENGINE_ORIGIN],
      'upgrade-insecure-requests': PROD ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

const PgStore = connectPg(session);
const sessionMiddleware = session({
  name: 'wp.sid',
  // ttl: how long the server keeps a session without "Remember me" after the last activity
  store: new PgStore({ pool, createTableIfMissing: true, pruneSessionInterval: 60 * 60, ttl: 24 * 60 * 60 }),
  secret: SECRET || 'dev-only-secret-change-me-please-123456',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  // Logging in sets each session's own lifetime from the "Remember me" box (server/auth.js)
  cookie: { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 30 * 24 * 60 * 60 * 1000 },
});

// Requests are small, except a browser sending its saved progress (puzzles, openings, Stockfish games)
const smallJson = express.json({ limit: '10kb' }), progressJson = express.json({ limit: '400kb' });
app.use((req, res, next) => (req.path === '/api/progress' ? progressJson : smallJson)(req, res, next));
app.use(sessionMiddleware);

const server = http.createServer(app);
const io = new Server(server, {
  serveClient: true,
  allowRequest: (req, cb) => {
    const origin = req.headers.origin;
    if (!origin) return cb(null, true);
    try { cb(null, new URL(origin).host === req.headers.host); } catch { cb(null, false); }
  },
});
io.engine.use(sessionMiddleware);
const lobby = new Lobby(io);
const fairplay = new FairPlay();
lobby.onFinished = (g) => fairplay.enqueue(g.id);
io.on('connection', (socket) => lobby.attach(socket));

// Never cache account data: every answer from /api is fresh.
app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.use('/api', authRouter({ isPlaying: (id) => lobby.isPlaying(id) }));
app.use('/api', publicRouter());
app.use('/api', importRouter());
app.use('/api', progressRouter());
app.use('/api', playersRouter());
app.use('/api', puzzlesRouter());
app.use('/api', moderationRouter());
app.use('/api', deepEngineRouter());
app.get('/healthz', (req, res) => res.json({ ok: true }));
// Caching: files the page loads with a build version (?v=…) never change under that address, so
// browsers may keep them for a year. Everything else, the page itself included, is checked with the
// server on every load (a quick 304 when nothing changed), so a new deploy is picked up on the next visit.
app.use(express.static(PUBLIC, {
  index: 'index.html',
  setHeaders: (res) => res.set('Cache-Control', res.req && res.req.query && res.req.query.v ? 'public, max-age=31536000, immutable' : 'no-cache'),
}));
// Links to games, friend challenges, profiles and the leaderboard all open the app
app.get(['/game/:id', '/c/:code', '/@/:name', '/leaderboard', '/admin'], (req, res) => res.sendFile(path.join(PUBLIC, 'index.html'), { headers: { 'Cache-Control': 'no-cache' } }));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
// Any other address: the "page not found" page for browsers, a short text for everything else
const NOT_FOUND = path.join(PUBLIC, '404.html');
app.use((req, res) => {
  res.status(404).set('Cache-Control', 'no-cache');
  const text = () => res.type('txt').send('Not found.');
  if (!req.accepts('html')) return text();
  res.sendFile(NOT_FOUND, (err) => { if (err && !res.headersSent) text(); });
});
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Something went wrong on the server.' }); });

await lobby.restore();
server.listen(PORT, () => console.log(`Woodpusher listening on port ${PORT}`));
// In the background: fill the puzzle table from the Lichess puzzle database the first time
setTimeout(() => { startPuzzleImport(); }, 3000).unref();
setTimeout(warmDeepEngine, 5000).unref();
setTimeout(() => { fairplay.backlog().catch((e) => console.error('Fair play backlog', e.message)); }, 20000).unref();
const prune = () => pruneReports().catch((e) => console.error('Reports', e.message));
setTimeout(prune, 30000).unref(); setInterval(prune, 24 * 60 * 60 * 1000).unref();

const shutdown = () => { console.log('Shutting down'); server.close(); pool.end().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
