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
//    POST /translate/en：一样，只是从英语翻（英语读报用）；请求、回答、错误、上限、每个网络地址的上限都和 /translate 一样（共用）。
//    微软的 Translator 不保存收到的文字（Microsoft Learn「Data, privacy, and security for Translator」）。
//    这里也不记录、不回显文字和密钥：没有任何日志，出错时只回 Azure 的状态码和错误码。
// 3. GET /feed?src=<源>、GET /page?src=<源>&p=<路径>：新闻代理（Tony 同意的，2026-11-14）。英语版有几个新闻源
//    （加拿大统计局、新西兰政府、香港政府……）没有 CORS，浏览器不能直接读，由这里转一下：
//    - 只认 NEWS_SOURCES 里写好的源：/feed 取这个源固定的 RSS 地址，/page 取这个源的网站上、路径合它的规则的网页；
//      不接受任意网址，不跟着跳转到别的网站，只用 https。
//    - 向新闻网站要的时候不带 Origin、Cookie、Referer，User-Agent 是一个普通的说明（有的网站看到 Origin 就回 403）。
//    - 回答原样转给网页（解析在浏览器里做，Worker 免费档每次只有约 10 毫秒的计算时间），最多 2 MB，太大的 RSS
//      截到最后一个完整的条目。整个过程（连接、跳转、读内容）最多 10 秒，超过回 504。
//    - 每个网络地址的上限：NEWS_LIMIT 绑定（wrangler.toml，每 60 秒 120 个请求），超了回 429 { error: 'busy' }；没有这个绑定时不限。
//    - 缓存：Cloudflare 的缓存（Cache API）里放 30 分钟，键是合成的（https://news.invalid/<源>/<feed|page><路径>），
//      不用新闻网站的地址。Cloudflare 的文档说自定义域名上的 Worker 才有能用的 Cache API；只在 workers.dev 上时
//      大概不起作用（不出错，只是每次都去取），所以主要的保护是上面的上限和浏览器自己的缓存。
//      新闻网站出错（4xx、5xx、被挡、10 秒没取完）时，同一个地址 90 秒里不再去问（这个 isolate 的内存里，Cache API 能用时也放一份）。
//    - 不记录、不保存内容；出错时回 { error: 'upstream 403' } 这样的 JSON。
//    - 回答带 Content-Security-Policy: sandbox，直接打开代理的网址时网页里的脚本也不会运行。
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
  async fetch(req, env, ctx) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || 'https://tony6838.github.io').split(',').map((s) => s.trim()).filter(Boolean);
    const ok = allowed.includes(origin) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
    const cors = ok ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') {
      // /translate（和 /translate/en）是带 JSON 的 POST，浏览器先问一次（CORS 预检）；/token 和别的路径照旧只允许 GET
      const allow = Object.prototype.hasOwnProperty.call(TRANSLATE_FROM, url.pathname)
        ? { 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' }
        : { 'Access-Control-Allow-Methods': 'GET' };
      return new Response(null, { status: ok ? 204 : 403, headers: { ...cors, ...allow, 'Access-Control-Max-Age': '86400' } });
    }
    if (req.method === 'POST' && Object.prototype.hasOwnProperty.call(TRANSLATE_FROM, url.pathname)) return translate(req, env, ok, json, TRANSLATE_FROM[url.pathname]);
    if (req.method === 'GET' && (url.pathname === '/feed' || url.pathname === '/page')) return news(req, env, ctx, ok, cors, json, url);
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

// 翻译的路径和源语言：/translate 是瑞典语（以前就有的，一点没变），/translate/en 是英语；目标语言都是简体中文
const TRANSLATE_FROM = { '/translate': 'sv', '/translate/en': 'en' };

async function translate(req, env, ok, json, from) {
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
    r = await fetch('https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=' + from + '&to=zh-Hans' + (textType === 'html' ? '&textType=html' : ''), {
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

// ---------- 新闻代理（/feed、/page） ----------
const NEWS_MAX_BYTES = 2 * 1024 * 1024;
const NEWS_CACHE_SECONDS = 1800;
const NEWS_TIMEOUT = 10000; // 整个过程：连接、跳转、读完内容（测试可以用 env.NEWS_TIMEOUT_MS 改短）
const NEWS_NEG_SECONDS = 90; // 新闻网站出错时，同一个地址这么久里不再去问
const NEWS_NEG_MAX = 500; // 内存里最多记这么多个出错的地址
const negMemo = new Map(); // 合成的键 -> { until, error }（这个 isolate 的内存里）
// 不写 https://：印度政府新闻局（PIB）的防火墙看到 User-Agent 里有「://」就回 403
const NEWS_UA = 'Mozilla/5.0 (compatible; SvenskaReader/1.0; +tony6838.github.io/games/Svenska/)';
// 源：feed 是固定的 RSS 地址（可以没有）；origin 和 page 是 /page 允许的网站和路径（正则，从 / 开始，整个路径都要合）。
// 加一个源只要在这里加一行，网页那边（js/lang/en.js）写 proxy: '<源>'。
const NEWS_SOURCES = {
  // 新西兰政府（Beehive）：RSS 里有全文；网页被 Incapsula 挡着，只要 RSS
  'nz-beehive': { feed: 'https://www.beehive.govt.nz/rss.xml' },
  // 南非政府新闻社 SAnews：RSS 里有全文（只有最新的 10 篇）
  'za-sanews': { feed: 'https://www.sanews.gov.za/south-africa-news-stories.xml' },
  // 香港特区政府新闻公报（英文）：RSS 里有全文（约 3 天、100 篇）
  'hk-isd': { feed: 'https://www.info.gov.hk/gia/rss/general_en.xml' },
  // 加拿大政府新闻（列表从 api.io.canada.ca 直接取，有 CORS；全文在 canada.ca 的网页上）
  'ca-gc': { origin: 'https://www.canada.ca', page: /^\/en\/[a-z0-9-]+(?:\/[a-z0-9-]+)*\/news\/\d{4}\/\d{2}\/[a-z0-9-]+\.html$/ },
  // 加拿大统计局 The Daily（目录直接取，有 CORS；文章网页没有）
  'ca-statcan': { origin: 'https://www150.statcan.gc.ca', page: /^\/n1\/daily-quotidien\/\d{6}\/dq\d{6}[a-z]{1,2}-eng\.htm$/ },
  // 印度政府新闻局 PIB（英文）：今天的列表、一篇篇的新闻稿
  'in-pib': { origin: 'https://www.pib.gov.in', page: /^\/(?:allRel\.aspx\?reg=3&lang=1|PressReleaseIframePage\.aspx\?PRID=\d{6,8}&reg=3&lang=1)$/ },
  // Frontiers for Young Minds（给孩子读的科学文章，CC BY）：最新文章的列表、文章
  'frym': { origin: 'https://kids.frontiersin.org', page: /^\/articles(?:\/10\.3389\/frym\.\d{4}\.\d{5,7})?$/ },
};

function newsSource(id) {
  return id && Object.prototype.hasOwnProperty.call(NEWS_SOURCES, id) ? NEWS_SOURCES[id] : null;
}
// /page 的路径：从 / 开始、不长、没有 ..、//、反斜杠、空白和控制字符，整个合这个源的规则
function okPath(src, p) {
  if (typeof p !== 'string' || !src.origin || !src.page) return false;
  if (p.length > 300 || !p.startsWith('/') || p.startsWith('//') || /\.\.|\\|[\s\u0000-\u001f\u007f]|%2e%2e|%2f|%5c/i.test(p)) return false;
  return src.page.test(p);
}
// 跳转：只跟着跳到同一个网站上合规则的地址（RSS：同一个网站上的任何路径），最多 3 次
function okRedirect(src, kind, target) {
  let u;
  try { u = new URL(target); } catch (e) { return null; }
  if (u.protocol !== 'https:') return null;
  if (kind === 'feed') {
    const f = new URL(src.feed);
    return u.origin === f.origin ? u.href : null;
  }
  if (u.origin !== src.origin || !okPath(src, u.pathname + u.search)) return null;
  return u.href;
}
function timeoutError() { const e = new Error('timeout'); e.name = 'AbortError'; return e; }
// 读一块，到期限（until，Date.now() 的毫秒数）还没来就算超时
async function readWithin(reader, until) {
  const left = until - Date.now();
  if (left <= 0) throw timeoutError();
  let t = 0;
  try {
    return await Promise.race([reader.read(), new Promise((_, rej) => { t = setTimeout(() => rej(timeoutError()), left); })]);
  } finally {
    clearTimeout(t);
  }
}
// 读回答，最多 max 个字节；超过时截断（cut = true）。到期限还没读完：放弃，抛超时（一点一点慢慢给的网站也一样）
async function readBytes(res, max, until) {
  if (!res.body) return { bytes: new Uint8Array(0), cut: false };
  const reader = res.body.getReader();
  const parts = [];
  let n = 0;
  let cut = false;
  for (;;) {
    let step;
    try {
      step = await readWithin(reader, until);
    } catch (e) {
      try { await reader.cancel(); } catch (e2) { /* 不管 */ }
      throw e;
    }
    const { done, value } = step;
    if (done) break;
    if (n + value.byteLength > max) {
      parts.push(value.subarray(0, max - n));
      n = max;
      cut = true;
      try { await reader.cancel(); } catch (e) { /* 不管 */ }
      break;
    }
    parts.push(value);
    n += value.byteLength;
  }
  const all = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { all.set(p, at); at += p.byteLength; }
  return { bytes: all, cut };
}
// 截断了的 RSS / Atom：留到最后一个完整的条目，补上结尾，浏览器才能解析
function trimFeed(bytes) {
  const text = new TextDecoder('latin1').decode(bytes); // 一个字节一个字符，下标就是字节的位置
  for (const [end, tail] of [['</item>', '</channel></rss>'], ['</entry>', '</feed>']]) {
    const i = text.lastIndexOf(end);
    if (i > 0) {
      const keep = bytes.subarray(0, i + end.length);
      const t = new TextEncoder().encode('\n' + tail + '\n');
      const out = new Uint8Array(keep.byteLength + t.byteLength);
      out.set(keep, 0);
      out.set(t, keep.byteLength);
      return out;
    }
  }
  return bytes;
}
function newsType(ct, kind) {
  const c = String(ct || '').toLowerCase();
  const m = c.match(/charset=([\w-]+)/);
  const cs = m ? '; charset=' + m[1] : '';
  if (/xml|rss|atom/.test(c)) return 'application/xml' + cs;
  if (/html/.test(c)) return 'text/html' + cs;
  if (/json/.test(c)) return 'application/json' + cs;
  return kind === 'feed' ? 'application/xml' + cs : 'text/plain' + cs;
}

// 出错的地址记一会儿（内存里；超过上限时丢掉最早的）
function rememberError(ckey, error, status = 502) {
  negMemo.delete(ckey);
  negMemo.set(ckey, { until: Date.now() + NEWS_NEG_SECONDS * 1000, error, status });
  while (negMemo.size > NEWS_NEG_MAX) negMemo.delete(negMemo.keys().next().value);
}

async function news(req, env, ctx, ok, cors, json, url) {
  if (!ok) return json({ error: 'origin not allowed' }, 403);
  const kind = url.pathname === '/feed' ? 'feed' : 'page';
  const id = url.searchParams.get('src');
  const src = newsSource(id);
  if (!src) return json({ error: 'unknown source' }, 404);
  let target;
  let p = '';
  if (kind === 'feed') {
    if (!src.feed) return json({ error: 'no feed' }, 404);
    target = src.feed;
  } else {
    p = url.searchParams.get('p');
    if (!okPath(src, p)) return json({ error: 'path not allowed' }, 400);
    target = src.origin + p;
  }
  // 每个网络地址的上限（缓存里有的也算：挡的是一直来要的）
  if (env && env.NEWS_LIMIT) {
    let allowed = true;
    try { allowed = (await env.NEWS_LIMIT.limit({ key: req.headers.get('CF-Connecting-IP') || 'unknown' })).success; } catch (e) { allowed = true; }
    if (!allowed) return json({ error: 'busy' }, 429);
  }
  const reply = (bytes, type, truncated) => new Response(bytes, {
    status: 200,
    headers: {
      ...cors, 'Content-Type': type, 'Cache-Control': 'public, max-age=900', 'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox", ...(truncated ? { 'X-SV-Truncated': '1' } : {}),
    },
  });
  // 缓存的键是合成的（不是新闻网站的地址）：源的名字、feed 或 page、路径
  const ckey = 'https://news.invalid/' + id + '/' + kind + p;
  const neg = negMemo.get(ckey);
  if (neg && neg.until > Date.now()) return json({ error: neg.error }, neg.status || 502);
  if (neg) negMemo.delete(ckey);
  const cache = typeof caches !== 'undefined' && caches.default ? caches.default : null;
  const key = new Request(ckey, { method: 'GET' });
  const putCache = (bytes, headers) => {
    if (!cache) return null;
    const put = cache.put(key, new Response(bytes, { headers })).catch(() => {});
    if (ctx && ctx.waitUntil) { ctx.waitUntil(put); return null; }
    return put;
  };
  const fail = async (error, status = 502) => {
    rememberError(ckey, error, status);
    const w = putCache(JSON.stringify({ error, status }), { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=' + NEWS_NEG_SECONDS, 'X-SV-Error': '1' });
    if (w) await w;
    return json({ error }, status);
  };
  if (cache) {
    const hit = await cache.match(key);
    if (hit) {
      if (hit.headers.get('X-SV-Error') === '1') {
        let e = 'upstream error';
        let st = 502;
        try { const j = await hit.json(); e = String(j.error || e); st = j.status === 504 ? 504 : 502; } catch (x) { /* 不管 */ }
        return json({ error: e }, st);
      }
      return reply(new Uint8Array(await hit.arrayBuffer()), hit.headers.get('Content-Type') || newsType('', kind), hit.headers.get('X-SV-Truncated') === '1');
    }
  }
  const limitMs = Number(env && env.NEWS_TIMEOUT_MS) > 0 ? Math.min(Number(env.NEWS_TIMEOUT_MS), NEWS_TIMEOUT) : NEWS_TIMEOUT;
  const until = Date.now() + limitMs;
  let res;
  let at = target;
  let bytes;
  let cut;
  try {
    for (let hop = 0; ; hop++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), Math.max(1, until - Date.now()));
      try {
        res = await fetch(at, {
          method: 'GET', redirect: 'manual', signal: ctrl.signal,
          headers: { 'User-Agent': NEWS_UA, Accept: kind === 'feed' ? 'application/rss+xml, application/xml, text/xml, */*' : 'text/html, application/xhtml+xml, */*' },
        });
      } finally {
        clearTimeout(timer);
      }
      if (res.status < 300 || res.status >= 400) break;
      const loc = res.headers.get('Location');
      const next = loc ? okRedirect(src, kind, new URL(loc, at).href) : null;
      if (!next || hop >= 3) return fail('redirect not allowed');
      at = next;
    }
    if (!res.ok) {
      try { if (res.body) await res.body.cancel(); } catch (e) { /* 不管 */ }
      return fail('upstream ' + res.status);
    }
    ({ bytes, cut } = await readBytes(res, NEWS_MAX_BYTES, until));
  } catch (e) {
    // 超时（卡住的网站）也记 90 秒，免得每个读者都再等 10 秒；连不上（多半是一时的）不记
    if (e && e.name === 'AbortError') return fail('upstream timeout', 504);
    return json({ error: 'upstream unreachable' }, 502);
  }
  // Imperva / Incapsula 的验证页（状态码是 200，内容是一小段 HTML）：当作被挡了，不转
  if (bytes.byteLength < 4096 && /_Incapsula_Resource|Incapsula incident/.test(new TextDecoder('latin1').decode(bytes))) return fail('upstream blocked');
  if (cut && kind === 'feed') bytes = trimFeed(bytes);
  const type = newsType(res.headers.get('Content-Type'), kind);
  const w = putCache(bytes, { 'Content-Type': type, 'Cache-Control': 'public, max-age=' + NEWS_CACHE_SECONDS, ...(cut ? { 'X-SV-Truncated': '1' } : {}) });
  if (w) await w;
  return reply(bytes, type, cut);
}
