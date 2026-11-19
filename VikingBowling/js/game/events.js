// ---------------------------------------------------------------------------
// events.js - one small emitter for the game's events, shared by every part of the game
// (the sound in js/audio, the lane TVs, the bumpers, the warm-up).
//
//   import { gameEvents } from './game/events.js';
//   const off = gameEvents.on('strike', (e) => { ... });   // off() unsubscribes
//   gameEvents.on('*', (e) => { ... });                      // every event; e.type says which
//
// Every event is one object { type, lane, ... }. The events and their fields:
//   ball           { lane, player, human, firstBall, pins, standing, exciter, practice }  after every scored or practice ball
//   strike         { lane, player, human, inARow, redPin }      a strike (inARow 2 = double, 3 = turkey ...)
//   spare          { lane, player, human }
//   split          { lane, player, human, standing }
//   gutter         { lane, player, human, practice }           a ball that took no pin (a gutter ball or a miss)
//   miss           { lane, player, human }                     a second ball that took no new pin
//   practiceStart  { lane, mode, balls, minutes }              the warm-up (inspelning) begins on a lane
//   practiceEnd    { lane, reason }                            it ends (reason 'done' | 'console' | 'quit')
//   bumpersUp      { lane, player }                            the bumpers rise for a bumper player's turn
//   bumpersDown    { lane, player }                            they lower for a player without bumpers
//   gameStart      { lanes }  /  gameEnd { lanes }
//   correction     { lane, player, frame }                     a score corrected on the lane console
//   throwRelease   { human, input, speed, angle, side, x0, z0 } the player let go of the ball (input 'swipe';
//                                                              sim3d/input.js), before it is carried up and rolled
// A listener that throws is logged and never stops the game or the other listeners.
// ---------------------------------------------------------------------------
const listeners = new Map();

export const gameEvents = {
  on(type, fn) {
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(fn);
    return () => this.off(type, fn);
  },
  once(type, fn) {
    const off = this.on(type, (e) => { off(); fn(e); });
    return off;
  },
  off(type, fn) { const s = listeners.get(type); if (s) s.delete(fn); },
  emit(type, detail = {}) {
    const e = Object.assign({ type }, detail);
    for (const key of [type, '*']) {
      const s = listeners.get(key);
      if (!s) continue;
      for (const fn of [...s]) {
        try { fn(e); } catch (err) { console.error('gameEvents listener for', type, err); }
      }
    }
    return e;
  }
};

if (typeof window !== 'undefined') window.vikingEvents = gameEvents;   // for the automated runs
