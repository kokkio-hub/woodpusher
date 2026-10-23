// Writes a small file in the format of the Lichess puzzle database (lichess_db_puzzle.csv.zst), made
// from Woodpusher's own puzzles with ratings spread out, for testing the import without the real file:
//   node test/make-puzzle-sample.mjs /tmp/puzzles.csv.zst
//   MOCK_PUZZLES=/tmp/puzzles.csv.zst node test/mock-sites.mjs   (serves it at /lichess_db_puzzle.csv.zst)
//   PUZZLE_SOURCE=http://localhost:3199/lichess_db_puzzle.csv.zst PUZZLE_PER_BAND=40 npm start
import fs from 'node:fs'; import zlib from 'node:zlib'; import vm from 'node:vm';
const ctx = {}; vm.runInNewContext(fs.readFileSync(new URL('../front/data/puzzles.js', import.meta.url), 'utf8') + ';this.P = PUZZLES;', ctx);
const TAG = { 'Mate in 1': 'mateIn1', 'Mate in 2': 'mateIn2', 'Mate in 3': 'mateIn3', 'Mate in 4': 'mateIn4', 'Back-rank mate': 'backRankMate', Fork: 'fork', Sacrifice: 'sacrifice', 'Win material': 'crushing', Endgame: 'endgame', Promotion: 'promotion', 'Knight mate': 'smotheredMate' };
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const lines = ['PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags'];
for (let k = 0; k < 70; k++) for (const [i, p] of ctx.P.entries()) {
  const id = 'T' + k.toString(36) + i.toString(36).padStart(2, '0') + 'x';
  const rating = Math.round(350 + rnd() * 2800); const pop = rnd() < 0.15 ? 60 : 92; const rd = rnd() < 0.1 ? 120 : 76;
  const tags = p[3].split(',').map(t => TAG[t]).filter(Boolean).concat(rnd() < .5 ? ['middlegame', 'short'] : ['endgame', 'long']);
  lines.push([id, p[0], p[1], rating, rd, pop, 900 + Math.round(rnd() * 9000), tags.join(' '), `https://lichess.org/abc${k}${i}#30`, ''].join(','));
}
fs.writeFileSync(process.argv[2], zlib.zstdCompressSync(Buffer.from(lines.join('\n') + '\n')));
console.log('wrote', lines.length - 1, 'puzzles to', process.argv[2]);
