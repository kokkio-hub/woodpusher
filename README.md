# Woodpusher

Chess on a hand-drawn board: play people online with matchmaking, play Stockfish, solve puzzles, learn openings and review your games.

- **Online play**: accounts, Glicko-2 ratings per time control (bullet, blitz, rapid, classical), matchmaking that widens the rating range the longer you wait, friend-challenge links, draw offers, rematches, abort, claim-the-win when an opponent leaves.
- **Premoves, like chess.com**: while your opponent (or Stockfish) is thinking, queue one or more moves. They show on the board in red and each one plays the instant the turn comes back. Click an empty square, right-click or press Esc to cancel. Can be switched off in Settings.
- **The server is the referee**: every move is checked for legality on the server, and the clocks run on the server. Games survive a server restart (for example a new deploy) without anyone losing time.
- **Top-10 opponents**: bots in the style of the FIDE top 10. Each plays the player's real openings, from a book built out of their over-the-board games, then Stockfish picks among its best moves with a nudge towards that player's habits (sharpness, queen trades, sacrifices, pawn storms, how hard they avoid draws).
- **Eight piece styles and nine boards**, from club wood and antique ivory to frosted and modern glass, picked in Settings. The four wooden boards (walnut & maple, rosewood & boxwood, mahogany & bird's-eye maple, smoked oak & ash) are generated in the browser at the exact pixel size of your screen, with pores, fibres and growth rings down to single pixels.
- **Offline features** run in the browser: Stockfish 19 (WebAssembly), 94 built-in engine-checked puzzles (plus the last batch fetched from the big set), 18 openings with 49 annotated lines, and full game review.
- **Tens of thousands of puzzles** from the Lichess puzzle database (CC0): on its first start the server downloads the file and keeps about 36,000 well-tested, popular puzzles spread evenly from 400 to 3000, then serves them about twenty at a time near your rating, by theme (`server/puzzles.js`). A puzzle counts for your rating the first time only.
- **Puzzle of the day**: the same puzzle for everyone on a date, with a streak of days solved.
- **Learn from your mistakes**: after a review of your own game, your mistakes and blunders become puzzles. The board starts one move earlier, your opponent plays their move, and you look for something better than what you played. Stockfish's best move counts, and so does any move it rates about as good. They stay under Puzzles, in "Your mistakes", and follow your account.
- **Watch live games**: the lobby lists the rated games in progress, strongest first, and anyone can watch, also without an account. Friend games stay off the list.
- **Ready-made messages** in online games ("Good luck", "Good game", "Nice move"…): a fixed list, so there is nothing to moderate; at most one every 1.5 seconds. Can be turned off in Settings.
- **Reports and fair-play checks**: players report others from a profile or after a game. Every finished rated game is checked in the background by Stockfish in a separate low-priority process (`server/fairplay.js`), and players whose games look like engine play are flagged. The admin (the usernames in `ADMIN_USERS`) sees reports and flags under Settings → Reports and fair play, and can close or reopen an account; nothing happens automatically (`server/moderation.js`).
- **Game review in plain words**: every move is graded from brilliant and great down to blunder. Brilliant moves (sound sacrifices), great moves (the only good move), mistakes and blunders get a short note that says what actually happens: a piece left hanging, a threat not dealt with, a fork, a missed or allowed mate, material won or missed. The notes are worked out from Stockfish's lines, so they only name a tactic the engine's line shows (`front/commentary.js`).
- **Play through**: replays a reviewed game on the board and pauses at each brilliant or great move, mistake and blunder, with its note, until you press Continue. Three speeds; Space plays and pauses.
- **Review your Lichess and Chess.com games by username**: type a username, pick one of the 25 most recent games of standard chess, and it opens in the review from that player's side. The server fetches the games (one request at a time per site, with a User-Agent that names Woodpusher, as both sites ask) and keeps each answer for two minutes (`server/import.js`).
- **Something to do while you wait**: after "Find an opponent" you can play a bot or solve puzzles and keep your place in the queue. A bar at the bottom shows the search on every page. When the opponent is found the game starts straight away, and a bot game in progress is paused, to be resumed after the online game. The lobby shows how many players wait at each clock, and suggests a clock where someone is waiting.
- **Progress follows your account**: puzzle rating and streaks, practised opening lines and the games against Stockfish behind the estimated Elo are saved to your account and merged between devices, so playing on two devices never loses anything (`server/progress.js`, `front/sync.js`). Progress made before logging in is added to the account.
- **Profiles and a leaderboard**: `/@/name` shows ratings and win/draw/loss per time control, a rating graph, and the whole game history with a Review button per game; your own profile also shows your puzzle and opening progress. `/leaderboard` lists the top 50 per time control.
- **Install it as an app**: a web app manifest and a service worker (`front/sw.js`) make Woodpusher installable from Chrome, Edge, Samsung Internet and Safari on iPhone and iPad. Once loaded it opens without a connection too: Stockfish, the top-10 bots, puzzles, openings and reviews all work offline. Install from Settings or the footer link.

## Run it on your own computer

You need Node.js 22 (22.15 or newer, for reading the zstd-compressed puzzle file) and PostgreSQL.

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
   - `ADMIN_USERS` = your Woodpusher username (several: separated by commas). These accounts see reports and fair-play flags.
6. Go to **Settings → Networking** and click **Generate Domain**. You get an address like `woodpusher-production.up.railway.app`. You can add your own domain there too.
7. Wait for the deploy to finish, then open the address.

Railway redeploys automatically every time new code lands on the `main` branch.

## Before you share it publicly

- The privacy statement is `front/privacy.html`. After changing it, run `npm run build:front` so the copy in `public/` is updated.
- Woodpusher stores only a username, a bcrypt password hash, ratings, games and (for logged-in players) puzzle, opening and Stockfish-game progress. No email addresses, no tracking, and the fonts are self-hosted.
- Players can delete their account themselves. This removes the account, ratings and saved progress and takes their name out of past games.

## Project layout

```
server/        Node.js server: Express, Socket.IO, PostgreSQL
  index.js     web server, security headers, sessions
  auth.js      register, log in, log out, delete account, profiles
  players.js   game history pages, rating history, leaderboard
  progress.js  progress saved per account, merged between devices
  import.js    recent games from Lichess and Chess.com by username
  puzzles.js   the Lichess puzzle selection, by rating and theme, and the puzzle of the day
  zstd.js      reads multi-frame .zst files (the Lichess file), which Node's own decoder stops early on
  fairplay.js  the background Stockfish check of rated games
  moderation.js  reports, the admin view, closing accounts
  games.js     matchmaking, friend challenges, live games, clocks, ratings
  glicko.js    Glicko-2 rating calculation
  schema.sql   database tables
front/         source of the web page
  app.html     board, clock, play vs Stockfish, review, play through
  commentary.js  review notes, and the tests for great and brilliant moves
  trainer.js   puzzles (the big set, the daily puzzle, your mistakes) and opening lessons
  online.js    online lobby, live games, watching, messages, waiting in the queue
  importer.js  Review a game: find games by username
  sync.js      sends progress to the account and back
  players.js   profile pages, the leaderboard, reports and the admin view
  install.js   installing as an app; sw.js is the service worker
  404.html     the page for addresses that don't exist
  data/        openings and puzzles
public/        the built site that the server sends to browsers
tools/         build script for public/; engine-check/ measures the engine (bot strength, review quality)
test/          end-to-end tests
```

After changing anything in `front/`, run `npm run build:front` to rebuild `public/`.

## The engine

Stockfish 19 runs in the player's browser, in a Web Worker, through [stockfish.js](https://github.com/nmrugg/stockfish.js) 19.0.1. Woodpusher uses its "lite, single-threaded" build (`front/vendor/stockfish.js` and `stockfish.wasm`, about 1.9 MB together), with the asm.js build (`stockfish.asm.js`) as the fallback for browsers without WebAssembly.

- **Why lite, single-threaded**: it evaluates with a small neural network, loads quickly on a phone and runs on any host. The full build is stronger but about 99 MB, too much to download for every visitor. The multi-threaded builds need the whole site to be cross-origin isolated (COOP/COEP headers), and add little here because the review already runs up to three engines side by side, one per position.
- **Game review** searches each position to depth 18 or for 1.7 seconds, whichever comes first, with the two best lines; the progress line shows the depth actually reached. The lite network's evaluations run about a fifth smaller than full-size Stockfish's, so the review scales them by 1.2 (`EVAL_SCALE`) to match the winning-chances curve the grades are made for. Measured on 400 moves of club-level games against full-size Stockfish 19 at depth 20, the review gives the same grade on about 70% of moves and an accuracy within about 1 point. Stockfish 10 managed 52%, with accuracies 12 points too low, partly because its Contempt setting tilted every evaluation towards the side to move.
- **The Stockfish bot** keeps its recipe (search depth, thinking time, a weighted choice among the best four moves, random moves at the lowest ratings). Stockfish 19 plays that recipe much stronger, so each Elo setting now uses the notch of the recipe that scored even against the old Stockfish 10 bot at the same setting (`ELO_RECIPE` in `front/app.html`). A setting therefore means what it meant before.
- **The top-10 bots** avoid draws in their own move picker (`front/personas.js`), because modern Stockfish has no Contempt option: a move Stockfish rates a dead draw, or one that repeats a position, counts as worse by that player's contempt.

To move to a newer stockfish.js: `npm pack stockfish@<version>`, copy `bin/stockfish-<v>-lite-single.js` and `.wasm` to `front/vendor/stockfish.js` and `stockfish.wasm`, `bin/stockfish-<v>-asm.js` to `stockfish.asm.js` and `Copying.txt` to `STOCKFISH-COPYING.txt`, update `SF_VERSION` and the CDN line in `front/app.html`, run `npm run build:front`, then check `EVAL_SCALE` and `ELO_RECIPE` again with the scripts in `tools/engine-check/`:

```bash
# Bot against bot from 16 openings, colours swapped. Here both play notch 1740, the 2000 setting today:
# an even score means that setting needs no change; otherwise move the new engine's notch until it is even.
node tools/engine-check/match.mjs new/stockfish.js 1740 old/stockfish.js 1740 32 games.json
# The review against a deep reference (the full single-threaded build), on games from a match.
node tools/engine-check/review.mjs games.json 5 ref=full/stockfish-19-single.js:20:6000 lite=new/stockfish.js:18:1700:1.2
```

## Updating the top-10 opponents

The books and style profiles are built from The Week in Chess (theweekinchess.com), which publishes every over-the-board game as free weekly PGN files.

1. Download and unzip the weekly issues you want (for example the last three years) into one folder.
2. Edit the player list and `LIST` at the top of `tools/build_personas.py` if the rankings changed.
3. Run `python3 tools/build_personas.py path/to/folder` (needs `pip install chess`). This writes `front/data/personas.js` and `front/data/books/`.
4. Run `npm run build:front`.

## Tests

With the server running locally on port 3100:

```bash
node test/sim.mjs        # two simulated players: matchmaking, a full game, challenge, draw, rematch
node test/restart.mjs    # a game survives a server restart
python3 test/e2e.py      # two real browsers (needs Playwright)
python3 test/premove.py  # premoves online and against Stockfish, in two real browsers
python3 test/review.py   # review grades and notes on sample games, and Play through stopping at the right moves
```

Optional settings for testing: `PUZZLE_IMPORT=off` skips the puzzle download, `PUZZLE_SOURCE` points it at another file (`node test/make-puzzle-sample.mjs` makes a small one; `MOCK_PUZZLES=<file> node test/mock-sites.mjs` serves it), `PUZZLE_PER_BAND` sets how many puzzles to keep per 50 rating points (default 700), and `FAIRPLAY=off` turns the fair-play check off.

To test the username import without reaching Lichess or Chess.com, run `node test/mock-sites.mjs` (a stand-in for both sites on port 3199) and start the server with `IMPORT_LICHESS_BASE=http://localhost:3199 IMPORT_CHESSCOM_BASE=http://localhost:3199`.

## Licence

Woodpusher is licensed under the GNU General Public License v3.0 or later (see `LICENSE`), because it ships the Stockfish chess engine ([stockfish.js](https://github.com/nmrugg/stockfish.js), GPL-3.0). The fonts (Carlito, Outfit, Share Tech Mono) are under the SIL Open Font License.
