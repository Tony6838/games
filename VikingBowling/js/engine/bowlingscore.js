// ---------------------------------------------------------------------------
// bowlingscore.js - port of scoring/bowlingscore/bowlingcalculations.cpp
// (Viking Scoring System 4.4, VBS Bowling AB).
//
// Line by line, including the two guards the C++ carries (activePos clamped to
// 21, and pos >= 2 before the "strike in the previous frame" rule), so a corner
// case scores here exactly as it does on a lane. tests/scoring/ runs the same
// generated games through the C++ (compiled from the unmodified source file) and
// through this file and compares every frame total.
//
// pResults is the 21-ball score[] array of GCI_PLAYERSTRUCT (BYTE values).
// ---------------------------------------------------------------------------

// bool IsFirstBall(int slag, const BYTE* score)
export function isFirstBall(slag, score) {
  return !((slag < 19 && (slag % 2) !== 0) ||
    (slag === 20 && score[18] === 10 && score[19] !== 10) ||
    (slag === 19 && score[18] !== 10));
}

// void RecalcScore(const BYTE* pResults, int* pSumArray, int activePos, bool bHideStrikeSequence, bool isCFG)
// Returns the ten frame values (not cumulative), -1 for a frame whose value is not final yet.
export function recalcScore(pResults, activePos = 21, bHideStrikeSequence = true, isCFG = false) {
  const pSumArray = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
  let i;

  // Step 1 - plain sums without any bonus
  for (i = 0; i < 9; i++)
    pSumArray[i] = pResults[i * 2] + pResults[i * 2 + 1];
  // Frame 10 (i is 9 here, as in the C++)
  pSumArray[9] = pResults[i * 2] + pResults[i * 2 + 1] + pResults[i * 2 + 2];

  // Step 2 - spare bonus [no bonus in square 10]
  for (i = 0; i < (isCFG ? 10 : 9); i++) {
    if (pResults[i * 2] + pResults[i * 2 + 1] >= 10 && pResults[i * 2] !== 10) {
      if (isCFG) pSumArray[i] += pResults[i * 2];
      else pSumArray[i] += pResults[(i + 1) * 2];
    }
  }

  // Step 3 - strike bonus [no bonus in square 10]
  for (i = 0; i < (isCFG ? 10 : 9); i++) {
    if (pResults[i * 2] === 10) {
      if (isCFG) pSumArray[i] += 20;
      else {
        pSumArray[i] += pResults[(i + 1) * 2] + pResults[(i + 1) * 2 + 1];
        if (pResults[(i + 1) * 2] === 10 && i !== 8)
          pSumArray[i] += pResults[(i + 2) * 2];
      }
    }
  }

  if (isCFG) return pSumArray;

  // Step 4 - hide everything a future ball can still change
  if (activePos > 21) activePos = 21;
  if (activePos < 2) return pSumArray;

  let pos;
  if (activePos > 18) pos = activePos - 1;
  else if ((activePos % 2 === 0) && (pResults[activePos - 2] === 10)) pos = activePos - 2;
  else pos = activePos - 1;

  // Are we in 10th frame
  if (pos === 20) return pSumArray;
  if (pos === 19 && (pResults[18] + pResults[19]) < 10) return pSumArray;

  if (bHideStrikeSequence) {
    if (isFirstBall(pos, pResults))
      pSumArray[pos >> 1] = -1;

    // If spare, don't display points
    if (!isFirstBall(pos, pResults)) {
      if ((pResults[pos] + pResults[pos - 1]) === 10)
        pSumArray[pos >> 1] = -1;
    }

    // Strike in the previous square and currently on a first ball
    if (isFirstBall(pos, pResults) && pos >= 2 && pos < 19) {
      if (pResults[pos - 2] === 10)
        pSumArray[(pos - 2) >> 1] = -1;
    }
  }
  return pSumArray;
}

// int MaxPossibleScore(const BYTE* pResults, int activePos, bool isCFG, bool tenthEndsOnMark)
export function maxPossibleScore(pResults, activePos, isCFG = false, tenthEndsOnMark = false) {
  if (activePos < 0) activePos = 0;
  if (activePos > 21) activePos = 21;

  const best = new Array(21).fill(0);
  for (let p = 0; p < activePos; p++)
    best[p] = pResults[p] > 10 ? 10 : pResults[p];

  for (let p = activePos; p < 21; p++) {
    if (p < 18) {
      if (p % 2 === 0) best[p] = 10;
      else if (best[p - 1] < 10) best[p] = 10 - best[p - 1];
    } else if (p === 18) {
      best[p] = 10;
    } else if (p === 19) {
      if (best[18] === 10) best[p] = tenthEndsOnMark ? 0 : 10;
      else best[p] = 10 - best[18];
    } else {
      const strike = best[18] === 10;
      const spare = !strike && best[18] + best[19] === 10;
      if (tenthEndsOnMark || !(strike || spare)) best[p] = 0;
      else if (strike && best[19] < 10) best[p] = 10 - best[19];
      else best[p] = 10;
    }
  }

  const sums = recalcScore(best, 21, false, isCFG);
  let total = 0;
  for (let i = 0; i < 10; i++) total += sums[i];
  return total;
}

// The game total as the end of game procedure counts it (CGame::CheckGameFinished:
// RecalcScore(score, sums, 21, true, isCFG) and the ten values summed).
export function gameTotal(score, isCFG = false) {
  const sums = recalcScore(score, 21, true, isCFG);
  let t = 0;
  for (let i = 0; i < 10; i++) t += sums[i];
  return t;
}

// Running totals per frame as a scoring sheet shows them (cumulative, null where
// the frame is not final yet) - CProtocol::GetTotal's loop, stopping at the first -1.
export function runningTotals(score, activeSquare, isCFG = false, hideStrikeSequence = true) {
  const sums = recalcScore(score, activeSquare, hideStrikeSequence, isCFG);
  const out = [];
  let acc = 0;
  let open = false;
  const framesBowled = Math.min(10, Math.ceil(activeSquare / 2));
  for (let i = 0; i < 10; i++) {
    if (open || i >= framesBowled || sums[i] === -1) { open = true; out.push(null); continue; }
    acc += sums[i];
    out.push(acc);
  }
  return out;
}
