# Woodpusher

Chess on a hand-drawn board: play people online with matchmaking, play Stockfish, solve puzzles, learn openings and review your games.

- **Online play**: accounts, Glicko-2 ratings per time control (bullet, blitz, rapid, classical), matchmaking that widens the rating range the longer you wait, friend-challenge links, draw offers, rematches, abort, claim-the-win when an opponent leaves.
- **The server is the referee**: every move is checked for legality on the server, and the clocks run on the server. Games survive a server restart (for example a new deploy) without anyone losing time.
- **Eight piece styles and six boards**, from club wood and antique ivory to frosted and modern glass, picked in Settings.
- **Offline features** run in the browser: Stockfish 10 (WebAssembly), 94 engine-checked puzzles, 18 openings with 49 annotated lines, and full game review.

## Run it on your own computer

You need Node.js 20 or newer and PostgreSQL.

```bash
npm install
cp .env.example .env          # then fill in the values
export $(grep -v '^#' .env | xargs)
npm start                      # http://localhost:3000
```

The database tables are created automatically on start.

## Put it online with Railway (about $5 a month)

1. Go to [railway.com](https://railway.com) and sign in with your GitHub account.
2. Choose the **Hobby** plan. It includes $5 of usage a month, which covers this site and its database at normal use.
3. Click **New Project → Deploy from GitHub repo** and pick `kokkio-hub/woodpusher`. If Railway can't see the repository, allow it access to it on GitHub when asked.
4. In the same project, click **New → Database → PostgreSQL**.
5. Open the **woodpusher** service, go to **Variables**, and add:
   - `DATABASE_URL` = `${{Postgres.DATABASE_URL}}` (Railway fills this in from the database)
   - `SESSION_SECRET` = a long random string. Generate one with `openssl rand -hex 32` or a password manager.
   - `NODE_ENV` = `production`
6. Go to **Settings → Networking** and click **Generate Domain**. You get an address like `woodpusher-production.up.railway.app`. You can add your own domain there too.
7. Wait for the deploy to finish, then open the address.

Railway redeploys automatically every time new code lands on the `main` branch.

## Before you share it publicly

- Fill in the placeholders marked in `front/privacy.html` (name, contact email, hosting details), then run `npm run build:front`.
- Woodpusher stores only a username, a bcrypt password hash, ratings and games. No email addresses, no tracking, and the fonts are self-hosted.
- Players can delete their account themselves. This removes the account and ratings and takes their name out of past games.

## Project layout

```
server/        Node.js server: Express, Socket.IO, PostgreSQL
  index.js     web server, security headers, sessions
  auth.js      register, log in, log out, delete account, profiles
  games.js     matchmaking, friend challenges, live games, clocks, ratings
  glicko.js    Glicko-2 rating calculation
  schema.sql   database tables
front/         source of the web page
  app.html     board, clock, play vs Stockfish, review
  trainer.js   puzzles and opening lessons
  online.js    online lobby and live games
  data/        openings and puzzles
public/        the built site that the server sends to browsers
tools/         build script for public/
test/          end-to-end tests
```

After changing anything in `front/`, run `npm run build:front` to rebuild `public/`.

## Tests

With the server running locally on port 3100:

```bash
node test/sim.mjs        # two simulated players: matchmaking, a full game, challenge, draw, rematch
node test/restart.mjs    # a game survives a server restart
python3 test/e2e.py      # two real browsers (needs Playwright)
```

## Licence

Woodpusher is licensed under the GNU General Public License v3.0 or later (see `LICENSE`), because it ships the Stockfish chess engine ([stockfish.js](https://github.com/nmrugg/stockfish.js), GPL-3.0). The fonts (Carlito, Outfit, Share Tech Mono) are under the SIL Open Font License.
