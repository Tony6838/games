/* 云端自然语音：微软 Azure 的语音服务（神经语音 Sofie、Hillevi、Mattias，和 Edge 浏览器里的一样）。
   为什么要它：本机的声音每台设备不一样，iPhone、Mac 的 Safari 只给网页几个基础的声音，听起来机械；
   云端的声音在电脑、手机、任何浏览器上都一样自然（Tony 定的，2026-11-12）。
   - 网页向 Tony 的 Cloudflare Worker（tools/tts-worker）要一个 10 分钟有效的临时令牌；Azure 的密钥只在 Worker 里，
     不在网页、也不在仓库里。没有设置 Worker 地址（js/config.js 的 ttsUrl）时，整个模块不用，只用本机的声音。
   - 用微软官方的 Speech SDK（固定版本，带完整性校验）合成一整段（一个段落一次），拿到 MP3 和每个词的音频时间，
     用普通的 <audio> 播放，按播放进度高亮正在读的词。所以 iPhone 上也能跟着高亮单词。
   - 和本机朗读（js/speech.js 的 Reader）用同一套接口：play(si, wi)、pause、resume、toggle、stop、speakText。
     暂停就是 audio.pause()；继续、「从这里读」在已经合成的这一段里直接跳到那个词，不再合成。
   - 合成过的段落按「声音 + 文字」放在内存里（最多 200 段），读第二遍不再花额度；读的时候顺便合成下一段。
   - iPhone 的 Safari 只让用户点过的 <audio> 播放：每次点击时先在两个 audio 元素上各播一小段静音（只做一次）。
   - 出错（令牌拿不到、额度用完、网络不通）时 onFail 告诉 app.js，app.js 改用本机的声音。 */
(function () {
  'use strict';
  const SV = window.SV;
  const conf = SV.config || {};
  const SDK_URL = 'https://cdn.jsdelivr.net/npm/microsoft-cognitiveservices-speech-sdk@1.53.0/distrib/browser/microsoft.cognitiveservices.speech.sdk.bundle-min.js';
  const SDK_SRI = 'sha384-YG0CfpDhvvBF6YvDNHgeAPtRBdnkEnbLtXyPhAfT+dB7uCoCZgcIruOnhmQhJQqv';
  const VOICES = [
    { name: 'sv-SE-SofieNeural', label: 'Sofie', gender: 'f' },
    { name: 'sv-SE-HilleviNeural', label: 'Hillevi', gender: 'f' },
    { name: 'sv-SE-MattiasNeural', label: 'Mattias', gender: 'm' },
  ];
  // 0.1 秒的静音（WAV），只用来在用户点击时「解锁」audio 元素
  const SILENCE = 'data:audio/wav;base64,UklGRkQDAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YSADAACAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgA==';
  const configured = !!conf.ttsUrl;

  function cloudError(message, code) {
    const e = new Error(message);
    e.code = code || 'other';
    return e;
  }

  // ---------- SDK ----------
  let sdkP = null;
  function loadSdk() {
    if (window.SpeechSDK) return Promise.resolve(window.SpeechSDK);
    if (sdkP) return sdkP;
    sdkP = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = SDK_URL;
      s.integrity = SDK_SRI;
      s.crossOrigin = 'anonymous';
      s.referrerPolicy = 'no-referrer';
      s.onload = () => (window.SpeechSDK ? resolve(window.SpeechSDK) : reject(cloudError('语音 SDK 没有加载', 'network')));
      s.onerror = () => reject(cloudError('语音 SDK 下载失败', 'network'));
      document.head.append(s);
    });
    sdkP.catch(() => { sdkP = null; });
    return sdkP;
  }

  // ---------- 令牌（Worker 发，10 分钟有效，用 8 分钟就换） ----------
  let tokenP = null;
  let tokenAt = 0;
  function getToken() {
    if (tokenP && Date.now() - tokenAt < 8 * 60 * 1000) return tokenP;
    tokenAt = Date.now();
    tokenP = fetch(conf.ttsUrl.replace(/\/+$/, '') + '/token', { cache: 'no-store', credentials: 'omit' })
      .then(async (r) => {
        if (r.status === 403) throw cloudError('令牌服务不接受这个网页', 'forbidden');
        if (!r.ok) throw cloudError('令牌服务出错（' + r.status + '）', r.status === 502 ? 'auth' : 'token');
        const j = await r.json();
        if (!j || !j.token || !j.region) throw cloudError('令牌服务的回答不对', 'token');
        return j;
      }, () => { throw cloudError('连不上令牌服务', 'network'); });
    tokenP.catch(() => { tokenP = null; });
    return tokenP;
  }

  // 预先准备（打开文章时）：下载 SDK、拿令牌，都不花合成的额度
  function warm() {
    if (!configured) return;
    loadSdk().then(getToken).catch(() => { /* 真读的时候再报 */ });
  }

  // ---------- 合成一段文字 ----------
  // 返回 { url, bounds: [{ t: 毫秒, start: 在文字里的位置 }] }
  async function synthesize(text, voice) {
    const SDK = await loadSdk();
    const tk = await getToken();
    const sc = SDK.SpeechConfig.fromAuthorizationToken(tk.token, tk.region);
    sc.speechSynthesisVoiceName = voice;
    sc.speechSynthesisLanguage = 'sv-SE';
    sc.speechSynthesisOutputFormat = SDK.SpeechSynthesisOutputFormat.Audio24Khz48KBitRateMonoMp3;
    const synth = new SDK.SpeechSynthesizer(sc, null); // null：不直接播放，只要音频数据
    const raw = [];
    synth.wordBoundary = (_s, e) => {
      if (e.boundaryType && e.boundaryType !== 'WordBoundary') return; // 标点、句子的边界不要
      raw.push({ t: e.audioOffset / 10000, start: e.textOffset, len: e.wordLength, text: e.text || '' });
    };
    let r;
    try {
      r = await new Promise((res, rej) => synth.speakTextAsync(text, res, rej));
    } catch (err) {
      throw cloudError('云端语音出错：' + (err && err.message ? err.message : err), 'network');
    } finally {
      try { synth.close(); } catch (e) { /* 忽略 */ }
    }
    if (!r || r.reason !== SDK.ResultReason.SynthesizingAudioCompleted) {
      const d = (r && r.errorDetails) || '';
      const code = /quota|429|limit/i.test(d) ? 'quota' : /401|403|auth|token/i.test(d) ? 'auth' : 'synth';
      if (code === 'auth') tokenP = null; // 令牌可能过期了，下次重新要
      throw cloudError('云端语音没有合成出来：' + d, code);
    }
    // 词的位置：先信 SDK 给的 textOffset；对不上的，从上一个词后面按词的文字找
    const bounds = [];
    let from = 0;
    for (const b of raw) {
      let at = b.start;
      if (!(at >= 0) || (b.text && text.substr(at, b.text.length) !== b.text)) at = b.text ? text.indexOf(b.text, from) : -1;
      if (at < 0) continue;
      bounds.push({ t: b.t, start: at });
      from = at + Math.max(1, b.text.length || b.len || 1);
    }
    const url = URL.createObjectURL(new Blob([r.audioData], { type: 'audio/mpeg' }));
    return { url, bounds };
  }

  // 合成过的段落（声音 + 文字 → Promise），最多留 200 段
  const cache = new Map();
  function synthCached(text, voice) {
    const key = voice + '\n' + text;
    if (cache.has(key)) return cache.get(key);
    const p = synthesize(text, voice);
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    if (cache.size > 200) {
      const [oldKey, oldP] = cache.entries().next().value;
      cache.delete(oldKey);
      oldP.then((x) => URL.revokeObjectURL(x.url), () => {});
    }
    return p;
  }

  function waitMeta(a) {
    if (a.readyState >= 1) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ok = () => { off(); resolve(); };
      const bad = () => { off(); reject(cloudError('音频打不开', 'play')); };
      const off = () => { a.removeEventListener('loadedmetadata', ok); a.removeEventListener('error', bad); };
      a.addEventListener('loadedmetadata', ok);
      a.addEventListener('error', bad);
    });
  }

  class Reader {
    // hooks: 和 js/speech.js 的 Reader 一样，再加 blocks()、voiceName()、onFail(err)
    constructor(hooks) {
      this.h = hooks;
      this.state = 'idle';
      this.si = 0;
      this.wi = 0;
      this.gen = 0;
      this.wordGen = 0;
      this.wordEvents = true; // 每个词的时间都有
      this.clip = null; // { block, url, words: [{ t, si, wi }] }
      this.raf = 0;
      this.audio = new Audio();
      this.wordAudio = new Audio();
      this.audio.preload = 'auto';
      this.audio.addEventListener('ended', () => this.onEnded());
      this.audio.addEventListener('timeupdate', () => this.update());
      this.unlocked = false;
    }

    available() { return configured; }

    setState(s) {
      if (this.state === s) return;
      this.state = s;
      this.h.onState(s);
    }

    // 在用户的点击里调用：两个 audio 元素各播一下静音，以后 iPhone 才让它们自己播放
    unlock() {
      if (this.unlocked) return;
      this.unlocked = true;
      for (const a of [this.audio, this.wordAudio]) {
        try {
          a.src = SILENCE;
          const p = a.play();
          if (p && p.catch) p.catch(() => {});
        } catch (e) { /* 忽略 */ }
      }
    }

    // 第 bi 段：句子用空格连起来（和页面上一样），合成，再把每个词的时间对到 (句子, 词)
    async clipFor(bi) {
      const blocks = this.h.blocks();
      const sentences = this.h.sentences();
      const b = blocks[bi];
      let text = '';
      const starts = [];
      for (const si of b.sentences) {
        if (text) text += ' ';
        starts.push({ si, at: text.length });
        text += sentences[si].text;
      }
      const r = await synthCached(text, this.h.voiceName());
      const words = [];
      for (const x of r.bounds) {
        let k = starts.length - 1;
        while (k > 0 && starts[k].at > x.start) k--;
        const si = starts[k].si;
        const wi = SV.text.wordAt(sentences[si], x.start - starts[k].at);
        if (wi >= 0) words.push({ t: x.t, si, wi });
      }
      return { block: bi, url: r.url, words, text };
    }

    prefetch(bi) {
      const blocks = this.h.blocks();
      if (bi < blocks.length && blocks[bi].sentences.length) this.clipFor(bi).catch(() => {});
    }

    // 从第 si 句的第 wi 个词开始读；在用户的点击里调用
    play(si = this.si, wi = this.wi) {
      this.unlock();
      const sentences = this.h.sentences();
      if (!sentences.length) return;
      if (si >= sentences.length) { si = 0; wi = 0; }
      const gen = ++this.gen;
      this.wordGen++;
      this.wordAudio.pause();
      this.si = si;
      this.wi = Math.max(0, wi);
      this.setState('speaking');
      this.h.onPosition(this.si, this.wi, false);
      this.startBlock(gen, sentences[si].block, this.si, this.wi);
    }

    async startBlock(gen, bi, si, wi) {
      let clip;
      try {
        clip = await this.clipFor(bi);
      } catch (e) {
        if (gen === this.gen) this.fail(e);
        return;
      }
      if (gen !== this.gen) return;
      const a = this.audio;
      try {
        if (!this.clip || this.clip.url !== clip.url || a.getAttribute('src') !== clip.url) {
          a.src = clip.url;
          await waitMeta(a);
        }
        this.clip = clip;
        if (gen !== this.gen) return;
        // 从这个词（或这一句后面的第一个词）开始；早 30 毫秒，词头不被切掉（update 提前 50 毫秒，高亮还是这个词）
        const w = clip.words.find((x) => (x.si === si && x.wi >= wi) || x.si > si);
        a.currentTime = w ? Math.max(0, w.t / 1000 - 0.03) : 0;
        a.playbackRate = this.h.rate();
        await a.play();
      } catch (e) {
        if (gen !== this.gen) return;
        this.gen++;
        this.setState('paused');
        this.h.onError(e && e.name === 'NotAllowedError' ? '浏览器不让自动播放，请再点一次「继续」' : '播放出错：' + ((e && e.message) || e));
        return;
      }
      if (gen !== this.gen) { a.pause(); return; }
      this.prefetch(bi + 1);
      this.loop(gen);
    }

    // 按播放进度找正在读的词
    update() {
      if (this.state !== 'speaking' || !this.clip) return;
      const t = this.audio.currentTime * 1000 + 50;
      const ws = this.clip.words;
      let k = -1;
      for (let i = 0; i < ws.length && ws[i].t <= t; i++) k = i;
      if (k < 0) return;
      const w = ws[k];
      if (w.si !== this.si || w.wi !== this.wi || !this.shown) {
        this.si = w.si;
        this.wi = w.wi;
        this.shown = true;
        this.h.onPosition(w.si, w.wi, true);
      }
    }

    loop(gen) {
      cancelAnimationFrame(this.raf);
      this.shown = false;
      const step = () => {
        if (gen !== this.gen || this.state !== 'speaking') return;
        this.update();
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    }

    onEnded() {
      if (this.state !== 'speaking' || !this.clip) return;
      const gen = this.gen;
      const blocks = this.h.blocks();
      let bi = this.clip.block + 1;
      while (bi < blocks.length && !blocks[bi].sentences.length) bi++;
      if (bi >= blocks.length) { this.finish(); return; }
      const si = blocks[bi].sentences[0];
      this.si = si;
      this.wi = 0;
      this.h.onPosition(si, 0, false);
      this.startBlock(gen, bi, si, 0);
    }

    fail(e) {
      this.gen++;
      this.audio.pause();
      this.setState('paused');
      this.h.onFail(e);
    }

    pause() {
      if (this.state !== 'speaking') return;
      this.gen++;
      cancelAnimationFrame(this.raf);
      this.audio.pause();
      this.setState('paused');
    }

    resume() {
      if (this.state === 'paused') this.play(this.si, this.wi);
    }

    toggle() {
      if (this.state === 'speaking') this.pause();
      else if (this.state === 'paused') this.resume();
      else this.play(this.si, this.wi);
    }

    // 语速：直接改播放速度（音调不变），不用重新合成
    rateChanged() {
      this.audio.playbackRate = this.h.rate();
    }

    finish() {
      this.gen++;
      cancelAnimationFrame(this.raf);
      this.si = 0;
      this.wi = 0;
      this.setState('idle');
      this.h.onPosition(-1, -1, false);
    }

    stop() {
      this.gen++;
      this.wordGen++;
      cancelAnimationFrame(this.raf);
      this.audio.pause();
      this.wordAudio.pause();
      this.si = 0;
      this.wi = 0;
      this.setState('idle');
    }

    // 单独读一个词或一句话（弹出框里的喇叭、设置里的试听）。正在朗读的先暂停。
    speakText(text) {
      this.unlock();
      if (this.state === 'speaking') this.pause();
      const gen = ++this.wordGen;
      const a = this.wordAudio;
      a.pause();
      synthCached(text, this.h.voiceName()).then(async (r) => {
        if (gen !== this.wordGen) return;
        a.src = r.url;
        a.playbackRate = Math.min(this.h.rate(), 0.9);
        await a.play();
      }).catch((e) => {
        if (gen !== this.wordGen) return;
        if (e && e.code) this.h.onFail(e);
        else this.h.onError('播放出错：' + ((e && e.message) || e));
      });
    }
  }

  SV.cloud = { configured, VOICES, Reader, warm, loadSdk, voiceByName: (n) => VOICES.find((v) => v.name === n) || null };
})();
