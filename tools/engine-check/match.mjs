// Bot against bot: is engine A at one recipe notch as strong as engine B at another?
//   node tools/engine-check/match.mjs <A engine.js> <A notch> <B engine.js> <B notch> [games=32] [out.json]
// A "notch" is the Elo the recipe (eloRecipe) is evaluated at; for the current bot that is ELO_RECIPE
// in front/app.html, e.g. setting 2000 → notch 1740. Two games run at a time; on a machine with more
// cores set WORKERS. Prints A's score and the Elo difference it implies. Set SEED to vary the games.
import fs from 'node:fs';
import { Engine, playGame, OPENINGS, eloDiff, eloRecipe } from './lib.mjs';
const [aFile, aNotch, bFile, bNotch, n = '32', out] = process.argv.slice(2);
if (!bNotch) { console.error('usage: match.mjs <A engine.js> <A notch> <B engine.js> <B notch> [games] [out.json]'); process.exit(1); }
const A = eloRecipe(+aNotch), B = eloRecipe(+bNotch), games = +n, workers = +process.env.WORKERS || 2, seed0 = +process.env.SEED || 0;
const jobs = Array.from({ length: games }, (_, g) => ({ open: OPENINGS[Math.floor(g / 2) % OPENINGS.length], aWhite: g % 2 === 0, seed: 1000 + g * 7919 + seed0 }));
let next = 0, sum = 0; const res = []; const t0 = Date.now();
await Promise.all(Array.from({ length: workers }, async () => {
  const ea = new Engine(aFile), eb = new Engine(bFile); await ea.ready; await eb.ready;
  while (next < jobs.length) {
    const j = jobs[next++]; const a = { eng: ea, P: A }, b = { eng: eb, P: B };
    const r = await playGame(j.aWhite ? a : b, j.aWhite ? b : a, j.open, j.seed);
    const s = j.aWhite ? r.score : 1 - r.score; sum += s; res.push({ ...j, s, plies: r.plies, fens: r.fens });
    process.stderr.write(`${res.length}/${games} `);
  }
  ea.quit(); eb.quit();
}));
const score = sum / games;
console.log(JSON.stringify({ games, score: +score.toFixed(3), elo: Math.round(eloDiff(score)), draws: res.filter(r => r.s === 0.5).length, secs: Math.round((Date.now() - t0) / 1000) }));
if (out) fs.writeFileSync(out, JSON.stringify(res));
process.exit(0);
