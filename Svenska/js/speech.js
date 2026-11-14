/* 朗读：浏览器的 Web Speech API（speechSynthesis），瑞典语（sv-SE）声音。
   一次读一句（长句再按逗号切开）：
   - 每句开始时报告位置（页面滚到这一句，句子本身不标出来）；声音支持 boundary 事件的，再跟着标出正在读的词；
   - 一句读完在 onend 里接着读下一句（不用定时器，后台标签页里定时器会被放慢到一秒一次）；整篇读完时，
     「本篇循环」（hooks.loop()）就从头再读；app.js 要接着读（三连读的下一遍、下一篇：hooks.onEnd() 回 true）时 hold()，
     状态还是「正在读」，等它调 play(0, 0)；
   - 页面藏起来时不停：电脑上切到别的标签页、窗口最小化，Chrome、Edge 接着读；手机锁屏时系统会停掉 speechSynthesis，
     回到前台时 kick() 从停下的词接着读（锁屏后继续读要用云端语音，它是普通的 audio）；
   - 暂停用 cancel() 而不是 pause()（安卓的 Chrome 不支持 pause），继续时从停下的那个词重新读；
   - iPhone 的 Safari 只允许在用户点击里开始朗读，所以 speak() 都在点击/按键的处理函数里同步调用。 */
(function () {
  'use strict';
  const SV = window.SV;
  const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

  // 按名字认男女声。微软：Sofie、Hedvig、Hillevi 女，Mattias、Bengt 男；苹果：Alva、Klara 女，Oskar 男。
  const FEMALE = ['sofie', 'hedvig', 'hillevi', 'alva', 'klara', 'astrid', 'elin', 'karin', 'ingrid', 'linnea', 'maja', 'emma', 'sara', 'female', 'kvinna', 'kvinnlig', 'woman'];
  const MALE = ['mattias', 'bengt', 'oskar', 'erik', 'anders', 'johan', 'lars', 'male', 'man ', 'manlig'];

  function isSwedish(v) { return /^sv([-_]|$)/i.test(v.lang || ''); }
  function genderOf(v) {
    const n = ' ' + (v.name || '').toLowerCase() + ' ';
    if (FEMALE.some((f) => n.includes(f))) return 'f';
    if (MALE.some((m) => n.includes(m))) return 'm';
    return '?';
  }
  // 自然音、增强音优先
  function quality(v) {
    const n = (v.name || '').toLowerCase();
    let q = 0;
    if (/natural|neural|premium|enhanced|förbättrad|siri/.test(n)) q += 2;
    if (/online/.test(n)) q += 0.5;
    if (/^sv-se/i.test(v.lang)) q += 0.2;
    return q;
  }

  function voices() {
    if (!synth) return [];
    return synth.getVoices().filter(isSwedish).map((v) => ({ v, gender: genderOf(v), q: quality(v) }))
      .sort((a, b) => b.q - a.q);
  }

  // 声音列表有的浏览器要等一会儿才给（voiceschanged）
  function onVoices(cb) {
    if (!synth) { cb(); return; }
    cb();
    if (synth.addEventListener) synth.addEventListener('voiceschanged', cb);
    else synth.onvoiceschanged = cb;
    let n = 0;
    const t = setInterval(() => { cb(); if (++n >= 6) clearInterval(t); }, 500);
  }

  // pref: { gender: 'f'|'m', voiceURI }。返回 { voice, gender, exact }，exact=false 表示没有想要的性别
  function pickVoice(pref) {
    const list = voices();
    if (!list.length) return { voice: null, gender: '?', exact: false };
    if (pref.voiceURI) {
      const hit = list.find((x) => x.v.voiceURI === pref.voiceURI);
      if (hit) return { voice: hit.v, gender: hit.gender, exact: true };
    }
    const want = list.filter((x) => x.gender === pref.gender);
    if (want.length) return { voice: want[0].v, gender: pref.gender, exact: true };
    const unknown = list.filter((x) => x.gender === '?');
    const pick = unknown[0] || list[0];
    return { voice: pick.v, gender: pick.gender, exact: false };
  }

  // 太长的句子在逗号等处切开，避免有的浏览器读长句时中途停掉
  function chunks(text, from) {
    const out = [];
    let start = from;
    while (start < text.length) {
      let end = text.length;
      if (end - start > 220) {
        const slice = text.slice(start, start + 200);
        const cut = Math.max(slice.lastIndexOf(', '), slice.lastIndexOf('; '), slice.lastIndexOf(' – '), slice.lastIndexOf(': '));
        end = cut > 40 ? start + cut + 1 : start + 200 + Math.max(0, text.slice(start + 200).indexOf(' '));
        if (end <= start) end = text.length;
      }
      out.push({ start, end });
      start = end;
      while (text[start] === ' ') start++;
    }
    return out;
  }

  class Reader {
    // hooks: { sentences(): [...], voice(): SpeechSynthesisVoice|null, rate(): number,
    //          onState(state), onPosition(si, wi, byWord), onError(msg) }
    constructor(hooks) {
      this.h = hooks;
      this.state = 'idle'; // idle | speaking | paused
      this.si = 0;
      this.wi = 0;
      this.gen = 0;
      this.wordEvents = false; // 这个声音有没有给过词的 boundary 事件
      this.keep = null; // 保持对当前 utterance 的引用（Chrome 会提前回收，结果 onend 不来）
      this.loops = 0; // 循环朗读从头读了几遍（给测试看）
      this.held = false; // 整篇读完，等着 app.js 接着读（hold）
    }

    available() { return !!synth; }

    setState(s) {
      if (this.state === s) return;
      this.state = s;
      this.h.onState(s);
    }

    // 从第 si 句的第 wi 个词开始读；必须在用户的点击/按键里调用
    play(si = this.si, wi = this.wi) {
      if (!synth) { this.h.onError('这个浏览器不支持朗读'); return; }
      const sentences = this.h.sentences();
      if (!sentences.length) return;
      if (si >= sentences.length) { si = 0; wi = 0; }
      this.held = false;
      this.gen++;
      synth.cancel();
      this.si = si;
      this.wi = Math.max(0, wi);
      this.setState('speaking');
      this.speakSentence(this.gen);
    }

    speakSentence(gen) {
      const sentences = this.h.sentences();
      const s = sentences[this.si];
      if (!s) { this.finish(); return; }
      const from = this.wi > 0 && s.words[this.wi] ? s.words[this.wi].start : 0;
      const list = chunks(s.text, from);
      this.h.onPosition(this.si, this.wi, false);
      this.speakChunk(gen, s, list, 0);
    }

    speakChunk(gen, s, list, ci) {
      const c = list[ci];
      const u = new SpeechSynthesisUtterance(s.text.slice(c.start, c.end));
      u.lang = 'sv-SE';
      const v = this.h.voice();
      if (v) u.voice = v;
      u.rate = this.h.rate();
      u.onboundary = (e) => {
        if (gen !== this.gen) return;
        if (e.name && e.name !== 'word') return;
        const wi = SV.text.wordAt(s, c.start + (e.charIndex || 0));
        if (wi < 0) return;
        this.wordEvents = true;
        this.wi = wi;
        this.h.onPosition(this.si, wi, true);
      };
      u.onend = () => {
        if (gen !== this.gen) return;
        if (ci + 1 < list.length) { this.speakChunk(gen, s, list, ci + 1); return; }
        this.si++;
        this.wi = 0;
        if (this.si >= this.h.sentences().length) {
          if (!(this.h.loop && this.h.loop())) {
            if (this.h.onEnd && this.h.onEnd()) this.hold();
            else this.finish();
            return;
          }
          this.si = 0; // 循环朗读：从头再读这一篇
          this.loops++;
        }
        this.speakSentence(gen);
      };
      u.onerror = (e) => {
        if (gen !== this.gen) return;
        if (e.error === 'interrupted' || e.error === 'canceled') return;
        this.gen++;
        this.setState('paused');
        this.h.onError(e.error === 'not-allowed' ? '浏览器不让自动朗读，请再点一次蓝色的 ▶ 按钮' : '朗读出错：' + (e.error || '未知原因'));
      };
      this.keep = u;
      synth.speak(u);
    }

    // app.js 要接着读（三连读的下一遍、下一篇）：状态还是「正在读」，等它调 play(0, 0)。
    // 也可以在读的半路调（读的时候在这一批的最后一篇点「下一篇」、要先取下一批）：先停下正在读的这一句
    hold() {
      this.gen++;
      this.held = true;
      if (synth) synth.cancel();
      this.si = 0;
      this.wi = 0;
      this.h.onPosition(-1, -1, false);
    }

    pause() {
      if (this.state !== 'speaking') return;
      // 等着接着读（hold）的时候暂停：不接着读，停在这一篇的开头；再点 ▶ 从头读（三连读时是下一遍，app.js 定）
      if (this.held) {
        this.gen++;
        this.held = false;
        synth.cancel();
        this.si = 0;
        this.wi = 0;
        this.setState('paused');
        return;
      }
      this.gen++;
      synth.cancel();
      // 声音不报告词的位置时，只能从这一句开头重读
      if (!this.wordEvents) this.wi = 0;
      this.setState('paused');
    }

    resume() {
      if (this.state === 'paused') this.play(this.si, this.wi);
    }

    // 页面回到前台：系统在后台停掉了朗读（手机锁屏等）的话，从停下的词接着读
    kick() {
      if (this.state !== 'speaking' || !synth || this.held) return;
      if (synth.paused) { synth.resume(); return; }
      if (!synth.speaking && !synth.pending) this.play(this.si, this.wi);
    }

    toggle() {
      if (this.state === 'speaking') this.pause();
      else if (this.state === 'paused') this.resume();
      else this.play(this.si, this.wi);
    }

    finish() {
      this.gen++;
      this.held = false;
      this.si = 0;
      this.wi = 0;
      this.setState('idle');
      this.h.onPosition(-1, -1, false);
    }

    stop() {
      this.gen++;
      this.held = false;
      if (synth) synth.cancel();
      this.si = 0;
      this.wi = 0;
      this.setState('idle');
    }

    // 单独读一个词或一段文字（弹出框里的喇叭）。正在朗读的会先暂停。
    speakText(text) {
      if (!synth) { this.h.onError('这个浏览器不支持朗读'); return; }
      if (this.state === 'speaking') this.pause();
      this.gen++;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'sv-SE';
      const v = this.h.voice();
      if (v) u.voice = v;
      u.rate = Math.min(this.h.rate(), 0.9);
      this.keep = u;
      synth.speak(u);
    }
  }

  SV.speech = { voices, pickVoice, onVoices, genderOf, Reader, supported: !!synth };
})();
