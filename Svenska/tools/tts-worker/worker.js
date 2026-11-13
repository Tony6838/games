// 《瑞典语读报》的云端服务（Cloudflare Worker，名字 svenska-tts）。做两件事，Azure 的密钥都只在这里，不在网页、也不在 GitHub 上：
//
// 1. GET /token：网页（js/cloudtts.js）来要一个微软 Azure 语音服务的临时令牌（10 分钟有效），拿它直接向 Azure 合成声音。
//    返回 { token, region }。
// 2. POST /translate：网页（js/translate.js）查词、翻译一句时，把文字转给微软 Azure 的翻译服务（Translator，F0 免费档）。
//    请求 { texts: ["...", ...], textType: 'html'（可以不写，默认纯文字）}，一次最多 10 段、合计 1000 个字符；
//    只翻瑞典语 → 简体中文（固定在这里，网页改不了）。textType 'html'：查词时把这个词包在 <b> 里整句翻译，
//    看 Azure 把标签放在哪几个中文字上（按这一句选词义用，见 js/sense.js）。
//    返回 200 { translations: ["...", ...] }（和 texts 一一对应）；
//         429 { error: 'quota' }：免费额度用完了（Azure 回 403、错误码 403001），网页几个小时里不再来问；
//         429 { error: 'busy' }：太频繁（Azure 回 429，错误码 429000、429001、429002；或者下面每个网络地址的上限），
//                                网页一分钟里改用别的翻译；
//         400 / 413：请求不对、太长；502：Azure 别的错误，或者连不上 Azure。
//    微软的 Translator 不保存收到的文字（Microsoft Learn「Data, privacy, and security for Translator」）。
//    这里也不记录、不回显文字和密钥：没有任何日志，出错时只回 Azure 的状态码和错误码。
//
// 变量（Cloudflare 控制台 → 这个 Worker → Settings → Variables and Secrets）：
//   AZURE_SPEECH_KEY         机密（Secret）：Azure 语音资源的「密钥 1」
//   AZURE_SPEECH_REGION      普通变量：Azure 语音资源的区域，例如 northeurope、westeurope、swedencentral
//   AZURE_TRANSLATOR_KEY     机密（Secret）：Azure 翻译资源（Translator）的「密钥 1」
//   AZURE_TRANSLATOR_REGION  普通变量：Azure 翻译资源的区域，例如 northeurope
//   ALLOWED_ORIGINS          普通变量，可以不设：允许的网页来源，逗号分开；默认 https://tony6838.github.io
//
// 只给允许的网页（看 Origin），本机测试（http://127.0.0.1、localhost）也允许。
// Origin 在浏览器外可以伪造，所以真正的保护是 Azure 用免费档（F0）：额度用完就停，不会扣钱；
// /translate 每次请求的上限，加上每个网络地址每分钟约 6000 个字符的上限（Cloudflare 的 Rate Limiting 绑定
// TRANSLATE_LIMIT，见 wrangler.toml；没有这个绑定时不限），让冒用的人没法一下子用掉很多额度。
// 这个上限是每个 Cloudflare 机房各算各的、大概的数，正常读报远用不到。
const TRANSLATE_MAX_ITEMS = 10;
const TRANSLATE_MAX_CHARS = 1000; // 合计；Azure 按 Unicode 码位算字符，这里也一样
const TRANSLATE_MAX_BODY = 16384; // 请求体的长度（字节）：上面的上限写成 JSON 远小于这个；边读边数，超过就不再读
const LIMIT_UNIT_CHARS = 100; // 每个网络地址的上限按「100 个字符一份」算（wrangler.toml：每 60 秒 60 份）

// 读请求体，超过 max 个字节就停下返回 null（没有 Content-Length 时也不会整个读进来）
async function readCapped(req, max) {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const parts = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) {
      try { await reader.cancel(); } catch (e) { /* 不管 */ }
      return null;
    }
    parts.push(value);
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return new TextDecoder().decode(all);
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || 'https://tony6838.github.io').split(',').map((s) => s.trim()).filter(Boolean);
    const ok = allowed.includes(origin) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
    const cors = ok ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      // /translate 是带 JSON 的 POST，浏览器先问一次（CORS 预检）；/token 和别的路径照旧只允许 GET
      const allow = url.pathname === '/translate'
        ? { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }
        : { 'Access-Control-Allow-Methods': 'GET' };
      return new Response(null, { status: ok ? 204 : 403, headers: { ...cors, ...allow, 'Access-Control-Max-Age': '86400' } });
    }
    if (req.method === 'POST' && url.pathname === '/translate') return translate(req, env, ok, json);
    if (req.method !== 'GET' || url.pathname !== '/token') return json({ error: 'not found' }, 404);
    if (!ok) return json({ error: 'origin not allowed' }, 403);
    if (!env.AZURE_SPEECH_KEY || !env.AZURE_SPEECH_REGION) return json({ error: 'AZURE_SPEECH_KEY or AZURE_SPEECH_REGION not set' }, 500);

    const region = String(env.AZURE_SPEECH_REGION).trim().toLowerCase();
    if (!/^[a-z0-9]+$/.test(region)) return json({ error: 'bad AZURE_SPEECH_REGION' }, 500);
    const r = await fetch(`https://${region}.api.cognitive.microsoft.com/sts/v1.0/issueToken`, {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': env.AZURE_SPEECH_KEY, 'Content-Length': '0' },
    });
    if (!r.ok) return json({ error: 'azure ' + r.status }, 502);
    return json({ token: await r.text(), region });
  },
};

async function translate(req, env, ok, json) {
  if (!ok) return json({ error: 'origin not allowed' }, 403);
  if (!env.AZURE_TRANSLATOR_KEY || !env.AZURE_TRANSLATOR_REGION) return json({ error: 'AZURE_TRANSLATOR_KEY or AZURE_TRANSLATOR_REGION not set' }, 500);
  const region = String(env.AZURE_TRANSLATOR_REGION).trim().toLowerCase();
  if (!/^[a-z0-9]+$/.test(region)) return json({ error: 'bad AZURE_TRANSLATOR_REGION' }, 500);

  if (Number(req.headers.get('Content-Length') || 0) > TRANSLATE_MAX_BODY) return json({ error: 'too long' }, 413);
  const raw = await readCapped(req, TRANSLATE_MAX_BODY);
  if (raw === null) return json({ error: 'too long' }, 413);
  let body0 = null;
  try { body0 = JSON.parse(raw); } catch (e) { body0 = null; }
  const texts = body0 && body0.texts;
  const textType = body0 && body0.textType;
  if (!Array.isArray(texts) || !texts.length || texts.length > TRANSLATE_MAX_ITEMS
    || !texts.every((t) => typeof t === 'string' && t.trim())
    || (textType !== undefined && textType !== 'plain' && textType !== 'html')) return json({ error: 'bad request' }, 400);
  const chars = texts.reduce((n, t) => n + [...t].length, 0);
  if (chars > TRANSLATE_MAX_CHARS) return json({ error: 'too long' }, 413);
  if (env.TRANSLATE_LIMIT) {
    const ip = req.headers.get('CF-Connecting-IP') || 'unknown';
    let allowed = true;
    try { allowed = (await env.TRANSLATE_LIMIT.limit({ key: ip, delta: Math.max(1, Math.ceil(chars / LIMIT_UNIT_CHARS)) })).success; } catch (e) { allowed = true; }
    if (!allowed) return json({ error: 'busy' }, 429);
  }

  let r;
  try {
    r = await fetch('https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=sv&to=zh-Hans' + (textType === 'html' ? '&textType=html' : ''), {
      method: 'POST',
      headers: {
        'Ocp-Apim-Subscription-Key': env.AZURE_TRANSLATOR_KEY,
        'Ocp-Apim-Subscription-Region': region,
        'Content-Type': 'application/json; charset=UTF-8',
      },
      body: JSON.stringify(texts.map((t) => ({ Text: t }))),
    });
  } catch (e) {
    return json({ error: 'azure unreachable' }, 502);
  }
  let body = null;
  try { body = await r.json(); } catch (e) { body = null; }
  if (r.ok) {
    const out = Array.isArray(body) ? body.map((x) => (x && Array.isArray(x.translations) && x.translations[0] && typeof x.translations[0].text === 'string' ? x.translations[0].text : null)) : [];
    if (out.length !== texts.length || out.some((t) => t === null)) return json({ error: 'azure bad reply' }, 502);
    return json({ translations: out });
  }
  // Azure 出错时回 { error: { code: 403001, message } }；错误码是 HTTP 状态码后面再加三位（Microsoft Learn「Translator response codes」）
  const code = (body && body.error && Number(body.error.code)) || 0;
  if (r.status === 403 && code === 403001) return json({ error: 'quota' }, 429);
  if (r.status === 429) return json({ error: 'busy' }, 429);
  return json({ error: 'azure ' + r.status + (code ? ' ' + code : '') }, 502);
}
