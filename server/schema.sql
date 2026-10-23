-- Woodpusher database schema. Safe to run on every start.
CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT NOT NULL,
  username_lower TEXT NOT NULL UNIQUE,
  pass_hash     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ratings (
  user_id    INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  category   TEXT NOT NULL,              -- bullet | blitz | rapid | classical
  rating     DOUBLE PRECISION NOT NULL DEFAULT 1500,
  rd         DOUBLE PRECISION NOT NULL DEFAULT 350,
  vol        DOUBLE PRECISION NOT NULL DEFAULT 0.06,
  games      INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, category)
);

CREATE TABLE IF NOT EXISTS games (
  id            TEXT PRIMARY KEY,
  white_id      INT REFERENCES users(id) ON DELETE SET NULL,
  black_id      INT REFERENCES users(id) ON DELETE SET NULL,
  white_name    TEXT NOT NULL,
  black_name    TEXT NOT NULL,
  tc            TEXT NOT NULL,
  category      TEXT NOT NULL,
  rated         BOOLEAN NOT NULL DEFAULT true,
  status        TEXT NOT NULL,           -- active | finished | aborted
  result        TEXT,                    -- 1-0 | 0-1 | 1/2-1/2
  reason        TEXT,
  moves         TEXT NOT NULL DEFAULT '',
  white_ms      INT,
  black_ms      INT,
  white_rating  INT,
  black_rating  INT,
  white_diff    INT,
  black_diff    INT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at      TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS games_white_idx ON games (white_id, created_at DESC);
CREATE INDEX IF NOT EXISTS games_black_idx ON games (black_id, created_at DESC);
CREATE INDEX IF NOT EXISTS games_status_idx ON games (status);

-- Puzzle, opening and Stockfish-game progress per account (see server/progress.js)
CREATE TABLE IF NOT EXISTS progress (
  user_id    INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
