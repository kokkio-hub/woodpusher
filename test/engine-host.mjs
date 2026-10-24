// Stands in for engine.woodpusher.org (Cloudflare R2) in test/deep.py: serves one file over HTTPS with
// the CORS headers the bucket's policy gives, so the browser downloads the 99 MB engine as it would for
// real. test/deep.py starts it and points the browser's engine.woodpusher.org at 127.0.0.1.
//   node test/engine-host.mjs <file.wasm> <other file> [port=443] [allowed origin=http://localhost:3100]
// GET /__mode/other makes it serve the other file under the same name (a wrong upload), /__mode/main undoes that.
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const [main, other, port = '443', origin = 'http://localhost:3100'] = process.argv.slice(2);
let file = main;
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-host-'));
execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=engine.woodpusher.org',
  '-keyout', path.join(dir, 'key.pem'), '-out', path.join(dir, 'cert.pem')], { stdio: 'ignore' });
const opts = { key: fs.readFileSync(path.join(dir, 'key.pem')), cert: fs.readFileSync(path.join(dir, 'cert.pem')) };
let served = 0;
https.createServer(opts, (req, res) => {
  const cors = req.headers.origin === origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
  if (req.url === '/__served') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end(String(served)); return; }
  if (req.url === '/__mode/other' || req.url === '/__mode/main') { file = req.url.endsWith('other') ? other : main; res.writeHead(200); res.end(file); return; }
  if (req.url !== '/stockfish-19-single.wasm') { res.writeHead(404, cors); res.end(); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, cors); res.end(); return; }
  const size = fs.statSync(file).size;
  res.writeHead(200, { ...cors, 'Content-Type': 'application/wasm', 'Content-Length': size });
  if (req.method === 'HEAD') { res.end(); return; }
  served++; fs.createReadStream(file).pipe(res);
}).listen(+port, '127.0.0.1', () => console.log(`engine host on https://127.0.0.1:${port}, serving ${main}`));
process.on('exit', () => fs.rmSync(dir, { recursive: true, force: true }));
process.on('SIGTERM', () => process.exit(0));
