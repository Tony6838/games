// ---------------------------------------------------------------------------
// onscoring.js - the VBS-T panel on the lane TV (OnScoring), as OpenPlay feeds it.
//
// A competition's OnScoring template (Reception/vbsTournaments/OnScoring/<name>) holds
// [JOBS] - Pari (team sums and differences over some lanes), TeamPoints and ShowPari -
// and [textN] sections the layout (OnScoringXml/<name>.xml) draws as #VBST_JOB_textN#.
// OpenPlay's MakeVBSJobs writes GameCtrl\VBST_<league>.ini with each job's value; this
// file does the same from the game's competition state, and tv-standin.js answers the
// lane TV's request for that file with it. A game still being bowled counts with its
// "pari" projection (CGame::GetEliteMax100to220Score, Slave/OPENPLAY/Calc.cpp).
// ---------------------------------------------------------------------------
import { recalcScore, maxPossibleScore } from '../engine/bowlingscore.js';
import { parseIni } from './format.js';

const latin1 = new TextDecoder('windows-1252');

// CGame::GetEliteMax100to220Score: the balls so far, every later frame scored frameScore
export function pariScore(activeSquare, pScore, frameScore) {
  if (frameScore >= 30) return maxPossibleScore(pScore, activeSquare);
  const t = new Array(30).fill(0);
  activeSquare = Math.max(0, Math.min(21, activeSquare));
  frameScore = Math.max(0, Math.min(30, frameScore));
  let firstStrike, secondStrike, bonusesPerFrame;
  if (frameScore > 19) { firstStrike = 9; secondStrike = 1; bonusesPerFrame = frameScore - 19; }
  else if (frameScore >= 10) { firstStrike = frameScore - 10; secondStrike = 10 - firstStrike; bonusesPerFrame = 0; }
  else { firstStrike = Math.floor(frameScore / 2); secondStrike = Math.floor(frameScore / 2) + (frameScore % 2); bonusesPerFrame = 0; }
  for (let i = 0; i < 21; i++) t[i] = (i % 2 === 0) ? firstStrike : secondStrike;
  for (let i = 0; i < activeSquare; i++) t[i] = pScore[i];
  if (activeSquare < 18) {
    if (frameScore > 9 && activeSquare % 2 === 1) { t[activeSquare] = 10 - t[activeSquare - 1]; activeSquare++; }
  } else if (activeSquare === 19) {
    if (t[18] === 10) { t[19] = firstStrike; activeSquare++; t[20] = secondStrike; }
    else { if (frameScore > 10) t[19] = 10 - t[18]; activeSquare++; t[20] = firstStrike; }
  } else if (activeSquare >= 20) {
    if (t[activeSquare - 1] === 10) t[activeSquare] = firstStrike;
    else if (t[activeSquare - 2] + t[activeSquare - 1] === 10) t[activeSquare] = firstStrike;
    else if (t[activeSquare - 2] + t[activeSquare - 1] < 10) t[activeSquare] = 0;
  }
  const sums = recalcScore(t.slice(0, 21), 21, true, false);
  let score = 0;
  for (let j = 0; j < 10; j++) { if (sums[j] === -1) break; score += sums[j]; }
  const framesLeft = 10 - Math.floor((activeSquare + 1) / 2);
  return score + bonusesPerFrame * (framesLeft > 0 ? framesLeft : 0);
}

export async function loadOnScoring(name, { teams, startLane = 1, lanesPerBox = 2, fhd = true }) {
  if (!name) return null;
  const r = await fetch('Reception/vbsTournaments/OnScoring/' + encodeURIComponent(name));
  if (!r.ok) return null;
  let text = latin1.decode(new Uint8Array(await r.arrayBuffer()));
  const swapsText = text;
  const cut = text.indexOf('#CLIPHERE#');
  if (cut >= 0) text = text.substring(0, cut);
  // the operator's answers to [SWAPS]: the team names in order, then the defaults
  const swaps = {};
  const sw = parseIni(swapsText).swaps || {};
  let teamNo = 0;
  for (let i = 1; sw['swap' + i + 'text'] !== undefined; i++) {
    const key = sw['swap' + i + 'text'];
    swaps[key] = /HOME|AWAY|TEAM|LAG/i.test(key) && teams[teamNo] !== undefined ? teams[teamNo++] : (sw['swap' + i + 'default'] || '');
  }
  if (teams[0] !== undefined) swaps['#VAL_HOME#'] = swaps['#VAL_HOME#'] || teams[0];
  if (teams[1] !== undefined) swaps['#VAL_AWAY#'] = swaps['#VAL_AWAY#'] || teams[1];
  // the lane boxes: #VAL_12# = "start,start+1" ... (one lane each for a 4+4 match), #VAL_n# = lane n
  for (let k = 0; k < 4; k++) {
    const key = '#VAL_' + (2 * k + 1) + (2 * k + 2) + '#';
    swaps[key] = lanesPerBox === 1 ? String(startLane + k) : (startLane + 2 * k) + ',' + (startLane + 2 * k + 1);
  }
  for (let n = 1; n <= 16; n++) swaps['#VAL_' + n + '#'] = String(startLane + n - 1);
  for (const [k, v] of Object.entries(swaps)) text = text.split(k).join(v);
  const ini = parseIni(text);
  const jobs = [];
  const J = ini.jobs || {};
  for (let i = 1; J['job' + i + 'mode'] !== undefined; i++) {
    const plus = [], minus = [], outs = [];
    for (let k = 1; J['job' + i + 'plus' + k] !== undefined; k++) plus.push(J['job' + i + 'plus' + k]);
    for (let k = 1; J['job' + i + 'minus' + k] !== undefined; k++) minus.push(J['job' + i + 'minus' + k]);
    for (let k = 1; J['job' + i + 'text' + k] !== undefined; k++) outs.push(J['job' + i + 'text' + k].toLowerCase());
    jobs.push({ mode: J['job' + i + 'mode'], where: J['job' + i + 'where'] || 'AllLanes', when: J['job' + i + 'when'] || 'Latest',
      what: J['job' + i + 'what'] || 'TotGame', plus, minus, outs });
  }
  const texts = {};
  for (const [sec, vals] of Object.entries(ini)) if (/^text\d+$/.test(sec)) texts[sec] = vals.text !== undefined ? vals.text : '';
  // the layout, full HD for a 1920-wide protocol when the theme has one
  const base = 'Reception/vbsTournaments/OnScoringXml/' + name;
  let layout = base + '.xml';
  if (fhd) { try { const h = await fetch(base + '_FHD.xml', { method: 'HEAD' }); if (h.ok) layout = base + '_FHD.xml'; } catch (e) { /* keep 640 */ } }
  return { name, jobs, texts, layout };
}

// The values file: [textN] text=<value> for every job output, the static texts as they are
// live(row) -> { score, activeSquare, finished } for the serie being bowled (or null)
export function onScoringIni(os, comp, s, live) {
  const out = Object.assign({}, os.texts);
  const pari = comp.h.pari;
  const hcpOf = (r) => comp.hcpOf(r);
  const proj = (r) => {
    const l = live(r);
    if (!l || l.finished) return r.played[s] ? r.games[s] : 0;
    if (pari === 0) {
      const sums = recalcScore(l.score, l.activeSquare, true, false);
      let t = 0;
      for (let i = 0; i < 10; i++) { if (sums[i] === -1) break; t += sums[i]; }
      return t;
    }
    return pariScore(l.activeSquare, l.score, pari);
  };
  const valueOf = (r, what) => {
    const w = what.toLowerCase();
    const g = proj(r);
    let prev = 0, prevScratch = 0;
    for (let k = 0; k < s; k++) if (r.lanes[k] > 0) { prev += r.games[k] + hcpOf(r) + r.bonuses[k]; prevScratch += r.games[k]; }
    if (w === 'totgame') return g + hcpOf(r);
    if (w === 'totall') return prev + g + hcpOf(r);
    if (w === 'scrathgame' || w === 'scratchgame') return g;
    if (w === 'scratchall') return prevScratch + g;
    if (w === 'scrath4game' || w === 'scratch4game') { let v = g; for (let k = s - 4; k >= 0; k -= 4) v += r.games[k]; return v; }
    return g + hcpOf(r);
  };
  for (const job of os.jobs) {
    let v = 0;
    const mode = job.mode.toLowerCase();
    if (mode === 'showpari') v = pari * 10;
    else if (mode === 'teampoints') {
      for (const name of job.plus) for (const r of comp.rows) if (r.team === name) v += r.teamPoints.reduce((a, b) => a + b, 0);
      v = Math.round(v + 1e-9);
    } else if (mode === 'pari' || mode === 'calculated') {
      const where = job.where.toLowerCase() === 'alllanes' ? null : new Set(job.where.split(/[^0-9]+/).filter(Boolean).map(Number));
      const add = (names, sign) => {
        for (const name of names) for (const r of comp.rows) {
          if (r.team !== name || !r.lanes[s]) continue;
          if (where && !where.has(r.lanes[s])) continue;
          v += sign * valueOf(r, job.what);
        }
      };
      add(job.plus, 1); add(job.minus, -1);
      v = Math.round(v);
    }
    for (const o of job.outs) out[o] = String(v);
  }
  let ini = '';
  for (const [k, v] of Object.entries(out)) ini += '[' + k + ']\r\ntext=' + v + '\r\n\r\n';
  return ini;
}
