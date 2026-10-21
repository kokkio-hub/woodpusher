// Glicko-2 rating update for a single game (the way Lichess treats each game as a rating period).
const TAU = 0.5;
const SCALE = 173.7178;
const EPS = 1e-6;

export const DEFAULT = { rating: 1500, rd: 350, vol: 0.06 };

export function update(player, opponent, score) {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const sigma = player.vol;
  const muJ = (opponent.rating - 1500) / SCALE;
  const phiJ = opponent.rd / SCALE;

  const g = 1 / Math.sqrt(1 + (3 * phiJ * phiJ) / (Math.PI * Math.PI));
  const E = 1 / (1 + Math.exp(-g * (mu - muJ)));
  const v = 1 / (g * g * E * (1 - E));
  const delta = v * g * (score - E);

  const a = Math.log(sigma * sigma);
  const f = (x) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * Math.pow(phi * phi + v + ex, 2)) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B;
  if (delta * delta > phi * phi + v) B = Math.log(delta * delta - phi * phi - v);
  else {
    let k = 1;
    while (f(a - k * TAU) < 0 && k < 100) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  let guard = 0;
  while (Math.abs(B - A) > EPS && guard++ < 200) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else fA /= 2;
    B = C; fB = fC;
  }
  const sigmaP = Math.exp(A / 2);
  const phiStar = Math.sqrt(phi * phi + sigmaP * sigmaP);
  const phiP = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muP = mu + phiP * phiP * g * (score - E);
  return {
    rating: Math.max(400, muP * SCALE + 1500),
    rd: Math.min(350, Math.max(45, phiP * SCALE)),
    vol: Math.min(0.1, sigmaP),
  };
}

// Before a player's rating settles, show it with a "?" like Lichess does
export const provisional = (rd) => rd > 110;
