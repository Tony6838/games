/* 云端自然语音：微软 Azure 的语音服务（神经语音 Sofie、Hillevi、Mattias，和 Edge 浏览器里的一样）。
   为什么要它：本机的声音每台设备不一样，iPhone、Mac 的 Safari 只给网页几个基础的声音，听起来机械；
   云端的声音在电脑、手机、任何浏览器上都一样自然（Tony 定的，2026-11-12）。
   - 网页向 Tony 的 Cloudflare Worker（tools/tts-worker）要一个 10 分钟有效的临时令牌；Azure 的密钥只在 Worker 里，
     不在网页、也不在仓库里。没有设置 Worker 地址（js/config.js 的 ttsUrl）时，整个模块不用，只用本机的声音。
   - 用微软官方的 Speech SDK（固定版本，带完整性校验）合成一整段（一个段落一次），拿到 MP3 和每个词的音频时间，
     用普通的 <audio> 播放，按播放进度高亮正在读的词。所以 iPhone 上也能跟着高亮单词。
   - 和本机朗读（js/speech.js 的 Reader）用同一套接口：play(si, wi)、pause、resume、toggle、stop、speakText、kick、hold。
     整篇读完时问 hooks.onEnd()：app.js 要接着读下一篇（「读完以后」是「接着读下一篇」）就 hold()，等着它打开下一篇再 play(0, 0)，
     中间 audio 一直循环播静音，锁屏时也接得上。
     暂停就是 audio.pause()；继续、「从这里读」在已经合成的这一段里直接跳到那个词，不再合成。
   - 合成过的段落按「声音 + 文字」放在内存里，读第二遍（循环朗读、继续、喇叭）不再花额度；换文章时 forget() 全部放掉。
     读的时候提前合成后面两段。
   - 页面藏起来（别的标签页、窗口最小化、手机锁屏）时接着读：一段读完，在 audio 的 ended 事件里同步换上下一段
     （已经合成好的），不用定时器、不等网络；下一段还没好时，同一个 audio 先循环播静音，保住「正在播放」。
     正在读的词靠 timeupdate 往前走（藏起来时 requestAnimationFrame 不来）。
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

  // 合成过的段落（声音 + 文字）留在内存里：读第二遍（循环朗读、继续、「从这里读」、喇叭）不再花额度。
  // 换文章时 app.js 调 forget()，全部放掉。cache 是 Promise，done 是已经合成好、可以马上拿到的。
  const cache = new Map();
  const done = new Map();
  let cacheGen = 0;
  const keyOf = (text, voice) => voice + '\n' + text;
  function synthCached(text, voice) {
    const key = keyOf(text, voice);
    if (cache.has(key)) return cache.get(key);
    const g = cacheGen;
    const p = synthesize(text, voice).then((r) => {
      // 合成的时候文章已经换了：这段用不上了
      if (g !== cacheGen) { URL.revokeObjectURL(r.url); throw cloudError('文章已经换了', 'stale'); }
      done.set(key, r);
      return r;
    });
    cache.set(key, p);
    p.catch(() => { if (cache.get(key) === p) cache.delete(key); });
    return p;
  }
  function forget() {
    cacheGen++;
    for (const r of done.values()) URL.revokeObjectURL(r.url);
    done.clear();
    cache.clear();
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
      this.loops = 0; // 循环朗读从头读了几遍（给测试看）
      this.held = false; // 整篇读完，等着 app.js 打开下一篇（hold）
      this.audio = new Audio();
      this.wordAudio = new Audio();
      this.audio.preload = 'auto';
      this.audio.addEventListener('ended', () => this.onEnded());
      // 页面藏起来时 requestAnimationFrame 停了，timeupdate 照样来，正在读的词照样往前走
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

    // 第 bi 段的文字：句子用空格连起来（和页面上一样），记下每句从哪里开始
    blockText(bi) {
      const sentences = this.h.sentences();
      let text = '';
      const starts = [];
      for (const si of this.h.blocks()[bi].sentences) {
        if (text) text += ' ';
        starts.push({ si, at: text.length });
        text += sentences[si].text;
      }
      return { text, starts };
    }

    // 把合成结果里每个词的时间对到 (句子, 词)
    makeClip(bi, bt, r) {
      const sentences = this.h.sentences();
      const words = [];
      for (const x of r.bounds) {
        let k = bt.starts.length - 1;
        while (k > 0 && bt.starts[k].at > x.start) k--;
        const si = bt.starts[k].si;
        const wi = SV.text.wordAt(sentences[si], x.start - bt.starts[k].at);
        if (wi >= 0) words.push({ t: x.t, si, wi });
      }
      return { block: bi, url: r.url, words, text: bt.text };
    }

    async clipFor(bi) {
      const bt = this.blockText(bi);
      return this.makeClip(bi, bt, await synthCached(bt.text, this.h.voiceName()));
    }

    // 已经合成好的段落马上拿到（不用等），没有就是 null
    clipNow(bi) {
      const bt = this.blockText(bi);
      const r = done.get(keyOf(bt.text, this.h.voiceName()));
      return r ? this.makeClip(bi, bt, r) : null;
    }

    firstBlock() {
      const blocks = this.h.blocks();
      let bi = 0;
      while (bi < blocks.length && !blocks[bi].sentences.length) bi++;
      return bi < blocks.length ? bi : -1;
    }

    // 提前合成后面两段，一段读完马上接下一段（手机锁屏时也不断）；开着循环朗读时，快读完了也备好开头那段
    prefetch(bi) {
      const blocks = this.h.blocks();
      for (let k = bi; k < Math.min(blocks.length, bi + 2); k++) if (blocks[k].sentences.length) this.clipFor(k).catch(() => {});
      if (bi + 2 > blocks.length && this.h.loop && this.h.loop()) {
        const f = this.firstBlock();
        if (f >= 0) this.clipFor(f).catch(() => {});
      }
    }

    // 下一段还没合成好时，在同一个 audio 上循环播一小段静音，保住「正在播放」：
    // 手机锁屏、后台标签页里，停下来的 audio 之后可能不让再播。已经在循环播静音时不动它（不重新加载、不再 play）
    bridge() {
      const a = this.audio;
      if (a.loop && a.getAttribute('src') === SILENCE && !a.paused) return;
      try {
        a.loop = true;
        a.src = SILENCE;
        const p = a.play();
        if (p && p.catch) p.catch(() => {});
      } catch (e) { /* 忽略 */ }
    }

    // 从第 si 句的第 wi 个词开始读；在用户的点击里调用
    play(si = this.si, wi = this.wi) {
      this.unlock();
      const sentences = this.h.sentences();
      if (!sentences.length) return;
      if (si >= sentences.length) { si = 0; wi = 0; }
      this.held = false;
      const gen = ++this.gen;
      this.wordGen++;
      this.wordAudio.pause();
      this.si = si;
      this.wi = Math.max(0, wi);
      this.setState('speaking');
      this.h.onPosition(this.si, this.wi, false);
      this.startBlock(gen, sentences[si].block, this.si, this.wi);
    }

    // 读第 bi 段，从第 si 句第 wi 个词开始。这一段已经合成好、又是从头读（一段读完接下一段、循环朗读回到开头）时，
    // 在调用它的那个事件里同步换上音频、开始播放，中间不等任何东西：后台标签页、手机锁屏时也接得上。
    async startBlock(gen, bi, si, wi) {
      const a = this.audio;
      let clip = this.clipNow(bi);
      if (!clip) {
        this.clip = null;
        this.bridge();
        try {
          clip = await this.clipFor(bi);
        } catch (e) {
          if (gen === this.gen && !(e && e.code === 'stale')) this.fail(e);
          return;
        }
        if (gen !== this.gen) return;
      }
      // 从这个词（或这一句后面的第一个词）开始；早 30 毫秒，词头不被切掉（update 提前 50 毫秒，高亮还是这个词）
      const w = clip.words.find((x) => (x.si === si && x.wi >= wi) || x.si > si);
      const at = w ? Math.max(0, w.t / 1000 - 0.03) : 0;
      const rate = this.h.rate();
      try {
        const same = !!this.clip && this.clip.url === clip.url && a.getAttribute('src') === clip.url && !a.loop;
        this.clip = clip;
        if (!same) {
          a.loop = false;
          a.src = clip.url;
          if (at > 0.05) {
            await waitMeta(a);
            if (gen !== this.gen) return;
          }
        }
        if (same || at > 0.05) a.currentTime = at;
        a.defaultPlaybackRate = rate;
        a.playbackRate = rate;
        const p = a.play();
        this.prefetch(bi + 1);
        this.tick(gen);
        await p;
      } catch (e) {
        if (gen !== this.gen) return;
        this.gen++;
        this.setState('paused');
        this.h.onError(e && e.name === 'NotAllowedError' ? '浏览器不让自动播放，请再点一次蓝色的 ▶ 按钮' : '播放出错：' + ((e && e.message) || e));
        return;
      }
      if (gen !== this.gen && this.state !== 'speaking') a.pause();
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

    // 页面看得见时，每一帧对一下正在读的词（藏起来时 requestAnimationFrame 不来，靠 timeupdate）
    tick(gen) {
      cancelAnimationFrame(this.raf);
      this.shown = false;
      const step = () => {
        if (gen !== this.gen || this.state !== 'speaking') return;
        this.update();
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    }

    // 页面回到前台：标记马上跳到正在读的词（不重读）
    kick() {
      this.update();
    }

    // 一段读完：接着读下一段；整篇读完时，「本篇循环」就从头再读；「接着读下一篇」时等着 app.js 打开下一篇（hold）；不然停下
    onEnded() {
      if (this.state !== 'speaking' || !this.clip || this.audio.getAttribute('src') !== this.clip.url) return;
      const gen = this.gen;
      const blocks = this.h.blocks();
      let bi = this.clip.block + 1;
      while (bi < blocks.length && !blocks[bi].sentences.length) bi++;
      if (bi >= blocks.length) {
        bi = this.h.loop && this.h.loop() ? this.firstBlock() : -1;
        if (bi < 0) {
          if (this.h.onEnd && this.h.onEnd()) this.hold();
          else this.finish();
          return;
        }
        this.loops++;
      }
      const si = blocks[bi].sentences[0];
      this.si = si;
      this.wi = 0;
      this.h.onPosition(si, 0, false);
      this.startBlock(gen, bi, si, 0);
    }

    fail(e) {
      this.gen++;
      this.audio.loop = false;
      this.audio.pause();
      this.setState('paused');
      this.h.onFail(e);
    }

    // 整篇读完、app.js 要接着读（三连读的下一遍；「读完以后」是「接着读下一篇」；读的时候在这一批最后一篇点了「下一篇」）：
    // 状态还是「正在读」，同一个 audio 循环播静音，保住「正在播放」和锁屏界面（手机锁屏时停下来的 audio 之后可能不让再播，
    // 页面也会被挂起）；app.js 打开下一篇（或者滚回开头）后调 play(0, 0)。
    // 等的时候按暂停：不接着读，停在这一篇的开头（再点 ▶ 从头读；三连读时是下一遍，app.js 定）。
    hold() {
      this.gen++;
      this.wordGen++;
      this.held = true;
      cancelAnimationFrame(this.raf);
      this.wordAudio.pause();
      this.clip = null;
      this.si = 0;
      this.wi = 0;
      this.bridge();
      this.h.onPosition(-1, -1, false);
    }

    pause() {
      if (this.state !== 'speaking') return;
      if (this.held) {
        this.gen++;
        this.held = false;
        this.audio.loop = false;
        this.audio.pause();
        this.si = 0;
        this.wi = 0;
        this.setState('paused');
        return;
      }
      this.gen++;
      cancelAnimationFrame(this.raf);
      this.audio.loop = false;
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
      this.held = false;
      cancelAnimationFrame(this.raf);
      this.si = 0;
      this.wi = 0;
      this.setState('idle');
      this.h.onPosition(-1, -1, false);
    }

    stop() {
      this.gen++;
      this.wordGen++;
      this.held = false;
      cancelAnimationFrame(this.raf);
      this.audio.loop = false;
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
        if (gen !== this.wordGen || (e && e.code === 'stale')) return;
        if (e && e.code) this.h.onFail(e);
        else this.h.onError('播放出错：' + ((e && e.message) || e));
      });
    }
  }

  SV.cloud = { configured, VOICES, Reader, warm, loadSdk, forget, cacheSize: () => done.size, voiceByName: (n) => VOICES.find((v) => v.name === n) || null };
})();
