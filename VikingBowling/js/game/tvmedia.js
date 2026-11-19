// ---------------------------------------------------------------------------
// tvmedia.js - the lane TV's animations, chosen as OpenPlay chooses them and handed to the TV as
// LoadCom hands them over (LC_PLAY_ANIMATION -> the payload's one-shot "animation", which TakTV
// plays full screen over the sheet: vbsPlayMedia(ANIMATION_PATH + animation)).
//
// Ported from Slave/OPENPLAY: CGame::RenderScreen2 (an exciter other than NONE, no RedPin strike
// just played, the bowler before ball 19 or a strike in a row in the tenth, rand() % 100 <
// v3GfxPercentAnims), CGame::MyCGamePlayAnim (the web half: LC_PLAY_ANIMATION with the file's
// name under web\screen\TV\media) and CMultimedia::GetRandomMedia (the exciter's action -
// STRIKEA, STRIKE2..11, 300, SPARE, MISS, SPLIT, FOUL, PIN1..9, SPMAKE, OPEN - and the hall's list
// of actions to play, WebOpenplayActions / WebVbsTActions). A file's actions are in the .ini
// beside it, as shared/graphics/prio.cpp reads them.
// A browser cannot list a folder, so the files the game ships are named here; the actions come
// from their .ini files ([main] action=STRIKEA, prio=100).
// Viking 4.4 ships only the two RedPin videos in web\screen\TV\media; a hall adds its own. The
// game's hall has a set made for it (tools/make_tv_media.mjs): the strike series, 300, spare,
// split, a converted split, the gutter ball (MISS) and the foul.
// ---------------------------------------------------------------------------
import { GCI } from '../engine/openplay.js';

export const MEDIA_FOLDER = 'web/screen/TV/media/';
export const MEDIA_FILES = ['Strike.webm', 'Double.webm', 'Turkey.webm', 'FourBagger.webm', 'StrikeStreak.webm', 'Perfect300.webm',
  'Spare.webm', 'SplitConverted.webm', 'Split.webm', 'GutterBall.webm', 'Foul.webm'];
// The hall's settings (the reception's Setup > Web): every action, as the setup page's default, and
// an animation for every ball that has one (v3GfxPercentAnims; Viking's default is 50)
export const HALL_ACTIONS = 'STRIKEA;STRIKE2;STRIKE3;STRIKE4;STRIKE5;STRIKE6;STRIKE7;STRIKE8;STRIKE9;STRIKE10;STRIKE11;300;SPARE;FOUL;MISS;SPLIT;SPMAKE;OPEN;PIN1;PIN2;PIN3;PIN4;PIN5;PIN6;PIN7;PIN8;PIN9;';
export const HALL_PERCENT_ANIMS = 100;

// The media .ini as prio.cpp's ParseIniText reads it: [section] lines, key=value, ';' comments,
// a line without '=' skipped, a repeated key keeping the last value
export function parseIni(text) {
  const doc = {};
  let section = '';
  for (const raw of String(text).split('\n')) {
    const line = raw.replace(/\r$/, '').trim();
    if (!line || line[0] === ';' || line[0] === '#') continue;
    const m = /^\[(.*)\]$/.exec(line);
    if (m) { section = m[1].trim(); continue; }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    (doc[section] = doc[section] || {})[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return doc;
}

// CMultimedia::GetRandomMedia's switch: the action an exciter asks for
export function actionFor(exciter, numInARow, fallenPins) {
  switch (exciter) {
    case GCI.EXCITER_STRIKE:
      if (numInARow === 1) return 'STRIKEA';
      if (numInARow > 1 && numInARow < 12) return 'STRIKE' + numInARow;
      if (numInARow === 12) return '300';
      return '';
    case GCI.EXCITER_SPARE: return 'SPARE';
    case GCI.EXCITER_ZERO: return 'MISS';
    case GCI.EXCITER_SPLIT: return 'SPLIT';
    case GCI.EXCITER_FAUL: return 'FOUL';
    case GCI.EXCITER_PIN: return 'PIN' + fallenPins;
    case GCI.EXCITER_SPMAKE: return 'SPMAKE';
    case GCI.EXCITER_OPEN: return 'OPEN';
    default: return '';
  }
}

export class TvMedia {
  constructor(app) {
    this.app = app;
    this.files = [];            // { name, actions: Set, prio, current }
    this.ready = this.load();
  }

  async load() {
    const out = [];
    for (const name of MEDIA_FILES) {
      try {
        const r = await fetch(MEDIA_FOLDER + name.replace(/\.webm$/, '.ini'));
        if (!r.ok) continue;
        const main = parseIni(await r.text()).main || {};
        const actions = new Set(String(main.action || '').split(/[;,]/).map((s) => s.trim().replace(/^\[|\]$/g, '')).filter(Boolean));
        const prio = Math.max(1, Math.min(999, parseInt(main.prio, 10) || 100));
        out.push({ name, actions, prio, current: 0 });
      } catch (e) { /* a file without a readable .ini is not played, as PrioSystem skips it */ }
    }
    this.files = out;
    return out;
  }

  // PrioSystem::GetMediaAction, simplified to what decides a choice here: the files with the action,
  // the one whose turn it is by prio (a higher prio comes round sooner)
  pick(action) {
    const fit = this.files.filter((f) => f.actions.has(action));
    if (!fit.length) return null;
    fit.sort((a, b) => a.current - b.current || b.prio - a.prio);
    const f = fit[0];
    f.current += 1000 / f.prio;
    return f.name;
  }

  // After a scored ball (not a warm-up ball): RenderScreen2's test, then the web animation
  scored(lane, res, eng) {
    if (!res || res.exciter === GCI.EXCITER_NONE || res.redPinStrike) return null;
    const p = res.player;
    if (!p || !(p.activeSquare < 19 || res.numInARow > 1)) return null;
    if (Math.floor(Math.random() * 100) >= HALL_PERCENT_ANIMS) return null;
    const action = actionFor(res.exciter, res.numInARow, res.fallenPins);
    if (!action || HALL_ACTIONS.indexOf(action) < 0) return null;
    const media = this.pick(action);
    if (!media) return null;
    // MyCGamePlayAnim sends the name lower-cased (fileName.MakeLower()); the TV page asks for it
    // so, and the stand-in finds the file's real spelling (js/standin/manifest.js)
    this.app.loadcom.playAnimation(lane, media.toLowerCase(), 2900);
    return media;
  }
}
