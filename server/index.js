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
      'script-src': ["'self'", 'https://cdnjs.cloudflare.com', "'wasm-unsafe-eval'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'font-src': ["'self'"],
      'img-src': ["'self'", 'data:', 'blob:'],
      'worker-src': ["'self'", 'blob:'],
      'connect-src': ["'self'", (req) => `wss://${req.headers.host}`, (req) => `ws://${req.headers.host}`],
      'upgrade-insecure-requests': PROD ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));

const PgStore = connectPg(session);
const sessionMiddleware = session({
  name: 'wp.sid',
  store: new PgStore({ pool, createTableIfMissing: true, pruneSessionInterval: 60 * 60 }),
  secret: SECRET || 'dev-only-secret-change-me-please-123456',
  resave: false,
  saveUninitialized: false,
  rolling: true,
  cookie: { httpOnly: true, sameSite: 'lax', secure: PROD, maxAge: 30 * 24 * 60 * 60 * 1000 },
});

app.use(express.json({ limit: '10kb' }));
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
io.on('connection', (socket) => lobby.attach(socket));

app.use('/api', authRouter({ isPlaying: (id) => lobby.isPlaying(id) }));
app.use('/api', publicRouter());
app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(express.static(PUBLIC, { maxAge: PROD ? '1h' : 0, index: 'index.html' }));
// Links to games, friend challenges and profiles all open the app
app.get(['/game/:id', '/c/:code', '/@/:name'], (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: 'Something went wrong on the server.' }); });

await lobby.restore();
server.listen(PORT, () => console.log(`Woodpusher listening on port ${PORT}`));

const shutdown = () => { console.log('Shutting down'); server.close(); pool.end().finally(() => process.exit(0)); setTimeout(() => process.exit(0), 5000).unref(); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
