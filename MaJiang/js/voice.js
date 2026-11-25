/* 语音：吃、碰、杠、胡这些操作，哪一家做的就用哪一家的声音报出来。
 * 用浏览器自带的朗读（Web Speech API 的 speechSynthesis）：没有音频文件，游戏自己也不联网取声音。
 *  - 有上海话（吴语，语言代码 wuu）的声音就用上海话，没有就用普通话，再没有就用别的中文声音；一个中文声音都没有就不说话。
 *  - 语音只跟着牌局走，牌局从不等它：正在说的一句让它念完，排队的只留最新的一句，等得太久的不再说。
 *  - 跟着「声音」的开关走，关了就不说。
 *  - 手机浏览器只肯在点击里开始出声，所以第一次点击时先「说」一句空话（unlock），听不见。
 *  - 没有 speechSynthesis、或者它出错，都只是不说话：从不抛出错误，牌局照旧。 */
(function (root) {
  'use strict';
  const isNode = typeof module === 'object' && module.exports;

  // ---- 说什么 ----------------------------------------------------------------
  // 每个操作说的话都在这一张表里，要改只改这里。
  // 摸牌、打牌不说话（打牌有落牌的声音）；本游戏不报听，所以没有「听」。
  const PHRASES = {
    chi: '吃！',
    peng: '碰！',
    gang: '杠！', // 明杠
    angang: '暗杠！',
    jiagang: '加杠！', // 推出第四张的时候喊，别家要抢的话接着喊「拉杠胡」
    buhua: '补花！',
    guo: '过。', // 「过」和「抓牌」只有你自己点的才说：电脑放过一张牌不出声，否则就泄露了它手里有能吃碰的牌
    zhuapai: '抓牌。',
    zimo: '自摸！',
    ron: '胡了！',
    rob: '拉杠胡！',
    qizhuoyi: '七捉一！',
    bahua: '八花！',
    tianhu: '天胡！',
    dihu: '地胡！',
    sankou: '三口！',
    kaibao: '开宝！',
    liuju: '流局！',
  };
  // 一局的结果：排在别的话前面，等多久都要说
  const VITAL = new Set(['zimo', 'ron', 'rob', 'qizhuoyi', 'bahua', 'tianhu', 'dihu', 'liuju']);
  const SPECIAL_WINS = { 八花: 'bahua', 天胡: 'tianhu', 地胡: 'dihu' };

  /** 胡牌说哪一句：八花、天胡、地胡说自己的名字，其余按怎么胡的（zimo / ron / rob / qizhuoyi）。 */
  function winKey(w) {
    const special = w.score.patterns.find((p) => SPECIAL_WINS[p]);
    return special ? SPECIAL_WINS[special] : w.how;
  }

  /** 裁判的一个事件 -> 要说的话 [{ key, seat }]，不说话的事件是空的。 */
  function forEvent(e) {
    switch (e.type) {
      case 'handStart': return e.kaibao ? [{ key: 'kaibao', seat: e.dealer }] : [];
      case 'flower': return [{ key: 'buhua', seat: e.seat }];
      case 'kongAttempt': return [{ key: 'jiagang', seat: e.seat }];
      case 'meld':
        if (e.mtype !== 'gang') return [{ key: e.mtype, seat: e.seat }];
        if (e.sub === 'jia') return []; // 推出第四张的时候（kongAttempt）已经喊过
        return [{ key: e.sub === 'an' ? 'angang' : 'gang', seat: e.seat }];
      case 'sankou': return [{ key: 'sankou', seat: e.a }];
      case 'handEnd':
        if (e.result.type === 'draw') return [{ key: 'liuju', seat: 0 }];
        return e.result.winners.map((w) => ({ key: winKey(w), seat: w.seat }));
      default: return [];
    }
  }

  // ---- 用谁的声音 --------------------------------------------------------------
  const langOf = (v) => String(v.lang || '').replace(/_/g, '-'); // 安卓写成 zh_CN，也有写成 zho-CHN 的
  /** 0 上海话（吴语），1 普通话，2 别的中文（台湾国语、东北话、陕西话等），3 粤语，-1 不是中文。 */
  function tierOf(v) {
    const l = langOf(v).toLowerCase();
    if (/^(wuu|zh-wuu|zh-cn-shanghai)(-|$)/.test(l)) return 0;
    if (/^(zh|cmn|zho)(-hans)?(-cn|-chn)?$/.test(l)) return 1;
    if (/^(yue|zh-yue|zho?(-hant)?-(hkg?|mo))(-|$)/.test(l)) return 3;
    if (/^(zh|cmn|zho)-/.test(l)) return 2;
    return -1;
  }
  const NOVELTY = /^(eddy|flo|grandma|grandpa|reed|rocko|sandy|shelley)\b/i; // 苹果的机器人腔，有别的就不用
  const MALE = /云希|云健|云扬|云夏|云哲|康康|yunxi|yunjian|yunyang|yunxia|yunzhe|kangkang|li-?mu/i; // 四家都是男的
  // 本机的声音在前：出声快，断网也能用；联网的声音在后
  const weight = (v) => (v.localService === false ? 0 : 2) + (MALE.test(v.name) ? 1 : 0);
  // 声音不够四个时几家合用一个，用音高和语速分开
  const STYLES = [
    { pitch: 1, rate: 1.1 },
    { pitch: 0.8, rate: 1.05 },
    { pitch: 1.25, rate: 1.15 },
    { pitch: 0.65, rate: 1 },
  ];

  /** 四家各用哪个声音 [{ voice, pitch, rate } × 4]；没有中文声音时是 null。usable 去掉现在不能用的。 */
  function pickVoices(voices, usable) {
    let tier = Infinity;
    let best = [];
    for (const v of voices) {
      const t = tierOf(v);
      if (t < 0 || t > tier || (usable && !usable(v))) continue;
      if (t < tier) best = [];
      tier = t;
      best.push(v);
    }
    if (!best.length) return null;
    const natural = best.filter((v) => !NOVELTY.test(v.name));
    if (natural.length) best = natural;
    best.sort((a, b) => weight(b) - weight(a));
    return [0, 1, 2, 3].map((s) => ({ voice: best[s % best.length], ...STYLES[Math.floor(s / best.length)] }));
  }

  // ---- 说 --------------------------------------------------------------------
  const MAX_WAIT = 1500; // 排队超过这么久（毫秒），牌局已经走远，不说了
  const MAX_LINE = 4000; // 一句话最多这么久，还没完就当它卡住了
  // 一句话念出声要多久。Edge 的联网声音念完还要拖一秒多的空白才报「说完」，后面有话等着的时候不等这一段
  const spokenMs = (key) => 300 + 230 * (PHRASES[key].length - 1);
  const REMOTE_OFF = 60000; // 联网的声音连着出不来，这么久以内不再用
  const VOICE_ERRORS = ['network', 'voice-unavailable', 'language-unavailable', 'synthesis-unavailable', 'synthesis-failed'];

  class Speaker {
    #synth;
    #Utterance;
    #isOn;
    #now;
    #setTimer;
    #clearTimer;
    #online;
    #unlocked = false;
    #current = null; // 正在说的：{ lines, vital, at, index, utterance, startedAt, timers, retry }
    #next = null; // 排队的，只有一句
    #bad = new Set(); // 用不了的声音
    #remoteFails = 0; // 联网的声音连着几次出不来
    #remoteOffUntil = 0;

    /** opts.isOn()：现在要不要出声。其余的只给测试替换。 */
    constructor(opts) {
      const pick = (name, dflt) => (opts[name] !== undefined ? opts[name] : dflt);
      this.#isOn = opts.isOn;
      this.#synth = pick('synth', root.speechSynthesis) || null;
      this.#Utterance = pick('Utterance', root.SpeechSynthesisUtterance) || null;
      this.#now = pick('now', () => performance.now());
      this.#setTimer = pick('setTimer', (f, ms) => setTimeout(f, ms));
      this.#clearTimer = pick('clearTimer', (t) => clearTimeout(t));
      this.#online = pick('online', () => typeof navigator === 'undefined' || navigator.onLine !== false);
      if (!this.#Utterance) this.#synth = null;
      // 有的浏览器要先问一次才开始载入声音；要说的时候再看有哪些，晚载入的也用得上
      this.#guard(() => this.#synth.getVoices());
    }

    /** 语音出什么错都不能影响牌局。 */
    #guard(fn) {
      if (!this.#synth) return undefined;
      try {
        return fn();
      } catch (e) {
        return undefined;
      }
    }

    /** 要在用户的点击里调用。 */
    unlock() {
      if (this.#unlocked || !this.#isOn()) return;
      this.#guard(() => {
        const u = new this.#Utterance(''); // 空话：浏览器当场算说完，不出声，也不占着朗读
        u.volume = 0;
        this.#synth.speak(u);
        this.#unlocked = true;
      });
    }

    say(key, seat) {
      this.announce([{ key, seat }]);
    }

    /** 说几句（一炮多响时几家各说一句）。正在说别的就排队，原来排队的由这一句代替。 */
    announce(lines) {
      if (!lines.length || !this.#unlocked || !this.#isOn()) return;
      this.#guard(() => {
        const item = { lines, vital: lines.some((x) => VITAL.has(x.key)), at: this.#now(), index: 0, utterance: null, startedAt: null, timers: [], retry: 0 };
        const cur = this.#current;
        if (cur && item.vital && !cur.vital && cur.startedAt === null) {
          this.#release();
          this.#synth.cancel(); // 还没出声的，让给胡牌、流局
        }
        if (!this.#current) {
          this.#next = null;
          this.#speakLine(item);
        } else if (item.vital || !this.#next || !this.#next.vital) {
          this.#next = item;
          this.#hurry();
        }
      });
    }

    /** 关声音、离开网页：马上停。 */
    stop() {
      this.#next = null;
      if (!this.#current) return;
      this.#release();
      this.#guard(() => this.#synth.cancel());
    }

    #release() {
      const cur = this.#current;
      this.#current = null;
      if (cur) cur.timers.forEach((t) => this.#clearTimer(t));
    }

    #usable(v) {
      if (this.#bad.has(v.voiceURI || v.name)) return false;
      return v.localService !== false || (this.#online() && this.#now() >= this.#remoteOffUntil);
    }

    #speakLine(item) {
      const line = item.lines[item.index];
      const seats = pickVoices(this.#synth.getVoices(), (v) => this.#usable(v));
      if (!seats) return;
      const { voice, pitch, rate } = seats[line.seat];
      const u = new this.#Utterance(PHRASES[line.key]);
      u.voice = voice;
      u.lang = langOf(voice);
      u.pitch = pitch;
      u.rate = rate;
      item.utterance = u; // 留着它：有的浏览器会把没人引用的 utterance 收走，onend 就不来了
      item.startedAt = null;
      const mine = () => this.#current === item && item.utterance === u;
      u.onstart = () => {
        if (!mine()) return;
        item.startedAt = this.#now();
        if (voice.localService === false) this.#remoteFails = 0;
        this.#hurry();
      };
      u.onend = () => { if (mine()) this.#done(); };
      u.onerror = (e) => {
        if (!mine()) return;
        // 还没出声就失败的再说一次（Edge 的联网声音约二十句有一句这样），后面有话等着就算了
        const retry = this.#failed(voice, e && e.error) && item.startedAt === null && !this.#next && item.retry++ === 0;
        if (!retry) {
          this.#done();
          return;
        }
        this.#release();
        this.#guard(() => this.#speakLine(item));
      };
      this.#current = item;
      item.timers = [this.#setTimer(() => {
        if (!mine()) return;
        if (item.startedAt === null && voice.localService === false) this.#restRemote();
        this.#done(true);
      }, MAX_LINE)];
      try {
        this.#synth.speak(u);
      } catch (e) {
        this.#release();
      }
    }

    /** 出错了，记下来。返回 true：是声音的毛病，可以再说一次。 */
    #failed(voice, error) {
      if (error === 'not-allowed') this.#unlocked = false; // 浏览器还不让出声，下一次点击再解锁
      if (!VOICE_ERRORS.includes(error)) return false;
      if (voice.localService === false) {
        if (++this.#remoteFails >= 2) this.#restRemote();
      } else if (error !== 'network') {
        this.#bad.add(voice.voiceURI || voice.name);
      }
      return true;
    }

    #restRemote() {
      this.#remoteFails = 0;
      this.#remoteOffUntil = this.#now() + REMOTE_OFF;
    }

    /** 后面有话等着：正在说的这一句念出声以后就接着说后面的，不等它拖的空白。 */
    #hurry() {
      const cur = this.#current;
      if (cur.startedAt === null || cur.timers.length > 1) return;
      if (!this.#next && cur.index + 1 >= cur.lines.length) return;
      const left = cur.startedAt + spokenMs(cur.lines[cur.index].key) - this.#now();
      if (left <= 0) this.#done(true);
      else cur.timers.push(this.#setTimer(() => { if (this.#current === cur) this.#done(true); }, left));
    }

    /** 一句说完（或没说成；cut：没等它报「说完」）：接着说这一次的下一句，或者排队的那一句。 */
    #done(cut) {
      const cur = this.#current;
      this.#release();
      this.#guard(() => {
        if (cut) this.#synth.cancel();
        if (cur.index + 1 < cur.lines.length) {
          cur.index++;
          cur.retry = 0;
          this.#speakLine(cur);
        }
        if (this.#current) return;
        const item = this.#next;
        this.#next = null;
        if (item && (item.vital || this.#now() - item.at <= MAX_WAIT)) this.#speakLine(item);
      });
    }
  }

  const api = { PHRASES, winKey, forEvent, tierOf, pickVoices, Speaker };
  if (isNode) module.exports = api;
  else (root.MJ = root.MJ || {}).Voice = api;
})(typeof self !== 'undefined' ? self : globalThis);
