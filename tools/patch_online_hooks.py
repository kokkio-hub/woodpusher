p='/home/claude/wp-online/front/app.html'; s=open(p).read()
def rep(old, new):
    global s
    assert s.count(old) == 1, (s.count(old), old[:90])
    s = s.replace(old, new)
OW = "window.WP_ONLINE"
# --- HTML: tab + panel
rep('    <button class="btn btn-small tab" id="btnNew" aria-current="page">Play</button>',
    '    <button class="btn btn-small tab" id="btnNew" aria-current="page">Play</button>\n    <button class="btn btn-small tab" id="btnOnline" hidden>Play online</button>')
rep('    <section class="card stack" id="lessonPanel" hidden aria-label="Opening lessons"></section>',
    '    <section class="card stack" id="lessonPanel" hidden aria-label="Opening lessons"></section>\n\n    <section class="card stack" id="onlinePanel" hidden aria-label="Play online"></section>')
# --- CSS for online UI
rep(".sheet, .annot, .banner-card { background-size: 192px 192px; }", """.sheet, .annot, .banner-card { background-size: 192px 192px; }
.input { width: 100%; box-sizing: border-box; padding: 10px 12px; background: rgba(0,0,0,.28); color: var(--ivory); border: 1px solid rgba(201,165,94,.45); border-radius: 5px; font: 16px var(--f-body); }
.input:focus { outline: 2px solid var(--brass-hi); outline-offset: 1px; }
.form { display: flex; flex-direction: column; gap: 10px; }
.form label { display: flex; flex-direction: column; gap: 5px; font-size: 13px; letter-spacing: .1em; text-transform: uppercase; color: var(--ivory-dim); font-weight: 600; }
.fine { font-size: 13.5px; color: var(--ivory-dim); margin: 0; }
.fine a { color: var(--brass-hi); }
.ratings-row { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
.rbox { border: 1px solid rgba(201,165,94,.28); background: rgba(0,0,0,.2); border-radius: 5px; padding: 7px 6px; text-align: center; }
.rbox small { display: block; font-size: 10.5px; letter-spacing: .12em; text-transform: uppercase; color: var(--ivory-dim); font-weight: 600; }
.rbox b { font-family: var(--f-display); font-weight: 400; font-size: 22px; color: var(--ivory); font-variant-numeric: tabular-nums; }
.who-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
.user-chip { font-weight: 700; color: var(--brass-hi); }
.seek-box { border: 1px dashed rgba(201,165,94,.55); border-radius: 6px; padding: 14px; display: flex; flex-direction: column; gap: 8px; background: rgba(0,0,0,.18); }
.seek-box b { font-family: var(--f-display); font-weight: 400; font-size: 22px; color: var(--ivory); }
.spinner { width: 18px; height: 18px; border-radius: 50%; border: 2px solid rgba(201,165,94,.3); border-top-color: var(--brass-hi); animation: spin .9s linear infinite; display: inline-block; vertical-align: -3px; margin-right: 8px; }
@keyframes spin { to { transform: rotate(360deg); } }
.link-row { display: flex; gap: 6px; }
.link-row .input { font-size: 14px; }
.stat-line { font-size: 14px; color: var(--ivory-dim); font-variant-numeric: tabular-nums; }
.game-list { display: flex; flex-direction: column; }
.game-row { display: grid; grid-template-columns: 22px minmax(0,1fr) auto; gap: 8px; align-items: center; padding: 8px 4px; border-top: 1px solid rgba(201,165,94,.16); background: none; border-left: 0; border-right: 0; border-bottom: 0; color: var(--ivory); text-align: left; cursor: pointer; font: inherit; }
.game-row:hover { background: rgba(201,165,94,.08); }
.game-row .res { width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; font: 700 11px/1 var(--f-body); color: #fff; }
.game-row .res.win { background: var(--c-best); } .game-row .res.loss { background: var(--c-blunder); } .game-row .res.draw { background: var(--c-forced); }
.game-row .meta { font-size: 13px; color: var(--ivory-dim); }
.game-row .d { font-weight: 700; font-variant-numeric: tabular-nums; font-size: 14px; }
.d.up { color: #9fd884; } .d.down { color: #ff9f90; }
.offer { border: 1px solid var(--brass); background: rgba(201,165,94,.14); border-radius: 6px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }
.danger-link { background: none; border: 0; padding: 0; color: #ffb4a8; cursor: pointer; font: 600 13.5px var(--f-body); }
.account-row { display: flex; gap: 14px; flex-wrap: wrap; align-items: center; }""")
# --- JS hooks
rep("  if (S.mode === 'lesson') return T.kind === 'lesson' && LS.phase === 'practice' && LS.state === 'await' && S.chess.turn() === LS.color;",
    "  if (S.mode === 'lesson') return T.kind === 'lesson' && LS.phase === 'practice' && LS.state === 'await' && S.chess.turn() === LS.color;\n  if (S.mode === 'online') return !!(" + OW + " && " + OW + ".canMove());")
rep("  else if (S.mode === 'lesson') lessonMove(mv);", "  else if (S.mode === 'lesson') lessonMove(mv);\n  else if (S.mode === 'online' && " + OW + ") " + OW + ".move(mv);")
rep("  return c.running === color && S.mode === 'play' ? c[color] - (performance.now() - c.last) : c[color];",
    "  return c.running === color && (S.mode === 'play' || S.mode === 'online') ? c[color] - (performance.now() - c.last) : c[color];")
rep("    const running = g && S.mode === 'play' && g.clock.running === color;", "    const running = g && (S.mode === 'play' || S.mode === 'online') && g.clock.running === color;")
rep("    const on = g && S.mode === 'play' && g.clock.running === color; ch.classList.toggle('on', !!on);", "    const on = g && (S.mode === 'play' || S.mode === 'online') && g.clock.running === color; ch.classList.toggle('on', !!on);")
rep("${['idle', 'play', 'paused', 'over'].includes(S.mode) ?", "${['idle', 'play', 'paused', 'over', 'online'].includes(S.mode) ?")
rep("  else if (g && L.source === 'play') who = w === g.playerColor ? 'You win' : 'Stockfish wins';",
    "  else if (g && L.source === 'play') who = w === g.playerColor ? 'You win' : 'Stockfish wins';\n  else if (L.source === 'online' && g && g.you) who = w === g.you ? 'You win' : `${L.names[w]} wins`;\n  else if (L.source === 'online') who = `${L.names[w]} wins`;")
rep("'timeout vs insufficient material': 'by timeout against insufficient material' }[L.reason] || '';",
    "'timeout vs insufficient material': 'by timeout against insufficient material', abandonment: 'because the opponent left' }[L.reason] || '';")
rep("function resultSentence() {\n  const L = S.line; if (!L || L.result === '*') return '';", "function resultSentence() {\n  const L = S.line; if (!L) return '';\n  if (L.reason === 'aborted') return 'The game was aborted before both players moved.';\n  if (L.result === '*') return '';")
rep("function renderBanner() {\n  const el = $('#banner'); const L = S.line;", "function renderBanner() {\n  if (S.mode === 'online' && " + OW + ") { " + OW + ".banner(); return; }\n  const el = $('#banner'); const L = S.line;")
rep("  if (S.mode === 'puzzle' || S.mode === 'lesson') renderTrainer();\n", "  if (S.mode === 'puzzle' || S.mode === 'lesson') renderTrainer();\n  if (S.mode === 'online' && " + OW + ") " + OW + ".render();\n")
rep("  if (S.mode === 'puzzle' || S.mode === 'lesson') return S.parked ||", "  if (S.mode === 'puzzle' || S.mode === 'lesson' || S.mode === 'online') return S.parked ||")
rep("  else if (S.mode === 'idle') note.textContent = '';", "  else if (S.mode === 'online' && " + OW + ") note.textContent = " + OW + ".note();\n  else if (S.mode === 'idle') note.textContent = '';")
rep("  $('#lessonPanel').hidden = m !== 'lesson';", "  $('#lessonPanel').hidden = m !== 'lesson';\n  $('#onlinePanel').hidden = m !== 'online';")
rep("  const tab = m === 'puzzle' ? 'btnPuzzles' :", "  const tab = m === 'online' || (m === 'review' && S.line && S.line.source === 'online') ? 'btnOnline' : m === 'puzzle' ? 'btnPuzzles' :")
rep("function exitReview() {\n  if (S.review) S.review.token++;\n  for (const e of ENG.pool) e.cancelAll();",
    "function exitReview() {\n  if (S.review) S.review.token++;\n  for (const e of ENG.pool) e.cancelAll();\n  if (S.line && S.line.source === 'online' && " + OW + ") { " + OW + ".open(); return; }")
rep("function abandonGame() {\n", "function abandonGame() {\n  if (" + OW + ") " + OW + ".leave();\n")
open(p, 'w').write(s); print('hooks patched')
