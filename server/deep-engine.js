// Deep review: full-strength Stockfish 19 runs in the visitor's browser, but its 99 MB .wasm is stored
// on Cloudflare R2 behind engine.woodpusher.org instead of being served from here (see front/deep.js).
// This server checks now and then whether the file is there, so the page knows whether to offer a deep
// review without each visitor's browser contacting engine.woodpusher.org just to find out.
import { Router } from 'express';

// Keep in step with DEEP.url in front/deep.js (tools/build-front.mjs checks that they match).
// DEEP_ENGINE_URL in the environment only changes what this server checks, for trying another bucket.
export const DEEP_ENGINE_URL = process.env.DEEP_ENGINE_URL || 'https://engine.woodpusher.org/stockfish-19-single.wasm';
export const DEEP_ENGINE_ORIGIN = new URL(DEEP_ENGINE_URL).origin;

const OK_FOR = 30 * 60 * 1000, MISSING_FOR = 5 * 60 * 1000;
const state = { available: false, at: 0, pending: null };

async function check() {
  try {
    const r = await fetch(DEEP_ENGINE_URL, { method: 'HEAD', signal: AbortSignal.timeout(8000) });
    state.available = r.ok;
  } catch (e) { state.available = false; }
  state.at = Date.now();
}
function fresh() { return state.at && Date.now() - state.at < (state.available ? OK_FOR : MISSING_FOR); }
async function available() {
  if (!fresh()) { state.pending = state.pending || check().finally(() => { state.pending = null; }); await state.pending; }
  return state.available;
}

export function deepEngineRouter() {
  const r = Router();
  r.get('/deep-engine', async (req, res) => res.json({ available: await available() }));
  return r;
}
// Checked once shortly after start, so the first visitor gets an answer straight away
export function warmDeepEngine() { available().catch(() => {}); }
