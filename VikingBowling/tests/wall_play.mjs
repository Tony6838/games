// The TV wall, the lane console, the bumpers and the warm-up, played in headless Edge with real
// pointer input (tests/cdp.mjs): node tests/wall_play.mjs <scenario> <w> <h> <touch 0|1> [outDir] [baseUrl] [lang]
//   scenario open:  open play, warm-up 2 balls, the player and one machine player with bumpers; a
//                   practice ball, a ball at the gutter with the bumpers up, End practice on the
//                   console, game balls, a correction in the console's score editor (checked against
//                   the lane file and the TV), a machine player given bumpers in "Ändra spelare"
//   scenario vbst:  Banpoängsmatch 4+4 (4 lanes, lane moves each serie): the TV wall, a ball, the
//                   serie played out, serie 2 on other lanes - the large TV follows the player
//   scenario minutes: open play with a 1 minute warm-up (the TV's clock, the stop picture)
//   scenario layout: an 8-lane competition at the size: the TV wall, a small TV large, another lane's console
//   scenario hint:  the 8-lane competition's first turn with the one-time throw explanation as it comes
//                   (the other scenarios start with it seen); lang picks the language (sv when left out)
// Every scenario ends with the HUD check: its parts inside the screen and apart, every button reachable,
// and the hint toasts (both one-time explanations, in the page's language) clear of every button.
// Prints what it checked and every exception, console error and failed request.
import { openBrowser, sleep } from './cdp.mjs';

const [scenario = 'open', W = '1280', H = '800', touch = '0', outDir = 'screenshots/wall', base = 'http://127.0.0.1:8471/games/VikingBowling/', LANG = ''] = process.argv.slice(2);
const w = +W, h = +H, mobile = touch === '1';
const tag = `${outDir}/${scenario}_${w}x${h}${LANG ? '_' + LANG : ''}`;
const b = await openBrowser({ w, h, mobile });
const checks = [];
const check = (ok, what) => { checks.push((ok ? 'ok   ' : 'FAIL ') + what); return ok; };
const app = (expr) => b.eval(`const a = window.vikingApp; ${expr}`);
async function waitFor(expr, ms = 30000, step = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { const v = await app(expr); if (v && !v.error) return v; await sleep(step); }
  return null;
}
// a real swipe from the ball (where the ball shows on the screen) up the lane
async function throwBall(curve = 0, dx = 0) {
  const p = await app(`if (!a.throwResolve || !a.throwLane) return null; const v = a.throwLane.physics.ball.position.clone ? null : null;
    const THREE = a.scene.camera; const b = a.throwLane.physics.ball.position; const q = { x: b.x, y: b.y, z: b.z };
    const vec = new (a.scene.camera.position.constructor)(q.x, q.y, q.z); vec.project(a.scene.camera);
    return { x: (vec.x + 1) / 2 * innerWidth, y: (1 - vec.y) / 2 * innerHeight };`);
  if (!p) return false;
  const x = Math.max(20, Math.min(w - 20, p.x)), y = Math.max(h * 0.5, Math.min(h - 10, p.y + 10));
  await b.swipe(x, y, x + dx, Math.max(40, y - h * 0.45), 230, 14, curve);
  return true;
}
// the console page up: loaded and showing the lane (its dock out, body.vbsPlaying) - with software
// WebGL at a large size the page can take several seconds to start
async function consoleUp(ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await b.eval(`const d = document.querySelector('#consoleFrame').contentDocument; return !!(d && d.body && d.body.classList.contains('vbsPlaying'))`)) return true;
    await sleep(200);
  }
  return false;
}
async function humanBall(curve = 0, dx = 0) {
  if (!(await waitFor('return !!a.throwResolve', 60000))) return false;
  await sleep(300);
  const ok = await throwBall(curve, dx);
  // until the ball has been scored: the pins at rest and the lane game past the ball
  await sleep(400);
  await waitFor('return a.physics.every((p) => p.state === "done" || p.state === "idle") && !/rullar|rolling/i.test(document.querySelector("#status").textContent)', 20000);
  await sleep(1600);
  return ok;
}
// The hint toast (the gesture hints, the one-time explanations) where it shows now: pointer-events
// none, so the reachability test below passes through it - it must lie clear of every HUD button, the
// status line and the ball speed, inside the window. null when no hint toast shows.
const hintOver = () => b.eval(`const T = document.querySelector('#toast');
  if (!T.classList.contains('show') || !T.classList.contains('hint')) return null;
  const q = T.getBoundingClientRect(), out = [];
  if (q.x < -1 || q.y < -1 || q.right > innerWidth + 1 || q.bottom > innerHeight + 1) out.push('outside the window');
  for (const e of [...document.querySelectorAll('#play .hudBtns button'), document.querySelector('#status'), document.querySelector('#speedo')]) {
    const r = e.getBoundingClientRect();
    if (r.width && r.height && q.x < r.right - 1 && r.x < q.right - 1 && q.y < r.bottom - 1 && r.y < q.bottom - 1) out.push('covers ' + e.id);
  }
  return { out, box: [q.x, q.y, q.width, q.height].map(Math.round).join(','), text: T.textContent.slice(0, 32) };`);

await b.go(base + '?nofs=1&detail=low', 3500);
await b.eval(`localStorage.clear(); ${scenario === 'hint' ? '' : 'localStorage.setItem("vbg.throwHint", "true");'}
  ${LANG ? `localStorage.setItem("vbg.settings", JSON.stringify({ lang: ${JSON.stringify(LANG)} }));` : ''} return 1`);
await b.go(base + '?nofs=1&detail=low', 3500);
check(await b.click('#okBtn'), 'splash OK');
await sleep(700);

if (scenario === 'open' || scenario === 'minutes') {
  // the warm-up chosen in the options (a real select; the change event as a user's choice makes it)
  await app(`const s = document.querySelector('#optWarm'); s.value = ${JSON.stringify(scenario === 'minutes' ? 'm1' : 'b2')}; s.dispatchEvent(new Event('change')); return s.value`);
  await app(`const s = document.querySelector('#optRobots'); s.value = '2'; s.dispatchEvent(new Event('change')); return 1`);
  await app(`const s = document.querySelector('#optSkill'); s.value = 'beginner'; s.dispatchEvent(new Event('change')); return 1`);
  check(await b.click('#menuNext'), 'menu next');
  await sleep(700);
  check(await b.click('#humanBump'), 'the player ticks Bumpers');
  check(await b.click('#robotList input[data-bump="0"]'), 'a machine player gets bumpers');
  await b.shot(tag + '_01_names.png');
  check(await b.click('#startBtn'), 'start');
  await sleep(3000);
  const st = await app(`const e = a.engine, p = e.lanes[0]; return { warm: e.isWarmUp(5), status: p.laneStatus, method: p.practiceMethod, names: p.player.slice(0, p.noPlayers).map(x => x.playerName), up: a.bumpers.isUp(0) }`);
  check(st.warm && st.status === 11, 'the lane is in practice (laneStatus 11): ' + JSON.stringify(st));
  check(st.names[0].endsWith('+C') && st.names[1].endsWith('+C'), 'bumper players carry +C in the lane file');
  check(st.up, 'the bumpers are up for the player');
  await sleep(1200);
  await b.shot(tag + '_02_warmup_tv.png');
  if (scenario === 'minutes') {
    const clock = await app(`return a.engine.practiceSecondsLeft(5)`);
    check(clock > 40 && clock <= 60, 'the warm-up clock runs: ' + clock + ' s left');
    // bowl practice balls until the clock is out and the stop picture shows
    // (the 30 s stop picture shortened to 20 s for the test; a watcher in the page notes it)
    await app(`a.practiceStopMs = 20000; window.__sawStop = false; setInterval(() => { if (a.engine.lanes[0].laneStatus === 12 && a.loadcom.masks.get(5) === 3) window.__sawStop = true; }, 200); return 1`);
    for (let i = 0; i < 12 && (await app('return a.engine.lanes[0].laneStatus')) === 11; i++) { await humanBall(); await sleep(500); }
    const over = await waitFor('return window.__sawStop', 70000, 500);
    check(!!over, 'the stop picture (PracticeOver, maskPicture 3)');
    if (await app('return a.engine.lanes[0].laneStatus === 12')) { await sleep(1200); await b.shot(tag + '_03_stop_picture.png'); }
    const started = await waitFor('return !a.engine.isWarmUp(5)', 20000, 500);
    check(!!started, 'the serie starts after the stop picture');
  } else {
    // a practice ball: not on the sheet
    await humanBall();
    await sleep(800);
    const p1 = await app(`const p = a.engine.lanes[0]; return { score: p.player[0].score.slice(0, 3).join(','), as: p.player[0].activeSquare, left: a.engine.practiceLeft(5).left }`);
    check(p1.as === 0 && p1.left === 5, 'a practice ball is not scored, 5 practice balls left: ' + JSON.stringify(p1));
    // End practice on the console
    check(await b.click('#btnConsole'), 'the console opens');
    await consoleUp();
    await sleep(800);
    await b.shot(tag + '_04_console.png');
    const fp = await b.eval(`const d = document.querySelector('#consoleFrame').contentDocument; const e = d && d.querySelector('#finishPractice'); return e ? getComputedStyle(e).visibility + '/' + (e.offsetParent !== null) : 'none'`);
    check(fp.startsWith('visible'), 'End practice is offered while practising: ' + fp);
    check(await b.click('#finishPractice', '#consoleFrame'), 'End practice pressed');
    await sleep(700);
    check(await b.click('#stopPracticeSubmitbutton', '#consoleFrame'), 'End practice confirmed');
    await sleep(1200);
    const ended = await app(`const p = a.engine.lanes[0]; return { warm: a.engine.isWarmUp(5), status: p.laneStatus, active: p.activePlayer }`);
    check(!ended.warm && ended.status === 2 && ended.active === 0, 'End practice: the serie starts with bowler 1: ' + JSON.stringify(ended));
    check(await b.click('#consoleClose'), 'console closed');
    await sleep(800);
    // game balls: one at the gutter with the bumpers up (it comes back), then normal ones
    await humanBall(0, w * 0.18);
    const g1 = await app(`const p = a.engine.lanes[0].player[0]; return { s: p.score[0], gutter: a.physics[0].inGutter }`);
    check(g1.gutter === false, 'a ball at the gutter with the bumpers up stays out of it: ' + JSON.stringify(g1));
    await b.shot(tag + '_05_after_bumper_ball.png');
    // let the machine players bowl a few balls, the player too
    await app('a.fast = true; return 1');
    for (let i = 0; i < 2; i++) await humanBall();
    await sleep(1500);
    // the console's score editor: the player's first ball corrected to 7 (or 8 if it was 7)
    const before = await app(`const p = a.engine.lanes[0].player[0]; return { s: p.score.slice(), as: p.activeSquare, total: p.totalPoints }`);
    check(await b.click('#btnConsole'), 'the console opens again');
    await consoleUp();
    await sleep(500);
    check(await b.click('#changeScoreButton', '#consoleFrame'), 'Korrigera');
    await sleep(1200);
    // the form opens on the bowler up; the player's own row is chosen in its list (the change a
    // choice in the dropdown makes)
    await b.eval(`const d = document.querySelector('#consoleFrame').contentDocument; const s = d.querySelector('#selectplayerlistforchange'); s.selectedIndex = 0; s.dispatchEvent(new Event('change')); return 1`);
    await sleep(900);
    await b.shot(tag + '_06_correct_form.png');
    // a value the editor allows for the first ball: 0 (or 1 for a 0), 9 for a strike
    const want = before.s[0] === 10 ? 9 : before.s[0] === 0 ? 1 : 0;
    const cell = await b.eval(`const f = document.querySelector('#consoleFrame'); const d = f.contentDocument; const td = d.querySelector('#scorerow').cells[0]; const r = td.getBoundingClientRect(), fr = f.getBoundingClientRect(); return { x: fr.x + r.x + r.width / 2, y: fr.y + r.y + r.height / 2, text: td.textContent }`);
    await b.tap(cell.x, cell.y);
    await sleep(300);
    const btnId = ['zeroButton', 'oneButton', 'twoButton', 'threeButton', 'fourButton', 'fiveButton', 'sixButton', 'sevenButton', 'eightButton', 'nineButton'][want];
    check(await b.click('#' + btnId, '#consoleFrame'), 'a ' + want + ' typed in the first ball');
    await sleep(300);
    await b.shot(tag + '_07_correct_typed.png');
    check(await b.click('#changescoresubmitbutton', '#consoleFrame'), 'Spara');
    await sleep(1500);
    const after = await app(`const p = a.engine.lanes[0].player[0]; return { s: p.score.slice(), as: p.activeSquare, st0: p.status[0] }`);
    check(after.s[0] === want && after.as === before.as, `the correction is in the lane: ball 1 ${before.s[0]} -> ${after.s[0]} (activeSquare ${before.as} -> ${after.as})`);
    check((after.st0 & 2) === 2, 'the corrected ball carries GCI_CHANGED');
    // "Ändra spelare": the second machine player gets bumpers
    check(await b.click('#changePlayerButton', '#consoleFrame'), 'Ändra spelare');
    await sleep(1200);
    await b.shot(tag + '_08_change_players.png');
    const toggled = await b.eval(`const d = document.querySelector('#consoleFrame').contentDocument; const boxes = d.querySelectorAll('#playerNameList .checkboxBump'); return boxes.length`);
    check(toggled === 3, 'three bowlers listed with their Bumpers box: ' + toggled);
    const box = await b.eval(`const f = document.querySelector('#consoleFrame'); const d = f.contentDocument; const e = d.querySelectorAll('#playerNameList .checkboxBump')[2]; const r = (e.closest('label') || e).getBoundingClientRect(), fr = f.getBoundingClientRect(); return { x: fr.x + r.x + r.width / 2, y: fr.y + r.y + r.height / 2, on: e.checked }`);
    await b.tap(box.x, box.y);
    await sleep(300);
    check(await b.click('#changePlayerInfoSubmitButton', '#consoleFrame'), 'Spara (players)');
    await sleep(1200);
    const names = await app(`const p = a.engine.lanes[0]; return p.player.slice(0, p.noPlayers).map(x => x.playerName)`);
    check(names[2].endsWith('+C'), 'the third bowler now carries the bumper mark: ' + names.join(' / '));
    check(await b.click('#consoleClose'), 'console closed');
    await sleep(600);
    await b.shot(tag + '_09_after_console.png');
    // the TV shows the corrected ball (the lane file the TV page draws has it)
    const tv = await b.eval(`const f = document.querySelector('#tv1'); const j = f.contentWindow.vbsSheet && f.contentWindow.vbsSheet.laneJson && f.contentWindow.vbsSheet.laneJson(); return j ? j.players['player 1'].score['1'] : null`);
    check(tv === String(want), 'the lane TV draws the corrected ball: ' + tv);
    // play on a little more: bumpers follow the bowler up
    for (let i = 0; i < 2; i++) await humanBall();
    await b.shot(tag + '_10_play.png');
  }
}

if (scenario === 'vbst') {
  await b.click('[data-tab="vbst"]');
  await sleep(600);
  await app(`a.settings.format = 'banp44'; a.save(); a.renderFormats(); return 1`);
  await sleep(400);
  check(await b.click('#menuNext'), 'menu next');
  await sleep(1200);
  check(await b.click('#startBtn'), 'start the competition');
  await sleep(4500);
  const wall = await app(`return { strip: [...document.querySelectorAll('#tvStrip .tvTile')].filter((t) => !t.hidden).length, lanes: [...a.tvWall.views.keys()], human: a.tvLanes, idx: [...a.tvWall.views.values()].map(v => v.index) }`);
  check(wall.lanes.length === 4 && wall.strip === 3, 'the TV wall: 4 lanes, 3 small TVs: ' + JSON.stringify(wall));
  await b.shot(tag + '_01_wall.png');
  await humanBall();
  await sleep(4000);
  await b.shot(tag + '_02_wall_play.png');
  const paced = await app(`const s = a.vbst; return s.paced.map(g => g.next + '/' + g.balls.length)`);
  check(paced.length > 0, 'the other lanes are bowled at the player\'s pace: ' + paced.join(' '));
  // the rest of the serie at once (the automated runs' instant mode), then serie 2 on other lanes
  const lanes1 = wall.human.join('-');
  await app('a.instant = true; if (a.throwResolve) a.testThrow({ speed: 7, angle: 0, side: 0 }); return 1');
  const stand = await waitFor('return a.screen === "standings"', 90000, 500);
  check(!!stand, 'serie 1 played out');
  await b.shot(tag + '_03_standings.png');
  await app('a.instant = false; return 1');
  check(await b.click('#standNext'), 'next serie');
  await sleep(4500);
  const wall2 = await app(`return { human: a.tvLanes, strip: [...document.querySelectorAll('#tvStrip .tvTile')].filter((t) => !t.hidden).map((t) => t.dataset.lane), active: a.activeLane && a.activeLane.number }`);
  check(wall2.human.join('-') !== lanes1, `the large TV follows the player to other lanes: ${lanes1} -> ${wall2.human.join('-')}`);
  await b.shot(tag + '_04_serie2_wall.png');
  await humanBall();
  await sleep(2500);
  await b.shot(tag + '_05_serie2_play.png');
}

// the layout at a size: an 8-lane competition (the most small TVs), a ball, a small TV shown large,
// the console of another lane
if (scenario === 'layout') {
  await b.click('[data-tab="vbst"]');
  await sleep(600);
  await app(`a.settings.format = 'banp88x8'; a.settings.warmV = 'b2'; a.save(); a.renderFormats(); return 1`);
  await sleep(400);
  check(await b.click('#menuNext'), 'menu next');
  await sleep(1200);
  check(await b.click('#startBtn'), 'start the competition');
  await sleep(5000);
  const wall = await app(`return { strip: [...document.querySelectorAll('#tvStrip .tvTile')].filter((t) => !t.hidden).length, lanes: [...a.tvWall.views.keys()], warm: a.engine.isWarmUp(a.tvLanes[0]) }`);
  check(wall.lanes.length === 8 && wall.strip === 7, 'the TV wall: 8 lanes, 7 small TVs: ' + JSON.stringify(wall));
  check(wall.warm, 'the competition starts with its warm-up (2 balls chosen)');
  await b.shot(tag + '_01_wall.png');
  await humanBall();
  await sleep(2500);
  await b.shot(tag + '_02_wall_ball.png');
  // a small TV large, then back (the last visible one: on a phone the strip scrolls to it)
  const last = await app(`const t = [...document.querySelectorAll('#tvStrip .tvTile')].filter((x) => !x.hidden).pop(); t.scrollIntoView({ inline: 'nearest', block: 'nearest' }); return t.dataset.lane`);
  await sleep(300);
  check(await b.click(`#tvStrip .tvTile[data-lane="${last}"]`), 'a small TV tapped');
  await sleep(500);
  const big = await app(`const t = document.querySelector('#tvStrip .tvTile.big'); if (!t) return null; const r = t.getBoundingClientRect(); return { w: r.width, h: r.height, x: r.x, y: r.y }`);
  check(!!big && big.x >= -1 && big.y >= -1 && big.x + big.w <= w + 1 && big.y + big.h <= h + 1, 'it is shown large inside the screen: ' + JSON.stringify(big));
  await b.shot(tag + '_03_small_tv_large.png');
  await b.click(`#tvStrip .tvTile[data-lane="${last}"]`);
  await sleep(400);
  // the console, on another lane's tab
  check(await b.click('#btnConsole'), 'the console opens');
  await sleep(2200);
  // the tabs scroll sideways on a narrow screen: the lane's tab brought into view, then tapped
  await app(`document.querySelector('#consoleTabs [data-lane="${last}"]').scrollIntoView({ inline: 'nearest', block: 'nearest' }); return 1`);
  await sleep(300);
  await b.click(`#consoleTabs [data-lane="${last}"]`);
  await sleep(2500);
  const con = await b.eval(`const f = document.querySelector('#consoleFrame'); const d = f.contentDocument; const dock = d && d.querySelector('.lanebuttons'); const r = dock ? dock.getBoundingClientRect() : null; const fr = f.getBoundingClientRect();
    return { lane: d && d.querySelector('.laneNo') && d.querySelector('.laneNo').textContent, dockInside: r ? (r.bottom <= fr.height + 1 && r.right <= fr.width + 1) : null, fw: fr.width, fh: fr.height }`);
  check(con && con.lane === String(last) && con.dockInside !== false, 'the console of lane ' + last + ': ' + JSON.stringify(con));
  await b.shot(tag + '_04_console_other_lane.png');
  check(await b.click('#changeScoreButton', '#consoleFrame'), 'Korrigera on that lane');
  await sleep(1200);
  await b.shot(tag + '_05_console_correct.png');
  await b.click('#cancelButton', '#consoleFrame');
  await sleep(300);
  await b.click('#consoleClose');
  await sleep(600);
}

// the one-time throw explanation at the player's first turn, over the 8-lane competition's HUD (the
// most small TVs), with the swipe
if (scenario === 'hint') {
  await app(`const t = document.querySelector('#optThrow'); t.value = 'swipe'; t.dispatchEvent(new Event('change')); return 1`);
  await b.click('[data-tab="vbst"]');
  await sleep(600);
  await app(`a.settings.format = 'banp88x8'; a.settings.warmV = 'none'; a.save(); a.renderFormats(); return 1`);
  await sleep(400);
  check(await b.click('#menuNext'), 'menu next');
  await sleep(1200);
  check(await b.click('#startBtn'), 'start the competition');
  const up = await waitFor(`return !!a.throwResolve && document.querySelector('#toast').classList.contains('show') && document.querySelector('#toast').classList.contains('hint')`, 60000, 150);
  check(!!up, 'the one-time throw explanation shows at the player\'s first turn');
  await sleep(500);
  await b.shot(tag + '_01_throw_hint.png');
  const h = await hintOver();
  check(!!h && h.out.length === 0, `the throw explanation keeps clear of the HUD's buttons, the status line and the ball speed (${h ? h.box + ' "' + h.text + '…"' : 'not shown'})${h && h.out.length ? ': ' + h.out.join(', ') : ''}`);
}

// the TV animations: what the game asked the TV to play (LC_PLAY_ANIMATION) and what the TakTV page
// really put up (its #videoFx), recorded by an observer in the page since the start
if (scenario === 'open' || scenario === 'anim') {
  if (scenario === 'anim') {
    await app(`const s = document.querySelector('#optSkill'); s.value = 'beginner'; s.dispatchEvent(new Event('change')); return 1`);
    await b.click('#menuNext'); await sleep(700);
    await b.click('#startBtn'); await sleep(3500);
  }
  await app(`window.__videos = window.__videos || []; const f = document.querySelector('#tv1'); const d = f.contentDocument;
    new f.contentWindow.MutationObserver(() => { const v = d.getElementById('videoFx'); if (v && v.getAttribute('src') && window.__videos[window.__videos.length - 1] !== v.getAttribute('src')) window.__videos.push(v.getAttribute('src')); })
      .observe(d.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] }); return 1`);
  // machine players bowl (fast), the player too, until the TV has played something
  await app('a.fast = true; return 1');
  for (let i = 0; i < 6 && !(await app('return (window.__videos || []).length')); i++) await humanBall();
  // an animation asked for plays when the TV page gets to it (later under load, and one waits for the
  // one before it): waited for, up to 20 s, instead of a fixed pause
  await waitFor('return (window.__videos || []).length > 0', 20000, 300);
  await sleep(500);
  const anim = await app(`return { asked: (a.loadcom.animLog || []).map((x) => x.media), played: window.__videos || [] }`);
  check(anim.played.length > 0 && anim.played.every((s) => /TV\/media\//i.test(s)), 'the lane TV plays its animations: asked ' + anim.asked.join(', ') + ' / played ' + anim.played.map((s) => s.split('/').pop()).join(', '));
  await b.shot(tag + '_11_after_anims.png');
}

// layout: the HUD's parts inside the screen and not on top of each other
const lay = await b.eval(`const r = (s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.offsetParent && getComputedStyle(e).position !== 'fixed') return null; const q = e.getBoundingClientRect(); return q.width && q.height ? { x: q.x, y: q.y, r: q.right, b: q.bottom } : null; };
  const parts = { tv: r('#tvBox'), strip: r('#tvStrip'), btns: r('.hudBtns'), status: r('#status') };
  const out = []; const names = Object.keys(parts);
  for (const n of names) { const p = parts[n]; if (p && (p.x < -1 || p.y < -1 || p.r > innerWidth + 1 || p.b > innerHeight + 1)) out.push(n + ' outside'); }
  // (the strip of small TVs may reach the button column on a short upright screen, 375 x 548 or 390 x 664:
  // the buttons draw above it by design, and the check below proves nothing covers them)
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) { const A = parts[names[i]], B = parts[names[j]]; if (names[i] === 'strip' && names[j] === 'btns') continue; if (A && B && A.x < B.r - 1 && B.x < A.r - 1 && A.y < B.b - 1 && B.y < A.b - 1) out.push(names[i] + ' overlaps ' + names[j]); }
  return { out, parts };`);
check(lay && lay.out && lay.out.length === 0, 'HUD layout: ' + (lay && lay.out ? (lay.out.join(', ') || 'nothing cut off or overlapping') : JSON.stringify(lay)));
// the console button labelled with the console's own word (a bare screen icon was not recognised as
// the lane console), inside the screen, and every HUD button reachable: nothing on top of it at its
// centre and corners (the small TVs once covered the top buttons on a short upright screen; the
// hints have pointer-events: none, so elementFromPoint passes through them as a tap does)
const hud = await b.eval(`if (!document.querySelector('#play').classList.contains('active')) return null;
  const out = [];
  for (const e of document.querySelectorAll('.hudBtns button')) {
    const q = e.getBoundingClientRect();
    if (q.x < -1 || q.y < -1 || q.right > innerWidth + 1 || q.bottom > innerHeight + 1) out.push(e.id + ' outside');
    const pts = [[q.x + q.width / 2, q.y + q.height / 2], [q.x + 4, q.y + 4], [q.right - 4, q.y + 4], [q.x + 4, q.bottom - 4], [q.right - 4, q.bottom - 4]];
    const by = pts.map(([x, y]) => document.elementFromPoint(Math.max(0, Math.min(innerWidth - 1, x)), Math.max(0, Math.min(innerHeight - 1, y)))).filter((t) => !t || (t !== e && !e.contains(t)));
    if (by.length) out.push(e.id + ' covered by ' + [...new Set(by.map((t) => t ? (t.id || String(t.className).split(' ')[0] || t.tagName) : 'nothing'))].join('/'));
  }
  const l = document.querySelector('#btnConsole .conLabel');
  return { out, label: l ? l.textContent : '', w: Math.round(document.querySelector('#btnConsole').getBoundingClientRect().width) };`);
if (hud) check(hud.label.length > 0 && hud.out.length === 0, `the HUD's buttons reachable, the console button labelled "${hud.label}" (${hud.w} px wide): ` + (hud.out.join(', ') || 'none cut off or covered'));
// the hint toasts over this HUD: the two one-time explanations (the longest hints), in the page's
// language, with a ball speed up - each clear of every button, the status line and the ball speed
// (a hint toast once covered the console button's label on an upright phone)
if (hud) {
  await app(`if (!document.querySelector('#speedo').textContent) a.speedo(18.4); return 1`);
  for (const key of ['throwHint', 'bumpHint']) {
    await b.eval(`const { t } = await import(new URL('js/i18n.js', location.href).href); window.vikingApp.toast(t(${JSON.stringify(key)}), 4000, 'hint'); return 1`);
    await sleep(400);
    const h = await hintOver();
    await b.shot(`${tag}_hint_${key}.png`);
    check(!!h && h.out.length === 0, `the ${key} toast keeps clear of the HUD's buttons, the status line and the ball speed (${h ? h.box + ' "' + h.text + '…"' : 'not shown'})${h && h.out.length ? ': ' + h.out.join(', ') : ''}`);
  }
}

for (const d of b.log.filter((l) => /^DIALOG/.test(l))) console.log('  ' + d);
const errors = b.log.filter((l) => /EXCEPTION|ERROR/.test(l));
const http = b.log.filter((l) => /HTTP|NETFAIL/.test(l));
console.log(`== ${scenario} ${w}x${h}${mobile ? ' touch' : ''}`);
console.log(checks.join('\n'));
console.log(`exceptions/errors: ${errors.length}`); for (const e of errors) console.log('  ' + e);
console.log(`failed requests: ${http.length}`); for (const e of [...new Set(http)]) console.log('  ' + e);
await b.close();
process.exit(checks.some((c) => c.startsWith('FAIL')) || errors.length ? 1 : 0);
