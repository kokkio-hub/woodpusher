"""Build the top-10 opponents: an opening book and a style profile per player.

Input: a folder of PGN files from The Week in Chess (https://theweekinchess.com),
for example the weekly issues of the last three years, unzipped. Only games played
over the board are used: internet games (site "INT") are left out, because bullet
and online blitz openings and habits are not the player's usual style.

    python3 tools/build_personas.py path/to/twic-pgns

Writes front/data/personas.js (profiles, small, loaded with the page) and
front/data/books/<id>.json (one opening book per player, loaded when you pick them).
Then run `npm run build:front`.

Book: for every position in the first 30 plies where the player was to move,
which moves they chose and how often. Classical games count fully, rapid 0.6
and blitz 0.35. Positions they reached only once are left out.

Style: statistics from the games themselves, compared between the ten players:
how sharp (captures and checks per move), how often the queens come off early,
how often they play on while down material without losing, how long their
games run, how often classical games end in a draw, and how often they push
pawns at the opponent's king. These become the nudges the in-browser engine uses.
"""
import io, json, math, os, re, sys, statistics
from collections import defaultdict
import chess, chess.pgn

LIST = 'October 2026'
# FIDE top 10, open standard list, October 2026.
PLAYERS = [
    dict(id='carlsen', name='Magnus Carlsen', short='Carlsen', fed='NOR', rating=2823, rank=1, pat=r'^Carlsen,\s*M'),
    dict(id='nakamura', name='Hikaru Nakamura', short='Nakamura', fed='USA', rating=2792, rank=2, pat=r'^Nakamura,\s*Hi'),
    dict(id='caruana', name='Fabiano Caruana', short='Caruana', fed='USA', rating=2784, rank=3, pat=r'^Caruana,\s*F'),
    dict(id='sindarov', name='Javokhir Sindarov', short='Sindarov', fed='UZB', rating=2782, rank=4, pat=r'^Sindarov,\s*J'),
    dict(id='abdusattorov', name='Nodirbek Abdusattorov', short='Abdusattorov', fed='UZB', rating=2780, rank=5, pat=r'^Abdusattorov,\s*N'),
    dict(id='so', name='Wesley So', short='So', fed='USA', rating=2770, rank=6, pat=r'^So,\s*W'),
    dict(id='praggnanandhaa', name='R Praggnanandhaa', short='Praggnanandhaa', fed='IND', rating=2763, rank=7, pat=r'^(Praggnanandhaa|Rameshbabu,\s*P)'),
    dict(id='keymer', name='Vincent Keymer', short='Keymer', fed='GER', rating=2761, rank=8, pat=r'^Keymer,\s*V'),
    dict(id='weiyi', name='Wei Yi', short='Wei Yi', fed='CHN', rating=2758, rank=9, pat=r'^Wei,?\s*Yi(?![-\w])'),
    dict(id='firouzja', name='Alireza Firouzja', short='Firouzja', fed='FRA', rating=2757, rank=10, pat=r'^Firouzja,\s*A'),
]
BOOK_PLIES = 30
WEIGHT = {'classical': 1.0, 'rapid': 0.6, 'blitz': 0.35}
VAL = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 0}
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def book_key(board):
    """Same as bookKey() in front/personas.js: FNV-1a over placement, side to move and castling."""
    p = board.fen().split(' ')
    s = ' '.join(p[:3])
    h = 0x811c9dc5
    for ch in s.encode('ascii'):
        h ^= ch
        h = (h * 0x01000193) & 0xffffffff
    digits = '0123456789abcdefghijklmnopqrstuvwxyz'
    out = ''
    while True:
        h, r = divmod(h, 36)
        out = digits[r] + out
        if h == 0:
            return out


def time_class(headers):
    """'online' for internet games (TWIC marks their site 'INT'), else classical, rapid or blitz over the board."""
    site, ev = headers.get('Site', ''), headers.get('Event', '').lower()
    if re.search(r'\bINT\b', site) or 'chess.com' in site.lower() or 'lichess' in site.lower() or 'titled tue' in ev or 'bullet' in ev:
        return 'online'
    if 'blitz' in ev or 'armageddon' in ev:
        return 'blitz'
    if any(k in ev for k in ('rapid', 'esports', 'gcl', 'global chess league')):
        return 'rapid'
    return 'classical'


def material(board, color):
    s = 0
    for sq, pc in board.piece_map().items():
        s += (1 if pc.color == color else -1) * VAL[pc.piece_type]
    return s


def first_move_san(board, mv, ply):
    no = ply // 2 + 1
    return f"{no}.{board.san(mv)}" if ply % 2 == 0 else f"{no}...{board.san(mv)}"


def main(src):
    files = sorted(os.path.join(dp, f) for dp, _, fs in os.walk(src) for f in fs if f.lower().endswith('.pgn'))
    if not files:
        sys.exit('no .pgn files found in ' + src)
    pats = [(p, re.compile(p['pat'], re.I)) for p in PLAYERS]
    book = {p['id']: {'w': defaultdict(lambda: defaultdict(lambda: [0, 0.0])), 'b': defaultdict(lambda: defaultdict(lambda: [0, 0.0]))} for p in PLAYERS}
    st = {p['id']: defaultdict(list) for p in PLAYERS}
    counts = {p['id']: defaultdict(int) for p in PLAYERS}
    names = {p['id']: defaultdict(int) for p in PLAYERS}
    first = {p['id']: {'w': defaultdict(float), 'e4': defaultdict(float), 'd4': defaultdict(float)} for p in PLAYERS}
    dates = []
    seen, used = set(), set()
    head_rx = re.compile(r'^\[(?:White|Black) "([^"]*)"\]', re.M)
    def candidates():
        # A quick text pass keeps only games with one of the ten players, so only those get parsed move by move.
        for path in files:
            with open(path, encoding='utf-8', errors='replace') as fh:
                text = fh.read()
            for chunk in re.split(r'\n(?=\[Event )', text):
                if any(rx.search(n) for n in head_rx.findall(chunk[:2000]) for _, rx in pats):
                    yield chunk
    for chunk in candidates():
        if True:
            if True:
                try:
                    g = chess.pgn.read_game(io.StringIO(chunk))
                except Exception:
                    continue
                if g is None:
                    continue
                h = g.headers
                if h.get('Variant', 'Standard').lower() not in ('standard', 'chess', '') or h.get('FEN') or h.get('SetUp') == '1':
                    continue
                hits = []
                for p, rx in pats:
                    if rx.search(h.get('White', '')):
                        hits.append((p, chess.WHITE))
                    if rx.search(h.get('Black', '')):
                        hits.append((p, chess.BLACK))
                if not hits:
                    continue
                moves = list(g.mainline_moves())
                if len(moves) < 2:
                    continue
                sig = (h.get('White'), h.get('Black'), h.get('Date'), ' '.join(m.uci() for m in moves[:24]))
                if sig in seen:
                    continue
                seen.add(sig)
                tc = time_class(h)
                if tc == 'online':
                    for p, _ in hits:
                        counts[p['id']]['online_skipped'] += 1
                    continue
                w8 = WEIGHT[tc]
                used.add(sig)
                d = h.get('Date', '')
                if re.match(r'^\d{4}\.\d{2}', d):
                    dates.append(d[:7])
                res = h.get('Result', '*')
                for p, color in hits:
                    pid = p['id']
                    counts[pid][tc] += 1
                    names[pid][h.get('White') if color == chess.WHITE else h.get('Black')] += 1
                    b = chess.Board()
                    side = 'w' if color == chess.WHITE else 'b'
                    my_moves = my_sharp = 0
                    queens_off_early = False
                    down = run = 0
                    stormed = False
                    for ply, mv in enumerate(moves):
                        mine = b.turn == color
                        if ply < BOOK_PLIES and mine:
                            e = book[pid][side][book_key(b)][mv.uci()]
                            e[0] += 1
                            e[1] += w8
                        if ply == 0 and color == chess.WHITE:
                            first[pid]['w'][first_move_san(b, mv, ply)] += w8
                        if ply == 1 and color == chess.BLACK:
                            m0 = moves[0].uci()
                            if m0 == 'e2e4':
                                first[pid]['e4'][first_move_san(b, mv, ply)] += w8
                            elif m0 == 'd2d4':
                                first[pid]['d4'][first_move_san(b, mv, ply)] += w8
                        if mine and 16 <= ply < 80:
                            my_moves += 1
                            if b.is_capture(mv) or b.gives_check(mv):
                                my_sharp += 1
                        if mine and ply < 50 and b.piece_type_at(mv.from_square) == chess.PAWN:
                            ek = b.king(not color)
                            if ek is not None:
                                kf, f = chess.square_file(ek), chess.square_file(mv.to_square)
                                r = chess.square_rank(mv.to_square)
                                adv = r >= 4 if color == chess.WHITE else r <= 3
                                if adv and kf >= 5 and f >= 5:
                                    stormed = True
                        b.push(mv)
                        if ply <= 50 and not b.pieces(chess.QUEEN, chess.WHITE) and not b.pieces(chess.QUEEN, chess.BLACK):
                            queens_off_early = True
                        if 12 <= ply <= 80:
                            if material(b, color) <= -2:
                                run += 1
                                down = max(down, run)
                            else:
                                run = 0
                    lost = (res == '0-1' and color == chess.WHITE) or (res == '1-0' and color == chess.BLACK)
                    if len(moves) >= 30:
                        S = st[pid]
                        S['sharp'].append(my_sharp / max(1, my_moves))
                        S['qtrade'].append(1.0 if queens_off_early else 0.0)
                        S['sac'].append(1.0 if down >= 6 and not lost else 0.0)
                        S['storm'].append(1.0 if stormed else 0.0)
                        S['length'].append(len(moves) / 2)
                        if tc == 'classical' and res in ('1-0', '0-1', '1/2-1/2'):
                            S['draw'].append(1.0 if res == '1/2-1/2' else 0.0)

    for p in PLAYERS:
        top = sorted(names[p['id']].items(), key=lambda x: -x[1])[:4]
        print(f"{p['id']:15s} {dict(counts[p['id']])}  names={top}")

    means = {}
    for p in PLAYERS:
        S = st[p['id']]
        means[p['id']] = {k: (statistics.mean(S[k]) if S[k] else 0.0) for k in ('sharp', 'qtrade', 'sac', 'storm', 'length', 'draw')}

    def z(key):
        xs = [means[p['id']][key] for p in PLAYERS]
        mu, sd = statistics.mean(xs), statistics.pstdev(xs) or 1.0
        return {p['id']: max(-1.5, min(1.5, (means[p['id']][key] - mu) / sd)) / 1.5 for p in PLAYERS}

    def unit(key, combine=None):
        xs = {p['id']: (combine(p['id']) if combine else means[p['id']][key]) for p in PLAYERS}
        lo, hi = min(xs.values()), max(xs.values())
        return {k: round(0.15 + 0.7 * ((v - lo) / (hi - lo) if hi > lo else 0.5), 3) for k, v in xs.items()}

    zs = {k: z(k) for k in ('sharp', 'qtrade', 'sac', 'storm', 'draw')}
    sharp_axis = unit('sharp', lambda pid: zs['sharp'][pid] + 0.5 * zs['sac'][pid])
    trade_axis, long_axis = unit('qtrade'), unit('length')

    def top_moves(d):
        tot = sum(d.values()) or 1.0
        return [[m, round(v / tot, 3)] for m, v in sorted(d.items(), key=lambda x: -x[1])[:4]]

    out = []
    os.makedirs(os.path.join(ROOT, 'front', 'data', 'books'), exist_ok=True)
    span = (min(dates), max(dates)) if dates else ('', '')
    month = lambda ym: f"{['January','February','March','April','May','June','July','August','September','October','November','December'][int(ym[5:7]) - 1]} {ym[:4]}" if ym else ''
    for p in PLAYERS:
        pid = p['id']
        bk = {}
        npos = 0
        for side in ('w', 'b'):
            bk[side] = {}
            for key, mvs in book[pid][side].items():
                games = sum(v[0] for v in mvs.values())
                if games < 2:
                    continue
                wt = sum(v[1] for v in mvs.values())
                keep = [[u, v[0], round(v[1], 2)] for u, v in sorted(mvs.items(), key=lambda x: -x[1][1]) if v[1] / wt >= 0.03]
                if keep:
                    bk[side][key] = keep
                    npos += 1
        with open(os.path.join(ROOT, 'front', 'data', 'books', pid + '.json'), 'w') as fh:
            json.dump(bk, fh, separators=(',', ':'))
        m = means[pid]
        c = counts[pid]
        out.append(dict(
            id=pid, name=p['name'], short=p['short'], fed=p['fed'], rating=p['rating'], rank=p['rank'], list=LIST, bookPlies=BOOK_PLIES,
            games=dict(total=c['classical'] + c['rapid'] + c['blitz'], classical=c['classical'], rapid=c['rapid'], blitz=c['blitz'], positions=npos, source=len(used), **{'from': month(span[0]), 'to': month(span[1])}),
            stats={k: round(v, 3) for k, v in m.items()},
            axes=dict(sharp=sharp_axis[pid], trades=trade_axis[pid], long=long_axis[pid]),
            w=dict(tactic=round(zs['sharp'][pid], 3), trade=round(zs['qtrade'][pid], 3), sac=round(zs['sac'][pid], 3), storm=round(zs['storm'][pid], 3),
                   contempt=int(max(0, min(60, round(24 - 24 * zs['draw'][pid]))))),
            first=dict(w=top_moves(first[pid]['w']), e4=top_moves(first[pid]['e4']), d4=top_moves(first[pid]['d4'])),
        ))
        print(f"{pid:15s} book positions={npos:5d}  stats={out[-1]['stats']}  w={out[-1]['w']}")
    with open(os.path.join(ROOT, 'front', 'data', 'personas.js'), 'w') as fh:
        fh.write('// Generated by tools/build_personas.py from games published in The Week in Chess. Do not edit by hand.\n')
        fh.write('const PERSONAS = ' + json.dumps(out, ensure_ascii=False, separators=(',', ':')) + ';\n')
    print('wrote front/data/personas.js and', len(PLAYERS), 'books; games from', span[0], 'to', span[1])


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else '.')
