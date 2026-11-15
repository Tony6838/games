// browser_check.mjs（无头 Edge）和 webkit_check.mjs（WebKit、Firefox）共用的假东西：大多在页面脚本之前放进页面；
// 假的 /translate（fakeTranslateReply）由两个测试各自的网络拦截调用。

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

// 假的浏览器内置翻译（Translator API）：译文是「〔内置〕原文」，看翻译的顺序（微软翻译用不了时才用它）对不对。
// window.__trAvail 可以在页面脚本之前设成 'downloadable'（要点一下才能下载模型）；window.__trCreates 记下下载（create）了几次
export const FAKE_TRANSLATOR = `(() => {
  window.__trLog = [];
  window.__trCreates = 0;
  const fake = {
    availability: async () => window.__trAvail || 'available',
    create: async () => { window.__trCreates++; return { translate: async (t) => { window.__trLog.push(t); return '〔内置〕' + t; } }; },
  };
  try { Object.defineProperty(window, 'Translator', { value: fake, configurable: true, writable: true }); } catch (e) { window.Translator = fake; }
})();`;

// 真的机器翻译给的句子译文（MyMemory 的机器翻译，2026-11-13 实测，见 README「翻译」），假的 /translate 照这个回答
export const AZ_DICT = {
  'Vården sköts av regionen.': '医疗保健由该地区负责。',
  'Domen föll i tingsrätten i går.': '该判决于昨天在地区法院作出。',
  'Läget i Gaza är fortfarande allvarligt.': '加沙的局势仍然严峻。',
  'Regeringen fick kritik för sitt förslag.': '政府因其提案而受到批评。',
};

// 真的微软翻译（2026-11-15，经过 Worker）给三句测试用的句子的回答：整句（plain）、查的词包在 <b> 里的整句（html）、每个词单独的译文（words）。
// 第一句是 Tony 截图里的例子（enshrined 的标签是空的），后两句是自己编的瑞典语句子（合成词 säkerhetsfrågor、变形的 Fartygen）。
// 只在 plan.real 时用（看整句译文里点的词画在哪里），别的测试照旧用编的回答
export const AZ_REAL = {
  "html": {
    "The importance of maritime security and upholding international law at sea, as <b>enshrined</b> in UNCLOS, was agreed as essential to the security and prosperity of the Euro-Atlantic region.": "联合国海洋法公约中规定的海上安全和维护国际法的重要性，被<b></b>认定为欧亚大西洋地区安全与繁荣的关键。",
    "The importance of <b>maritime</b> security and upholding international law at sea, as enshrined in UNCLOS, was agreed as essential to the security and prosperity of the Euro-Atlantic region.": "联合国海洋法公约中规定的 <b>海上</b> 安全和维护国际法的重要性，被认定为欧亚大西洋地区安全与繁荣的关键。",
    "The importance of maritime security and <b>upholding</b> international law at sea, as enshrined in UNCLOS, was agreed as essential to the security and prosperity of the Euro-Atlantic region.": "联合国海洋法公约中规定的海上安全和 <b>维护</b> 国际法的重要性，被认定为欧亚大西洋地区安全与繁荣的关键。",
    "The importance of maritime security and upholding international law at sea, as enshrined in UNCLOS, was agreed as essential to the security and <b>prosperity</b> of the Euro-Atlantic region.": "联合国海洋法公约中规定的海上安全和维护国际法的重要性，被认定为欧亚大西洋地区安全与 <b>繁荣</b> 的关键。",
    "The importance of maritime security and upholding international law at sea, as enshrined in UNCLOS, was <b>agreed</b> as essential to the security and prosperity of the Euro-Atlantic region.": "联合国海洋法公约中规定的海上安全和维护国际法的重要性，被 <b>认</b> 定为欧亚大西洋地区安全与繁荣的关键。",
    "The importance of maritime security and upholding international law at sea, as enshrined in UNCLOS, was agreed as <b>essential</b> to the security and prosperity of the Euro-Atlantic region.": "联合国海洋法公约中规定的海上安全和维护国际法的重要性，被认定为欧亚大西洋地区安全与繁荣 <b>的关键</b> 。",
    "The importance of maritime security and upholding international law at sea, as enshrined in UNCLOS, was agreed as essential to <b>the</b> security and prosperity of the Euro-Atlantic region.": "联合国海洋法公约中规定的海上安全和维护国际法的重要性，被认定为 <b>欧</b> 亚大西洋地区安全与繁荣的关键。",
    "<b>Fartygen</b> lämnade hamnen i Göteborg tidigt på morgonen.": "<b>舰队</b> 清晨离开哥德堡港。",
    "Fartygen <b>lämnade</b> hamnen i Göteborg tidigt på morgonen.": "舰队清晨 <b>离开</b> 哥德堡港。",
    "Fartygen lämnade <b>hamnen</b> i Göteborg tidigt på morgonen.": "舰队清晨离开哥德堡 <b>港</b> 。",
    "Fartygen lämnade hamnen i Göteborg <b>tidigt</b> på morgonen.": "舰队清晨离开哥德堡港。<b></b>",
    "Fartygen lämnade hamnen i Göteborg tidigt <b>på</b> morgonen.": "舰队 <b>清晨离开</b> 哥德堡港。",
    "Fartygen lämnade hamnen i Göteborg tidigt på <b>morgonen</b>.": "舰队清 <b>晨</b>离开哥德堡港。",
    "Regeringen vill diskutera <b>säkerhetsfrågor</b> med de nordiska grannländerna.": "政府希望与北欧邻国讨论 <b>安全问题</b> 。",
    "Regeringen vill diskutera säkerhetsfrågor med de nordiska <b>grannländerna</b>.": "政府希望与北欧 <b>邻国</b>讨论安全问题。",
    "Regeringen vill <b>diskutera</b> säkerhetsfrågor med de nordiska grannländerna.": "政府希望与北欧邻国 <b>讨论</b> 安全问题。",
    "Regeringen vill diskutera säkerhetsfrågor med de <b>nordiska</b> grannländerna.": "政府希望与 <b>北欧</b> 邻国讨论安全问题。",
    "Regeringen vill diskutera säkerhetsfrågor <b>med</b> de nordiska grannländerna.": "政府希望 <b>与</b> 北欧邻国讨论安全问题。"
  },
  "plain": {
    "The importance of maritime security and upholding international law at sea, as enshrined in UNCLOS, was agreed as essential to the security and prosperity of the Euro-Atlantic region.": "联合国海洋法公约中规定的海上安全和维护国际法的重要性，被认定为欧亚大西洋地区安全与繁荣的关键。",
    "Fartygen lämnade hamnen i Göteborg tidigt på morgonen.": "舰队清晨离开哥德堡港。",
    "Regeringen vill diskutera säkerhetsfrågor med de nordiska grannländerna.": "政府希望与北欧邻国讨论安全问题。"
  },
  "words": {
    "The": "该",
    "importance": "重要性",
    "of": "关于",
    "maritime": "海事",
    "security": "安全",
    "and": "以及",
    "upholding": "维护",
    "international": "国际赛事",
    "law": "法律",
    "at": "在",
    "sea": "海",
    "as": "作为",
    "enshrined": "入祀",
    "in": "在",
    "UNCLOS": "联合国海洋法公约",
    "was": "是",
    "agreed": "同意",
    "essential": "必不可少",
    "to": "到",
    "the": "该",
    "prosperity": "繁荣",
    "Euro-Atlantic": "欧大西洋",
    "region": "地区",
    "Fartygen": "舰船",
    "lämnade": "左",
    "hamnen": "港口",
    "i": "i",
    "Göteborg": "哥德堡",
    "tidigt": "早期",
    "på": "关于",
    "morgonen": "早晨",
    "Regeringen": "政府",
    "vill": "想",
    "diskutera": "讨论",
    "säkerhetsfrågor": "安全问题",
    "med": "其中",
    "de": "该",
    "nordiska": "北欧",
    "grannländerna": "邻国"
  }
};

// 假的 /translate（Tony 的 Cloudflare Worker 的替身，和 tools/tts-worker/worker.js 回答的一样）。
// 返回 { status, body }；mode 是 'down' 时返回 null，测试让这个请求连不上。
//   'ok'：纯文字：字典（AZ_DICT）里有的照字典回答；没有的，一个词译成「〔微软〕词」，一句译成「这句…测试译文。」，
//         plan.add（字符串）放在句子的译文中间；
//         textType 'html'（查词选意思，查的词包在 <b> 里）：译成「这句 <b>…</b> 测试译文。」，标签里是 plan.tag
//         （没给就是「某某」，null 就不放标签），像微软那样在标签两边加空格；
//         plan.real：先照 AZ_REAL（真的回答）答，里面没有的照上面的规则；
//         一次发几个词（js/translate.js 的 wordsQuiet）时一个一个答
//   'quota'：429 { error: 'quota' }（免费额度用完了）；'busy'：429 { error: 'busy' }（太频繁）；
//   'status:403' 之类：回那个状态码（Worker 的设置不对）；'azure401'：502 { error: 'azure 401 401000' }（Azure 的密钥不对）
export function fakeTranslateReply(mode, bodyText, plan = {}) {
  if (mode === 'down') return null;
  if (mode === 'quota' || mode === 'busy') return { status: 429, body: { error: mode } };
  if (/^status:\d+$/.test(mode)) return { status: +mode.slice(7), body: { error: 'test ' + mode } };
  if (mode === 'azure401') return { status: 502, body: { error: 'azure 401 401000' } };
  let body = null;
  try { body = JSON.parse(bodyText || '{}'); } catch (e) { body = null; }
  const texts = body && body.texts;
  if (!Array.isArray(texts) || !texts.length || texts.length > 10) return { status: 400, body: { error: 'bad request' } };
  const real = (kind, t) => (plan.real && Object.prototype.hasOwnProperty.call(AZ_REAL[kind], t) ? AZ_REAL[kind][t] : '');
  if (body.textType === 'html') {
    const tag = plan.tag === undefined ? '某某' : plan.tag;
    return { status: 200, body: { translations: texts.map((t) => real('html', t) || (tag === null ? '这句' + (plan.add || '') + '测试译文。' : '这句' + (plan.add || '') + ' <b>' + tag + '</b> 测试译文。')) } };
  }
  return {
    status: 200,
    body: { translations: texts.map((t) => real('plain', t) || real('words', t) || AZ_DICT[t] || (/\s/.test(t.trim()) ? '这句' + (plan.add || '') + '测试译文。' : '〔微软〕' + t)) },
  };
}
