// ---------------------------------------------------------------------------
// warmup.js - the warm-up (inspelning) a start can carry: the reception's F2 "Inspelning" for
// open play, VBS-T's own setting for a competition (TOURNAMENT_SHIFT_HEADER_STRUCT practiceMethod /
// practiceAmount, TDF_PRACTICE_*). What OpenPlay does with it is in js/engine/openplay.js
// (practiceInit, scoreBall, testFramesScore, testBallsScore, practiceClockOver/Finish).
// ---------------------------------------------------------------------------
import { GCI } from '../engine/openplay.js';
import { t } from '../i18n.js';

// none, balls per bowler (VBS-T's 2 / 4 Klot and more), frames, minutes
export const WARM_OPTIONS = [
  { id: 'none', method: GCI.PRACTICE_NONE, amount: 0 },
  { id: 'b2', method: GCI.PRACTICE_BALLS, amount: 2 }, { id: 'b4', method: GCI.PRACTICE_BALLS, amount: 4 }, { id: 'b8', method: GCI.PRACTICE_BALLS, amount: 8 },
  { id: 'f1', method: GCI.PRACTICE_FRAMES, amount: 1 }, { id: 'f2', method: GCI.PRACTICE_FRAMES, amount: 2 }, { id: 'f3', method: GCI.PRACTICE_FRAMES, amount: 3 },
  { id: 'm1', method: GCI.PRACTICE_MINUTES, amount: 1 }, { id: 'm2', method: GCI.PRACTICE_MINUTES, amount: 2 }, { id: 'm5', method: GCI.PRACTICE_MINUTES, amount: 5 },
  { id: 'm10', method: GCI.PRACTICE_MINUTES, amount: 10 }
];
export const WARM_IDS = WARM_OPTIONS.map((o) => o.id);
export function warmChoice(id) { return WARM_OPTIONS.find((o) => o.id === id) || WARM_OPTIONS[0]; }
export function warmLabel(method, amount) {
  if (!amount || method === GCI.PRACTICE_NONE) return t('warmNone');
  if (method === GCI.PRACTICE_BALLS) return t('warmBalls', { n: amount });
  if (method === GCI.PRACTICE_FRAMES) return t(amount === 1 ? 'warmFrame' : 'warmFrames', { n: amount });
  return t('warmMinutes', { n: amount });
}
// VBS-T's header (TDF_PRACTICE_*) as CShiftSettings turns it into the lane's practice: 2 and 4
// balls are balls (the shift dialog puts 2 or 4 in practiceAmount), frames and minutes as they are
export function vbstPractice(h) {
  switch (h.practiceMethod) {
    case 1: return { method: GCI.PRACTICE_BALLS, amount: h.practiceAmount || 2 };      // TDF_PRACTICE_2_BALLS
    case 2: return { method: GCI.PRACTICE_BALLS, amount: h.practiceAmount || 4 };      // TDF_PRACTICE_4_BALLS
    case 3: return { method: GCI.PRACTICE_FRAMES, amount: h.practiceAmount };
    case 4: return { method: GCI.PRACTICE_MINUTES, amount: h.practiceAmount };
    case 5: return { method: GCI.PRACTICE_BALLS, amount: h.practiceAmount };
    default: return { method: GCI.PRACTICE_NONE, amount: 0 };
  }
}
