/* 牌张定义与公平洗牌。两副牌共 108 张。
 * 牌种编号 kind：花色 × 13 + (点数 - 2)，点数 2..14（14 是 A）；52 小王，53 大王。
 * 花色：0 黑桃 1 红桃 2 梅花 3 方块。 */
(function (root) {
  'use strict';

  const SUITS = ['♠', '♥', '♣', '♦'];
  const SUIT_NAMES = ['黑桃', '红桃', '梅花', '方块'];
  const RANK_TEXT = { 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const SMALL_JOKER = 52;
  const BIG_JOKER = 53;

  const isJoker = (k) => k >= 52;
  const suitOf = (k) => (k < 52 ? Math.floor(k / 13) : -1);
  const rankOf = (k) => (k < 52 ? (k % 13) + 2 : k === SMALL_JOKER ? 15 : 16);
  const kindOf = (suit, rank) => suit * 13 + rank - 2;
  const rankText = (r) => RANK_TEXT[r] || String(r);

  /** 分牌：5 算 5 分，10 和 K 算 10 分。 */
  function points(k) {
    if (k >= 52) return 0;
    const r = (k % 13) + 2;
    return r === 5 ? 5 : r === 10 || r === 13 ? 10 : 0;
  }

  function name(k) {
    if (k === SMALL_JOKER) return '小王';
    if (k === BIG_JOKER) return '大王';
    return SUITS[suitOf(k)] + rankText(rankOf(k));
  }

  function buildDeck() {
    const d = [];
    for (let n = 0; n < 2; n++) for (let k = 0; k < 54; k++) d.push(k);
    return d;
  }

  const u32 = new Uint32Array(1);
  /** 密码学随机数 + 拒绝采样，没有取模偏差。 */
  function secureInt(n) {
    const limit = Math.floor(0x100000000 / n) * n;
    let x;
    do {
      globalThis.crypto.getRandomValues(u32);
      x = u32[0];
    } while (x >= limit);
    return x % n;
  }

  /** Fisher-Yates 洗牌，每种排列概率相等。 */
  function shuffle(arr, randInt) {
    const rnd = randInt || secureInt;
    for (let i = arr.length - 1; i > 0; i--) {
      const j = rnd(i + 1);
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  const api = {
    SUITS, SUIT_NAMES, SMALL_JOKER, BIG_JOKER,
    isJoker, suitOf, rankOf, kindOf, rankText, points, name, buildDeck, secureInt, shuffle,
  };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.TJ = root.TJ || {}).Cards = api;
})(typeof self !== 'undefined' ? self : globalThis);
