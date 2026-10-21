/* =====================================================================
   Opening animation. The markup and keyframes live in the page, so the
   espresso screen covers it from the very first paint. The drawing waits
   for startOpening(), which boot calls once the heavy start-up work is
   done, so nothing interrupts the knight mid-stroke. When the wordmark has
   wiped in, the logo flies into the top bar while the backdrop fades and
   the room rises into view. A click, tap or key skips it; with reduced
   motion it simply shows the logo and fades. If the script never runs, a
   CSS fallback fades the screen out on its own.
   ===================================================================== */
const OPENING = { leave: null, started: false };
function runOpening() {
  const el = document.getElementById('opening'); if (!el) return;
  const lk = document.getElementById('openingLockup'), target = document.getElementById('brandLockup');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let leaving = false;
  const reveal = (dur) => {
    if (reduce || !document.body.animate) return;
    [...document.querySelectorAll('.topbar > *, .room > *')].forEach((n, i) =>
      n.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: dur, delay: 60 + i * 45, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'backwards' }));
  };
  const leave = (fast) => {
    if (leaving) return; leaving = true;
    el.style.animation = 'none'; el.style.pointerEvents = 'none';          // take over from the CSS fallback
    if (target) { target.style.animation = 'none'; target.style.opacity = '0'; }
    const done = () => { if (target) target.style.opacity = ''; el.remove(); };
    const S = lk.getBoundingClientRect(), H = target ? target.getBoundingClientRect() : null;
    const canFly = !fast && !reduce && !!lk.animate && el.classList.contains('go') && H && H.width > 0 && H.bottom > 0 && S.height > 0;
    if (!el.animate) { done(); return; }
    if (!canFly) {
      el.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fast ? 200 : 420, easing: 'ease', fill: 'forwards' }).finished.then(done, done);
      if (!fast) reveal(500);
      return;
    }
    const k = H.height / S.height;
    const dx = (H.left + H.width / 2) - (S.left + S.width / 2), dy = (H.top + H.height / 2) - (S.top + S.height / 2);
    el.querySelector('.op-bg').animate([{ opacity: 1 }, { opacity: 0 }], { duration: 520, delay: 80, easing: 'ease-in-out', fill: 'forwards' });
    reveal(620);
    lk.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${k})` }], { duration: 680, easing: 'cubic-bezier(.6,0,.25,1)', fill: 'forwards' }).finished.then(done, done);
  };
  OPENING.leave = leave;
  const skip = () => leave(true);
  el.addEventListener('pointerdown', skip, { once: true });
  window.addEventListener('keydown', skip, { once: true });
  if (reduce) setTimeout(() => leave(false), 700);
}
function startOpening() {
  const el = document.getElementById('opening');
  if (!el || OPENING.started || !OPENING.leave || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  OPENING.started = true;
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!document.getElementById('opening')) return;              // already skipped
    // Centre the knight while the word is hidden: shift it by half the gap plus the word's width.
    const lk = document.getElementById('openingLockup'), word = el.querySelector('.op-word');
    const em = parseFloat(getComputedStyle(lk).fontSize) || 1;
    const shift = (em * .36 + word.getBoundingClientRect().width) / 2 / em;
    if (shift > 0 && shift < 8) lk.style.setProperty('--op-shift', shift.toFixed(3));
    el.style.animation = 'none';                                      // the script will see it out from here
    const target = document.getElementById('brandLockup');
    if (target) { target.style.animation = 'none'; target.style.opacity = '0'; }
    el.classList.add('go');
    const anim = word.getAnimations ? word.getAnimations()[0] : null;
    if (anim && anim.finished) anim.finished.then(() => setTimeout(() => OPENING.leave(false), 220), () => OPENING.leave(false));
    else setTimeout(() => OPENING.leave(false), 2000);
  }));
}
