/* 牌张定义与公平洗牌。
 * 牌种编号：0-8 万，9-17 条，18-26 筒，27-30 东南西北，31-33 中发白，34-41 春夏秋冬梅兰竹菊。 */
(function (root) {
  'use strict';

  const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
  const SUITS = ['万', '条', '筒'];
  const HONORS = ['东风', '南风', '西风', '北风', '红中', '发财', '白板'];
  const FLOWERS = ['春', '夏', '秋', '冬', '梅', '兰', '竹', '菊'];

  const isNumber = (k) => k >= 0 && k < 27;
  const isHonor = (k) => k >= 27 && k < 34;
  const isWind = (k) => k >= 27 && k < 31;
  const isDragon = (k) => k >= 31 && k < 34;
  const isFlower = (k) => k >= 34 && k < 42;
  const suitOf = (k) => (k < 27 ? Math.floor(k / 9) : -1);
  const rankOf = (k) => (k < 27 ? k % 9 : -1);

  function name(k) {
    if (isNumber(k)) return CN_NUM[rankOf(k)] + SUITS[suitOf(k)];
    if (isHonor(k)) return HONORS[k - 27];
    return FLOWERS[k - 34];
  }

  /** 一副完整的 144 张牌（只有牌种，未洗）。 */
  function buildSet() {
    const set = [];
    for (let k = 0; k < 34; k++) for (let i = 0; i < 4; i++) set.push(k);
    for (let k = 34; k < 42; k++) set.push(k);
    return set;
  }

  const u32 = new Uint32Array(1);
  /** 密码学随机数 + 拒绝采样，没有取模偏差。返回 [0, n) 的整数。 */
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
    isNumber, isHonor, isWind, isDragon, isFlower, suitOf, rankOf, name,
    buildSet, secureInt, shuffle, CN_NUM, SUITS, HONORS, FLOWERS,
  };

  if (typeof module === 'object' && module.exports) module.exports = api;
  else (root.MJ = root.MJ || {}).Tiles = api;
})(typeof self !== 'undefined' ? self : globalThis);
