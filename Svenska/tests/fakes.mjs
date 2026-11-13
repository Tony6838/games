// browser_check.mjs（无头 Edge）和 webkit_check.mjs（WebKit、Firefox）共用的假东西，在页面脚本之前放进页面。

// 假的微软 Speech SDK：不联网，每个词 220 毫秒（window.__ttsWordMs 可以改短，循环朗读的测试用），返回同样长的静音 WAV
// 和每个词的时间（和真的 SDK 一样的事件和字段）。记下每次合成的声音、文字、令牌，看缓存和换声音对不对。
export const FAKE_AZURE = `(() => {
  window.__ttsLog = [];
  const WORD = /[\\p{L}\\p{N}]+(?:[-'’:][\\p{L}\\p{N}]+|[.,]\\p{N}+)*/gu;
  function wav(ms) {
    const rate = 8000, n = Math.round(rate * ms / 1000), buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const s = (o, t) => { for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i)); };
    s(0, 'RIFF'); v.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); s(36, 'data'); v.setUint32(40, n, true);
    for (let i = 0; i < n; i++) v.setUint8(44 + i, 128);
    return buf;
  }
  class SpeechSynthesizer {
    constructor(conf, audioConfig) { this.conf = conf; this.audioConfig = audioConfig; this.wordBoundary = null; }
    speakTextAsync(text, ok) {
      // window.__ttsFail = 'quota'：像 Azure 的免费额度用完时一样，合成被拒绝（429）
      if (window.__ttsFail === 'quota') { setTimeout(() => ok({ reason: 'canceled', errorDetails: 'WebSocket upgrade failed: Too many requests (429). Quota exceeded.' }), 50); return; }
      const ws = [...text.matchAll(WORD)];
      const W = window.__ttsWordMs || 220;
      window.__ttsLog.push({ voice: this.conf.speechSynthesisVoiceName, text, token: this.conf.token, audioConfig: this.audioConfig });
      setTimeout(() => {
        ws.forEach((m, i) => this.wordBoundary && this.wordBoundary(this, { audioOffset: (100 + i * W) * 10000, duration: (W - 20) * 10000, text: m[0], wordLength: m[0].length, textOffset: m.index, boundaryType: 'WordBoundary' }));
        ok({ reason: 'done', audioData: wav(150 + ws.length * W) });
      }, 80);
    }
    close() {}
  }
  window.SpeechSDK = {
    SpeechConfig: { fromAuthorizationToken: (token, region) => ({ token, region }) },
    SpeechSynthesisOutputFormat: { Audio24Khz48KBitRateMonoMp3: 'mp3' },
    ResultReason: { SynthesizingAudioCompleted: 'done' },
    SpeechSynthesizer,
  };
})();`;

// 记下页面给锁屏界面、媒体键注册的动作（Media Session），测试里直接调用它们，就像按了锁屏界面上的按钮
export const MS_RECORDER = `(() => {
  window.__ms = {};
  const m = navigator.mediaSession;
  if (!m || !m.setActionHandler) return;
  const orig = m.setActionHandler.bind(m);
  m.setActionHandler = (name, fn) => { window.__ms[name] = fn; try { orig(name, fn); } catch (e) {} };
})();`;
