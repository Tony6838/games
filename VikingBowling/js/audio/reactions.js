// ---------------------------------------------------------------------------
// reactions.js - what the people in the hall do after a ball: which reaction, how big, and
// which sounds it is made of. Pure functions (no audio, no DOM), so node can test them
// (tests/audio_test.mjs) against the game's own engine.
//
// The people clap and whistle after a strike or a spare; they have no voices, so a bad ball (a
// gutter, a split, a pin left) gets no reaction. The human player's friends react in full; a
// machine player's ball gets a quieter, smaller reaction, so the human's stand out. Sizes: a
// strike 1, a double 2, a turkey 3, four or more in a row 4, a perfect game 5 (a RedPin strike
// counts as at least a turkey).
// ---------------------------------------------------------------------------

// The exciters of OpenPlay (GCI.EXCITER_* in js/engine/openplay.js)
export const EX = { NONE: 0, STRIKE: 1, SPARE: 2, ZERO: 3, SPLIT: 4, FAUL: 5, PIN: 6, SPMAKE: 7, OPEN: 8 };

export function countPins(mask) { let n = 0; for (let i = 0; i < 10; i++) if (mask & (1 << i)) n++; return n; }

// e: { exciter, inARow, redPin, practice, kinds: Set of event types seen for this ball ('strike', 'spare') }
// -> { kind, family, size }  kind: strike, spare, splitSpare, none
export function classify(e) {
  const none = { kind: 'none', family: 'none', size: 0 };
  if (!e || e.practice) return none;
  const k = e.kinds || new Set();
  let ex = e.exciter;
  if (ex == null) ex = k.has('strike') ? EX.STRIKE : k.has('spare') ? EX.SPARE : EX.NONE;
  if (ex === EX.STRIKE) {
    let n = Math.max(1, e.inARow | 0);
    if (e.redPin) n = Math.max(n, 3);
    return { kind: 'strike', family: 'strike', size: n >= 12 ? 5 : Math.min(4, n), n };
  }
  if (ex === EX.SPMAKE) return { kind: 'splitSpare', family: 'spare', size: 2 };
  if (ex === EX.SPARE) return { kind: 'spare', family: 'spare', size: 1 };
  return none;
}

// The reaction the hall can already tell while the pins are still settling: every pin down
// (a strike, or a spare - a converted split if the leave was a split).
//   ball: { before, streak (strikes in a row before this ball) }
export function earlyClassify(ball, what, isSplit) {
  if (what === 'allDown') {
    if (ball.before === 0x3FF) {
      const n = (ball.streak | 0) + 1;
      return { kind: 'strike', family: 'strike', size: n >= 12 ? 5 : Math.min(4, n), n, early: true };
    }
    return isSplit ? { kind: 'splitSpare', family: 'spare', size: 2, early: true } : { kind: 'spare', family: 'spare', size: 1, early: true };
  }
  return { kind: 'none', family: 'none', size: 0 };
}

// The strikes in a row a bowler has before the ball about to be bowled, from the score sheet
// (GCI_PLAYERSTRUCT: score[21] pins per ball, activeSquare the next ball)
export function strikeStreak(p) {
  if (!p || !p.score) return 0;
  const s = p.score, a = Math.min(21, p.activeSquare | 0);
  const balls = [];
  for (let sq = 0; sq < a; sq++) {
    if (sq < 18) {
      if (sq % 2 === 0 && s[sq] === 10) { balls.push(true); sq++; continue; }
      balls.push(false);
    } else if (sq === 18) balls.push(s[18] === 10);
    else if (sq === 19) balls.push(s[18] === 10 && s[19] === 10);
    else balls.push(s[20] === 10 && ((s[18] === 10 && s[19] === 10) || (s[18] !== 10 && s[18] + s[19] === 10)));
  }
  let n = 0;
  for (let i = balls.length - 1; i >= 0 && balls[i]; i--) n++;
  return n;
}

// The sounds of a reaction: [{ bank, gain, delay }]. Banks: the applause (clapS, clapM, clapL,
// clapXL) and the whistle; no voices.
export function plan(r, human) {
  const L = [];
  const add = (bank, gain, delay = 0) => L.push({ bank, gain, delay });
  if (!r || r.kind === 'none') return L;
  if (human) {
    switch (r.kind) {
      case 'strike':
        if (r.size >= 5) { add('clapXL', 1.0, 0.25); add('whistle', 0.8, 0.5); add('whistle', 0.7, 1.4); }
        else if (r.size === 4) { add('clapL', 1.0, 0.2); add('whistle', 0.75, 0.45); }
        else if (r.size === 3) { add('clapL', 0.9, 0.2); add('whistle', 0.7, 0.4); }
        else if (r.size === 2) add('clapM', 0.85, 0.2);
        else add('clapM', 0.7, 0.2);
        break;
      case 'splitSpare': add('clapM', 0.9, 0.35); add('whistle', 0.55, 0.6); break;
      case 'spare': add('clapS', 0.7, 0.15); break;
    }
  } else {
    // a machine player: the group claps along, but quieter and smaller
    switch (r.kind) {
      case 'strike':
        if (r.size >= 5) add('clapL', 0.6, 0.2);
        else if (r.size >= 3) add('clapM', 0.4, 0.2);
        else add('clapS', 0.4, 0.15);
        break;
      case 'splitSpare': add('clapS', 0.4, 0.15); break;
      case 'spare': add('clapS', 0.3, 0.15); break;
    }
  }
  return L;
}

// The layers of a bigger reaction that an earlier, smaller one did not already play
export function upgrade(earlier, later, human) {
  if (!earlier || !later || later.family !== earlier.family || later.size <= earlier.size) return [];
  const had = new Set(plan(earlier, human).map((l) => l.bank));
  return plan(later, human).filter((l) => !had.has(l.bank));
}

// How strongly the lights over the lane flash, and how many pulses: [strength 0..1, pulses]
export function flashFor(r, human) {
  if (!human || !r) return null;
  if (r.kind === 'strike') return [[0.45, 1], [0.6, 1], [0.75, 2], [0.85, 3], [1, 5]][r.size - 1] || [0.45, 1];
  if (r.kind === 'splitSpare') return [0.5, 1];
  if (r.kind === 'spare') return [0.25, 1];
  return null;
}
