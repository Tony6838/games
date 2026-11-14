// 检查云端服务（tools/tts-worker/worker.js，Cloudflare Worker）：不联网，用 Node 自己的 Request / Response，
// 把 Worker 向 Azure 发的请求换成假的，看它怎么回答网页。
//   node tests/worker_check.mjs
// 1. GET /token 和以前完全一样（云端语音在用）：允许的网页拿到 { token, region }，别的网页 403，没设密钥 500，
//    Azure 不给令牌 502；预检（OPTIONS）照旧只允许 GET。
// 2. POST /translate：只给允许的网页；预检允许 POST 和 Content-Type；转给 Azure Translator 时语言固定（sv → zh-Hans），
//    带密钥和区域；免费额度用完（Azure 403、403001）回 429 quota，限流（Azure 429）回 429 busy，别的错误 502；
//    一次最多 10 段、合计 1000 个字符；textType html；每个网络地址的上限（假的绑定）；没有 Content-Length 的大请求体边读边停；
//    回答和日志里都没有要翻译的文字和密钥。
// 4. POST /translate/en：从英语翻，别的（请求、回答、错误、上限）和 /translate 一样；/translate 照旧是 from=sv；别的语言 404。
// 3. GET /feed、/page（新闻代理）：只认写好的源（没写的、直接写网址的回 404），只给允许的网页；向新闻网站要的时候不带 Origin、
//    Cookie、Referer；不跟着跳到别的网站；新闻网站出错回 502，同一个地址 90 秒里不再去问；太大的 RSS 截到 2 MB；
//    期限包括读内容（慢慢给的网站 504）；每个网络地址的上限（假的 NEWS_LIMIT）；放进 Cloudflare 的缓存（合成的键）；/page 的路径要合规则。
import worker from '../tools/tts-worker/worker.js';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  通过 ' : '  失败 ') + name + (detail ? '：' + detail : ''));
}

const SITE = 'https://tony6838.github.io';
const ENV = {
  AZURE_SPEECH_KEY: 'speech-secret-key', AZURE_SPEECH_REGION: 'northeurope',
  AZURE_TRANSLATOR_KEY: 'translator-secret-key', AZURE_TRANSLATOR_REGION: 'northeurope',
  ALLOWED_ORIGINS: SITE,
};
// 假的 Azure：记下 Worker 发出的请求，按 reply 回答（reply 抛错就是连不上）
let azureCalls = [];
let reply = () => new Response('', { status: 500 });
globalThis.fetch = async (url, init = {}) => {
  azureCalls.push({ url: String(url), method: init.method, headers: { ...(init.headers || {}) }, body: init.body });
  return reply(String(url), init);
};
// 时钟：出错的地址 Worker 记 90 秒，later() 把时钟往后拨 10 分钟（记的都过期了）
let clockShift = 0;
const realNow = Date.now.bind(Date);
Date.now = () => realNow() + clockShift;
const later = () => { clockShift += 10 * 60 * 1000; };
// Worker 不应该写任何日志（尤其不能把文字或密钥写进日志）
const logs = [];
for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
  const orig = console[k].bind(console);
  console[k] = (...a) => { if (new Error().stack.includes('worker.js')) logs.push(a.join(' ')); else orig(...a); };
}

async function call(method, path, { origin = SITE, body, env = ENV, headers = {} } = {}) {
  const h = { ...headers };
  if (origin) h.Origin = origin;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  const res = await worker.fetch(new Request('https://svenska-tts.example.workers.dev' + path, { method, headers: h, body }), env);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* 预检没有内容 */ }
  return { status: res.status, headers: Object.fromEntries(res.headers), text, json };
}
const azJson = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json' } });

// ---------- GET /token：和以前一样 ----------
console.log('\n== GET /token（云端语音的令牌，和以前一样）');
azureCalls = [];
reply = () => new Response('TOKEN-abc', { status: 200 });
let r = await call('GET', '/token');
check('允许的网页拿到 { token, region }', r.status === 200 && r.json.token === 'TOKEN-abc' && r.json.region === 'northeurope' && Object.keys(r.json).join() === 'token,region', r.text);
check('回答的头：只给这个网页（Access-Control-Allow-Origin）、Vary: Origin、JSON、不缓存',
  r.headers['access-control-allow-origin'] === SITE && r.headers.vary === 'Origin' && r.headers['content-type'] === 'application/json; charset=utf-8' && r.headers['cache-control'] === 'no-store', JSON.stringify(r.headers));
check('向 Azure 语音要令牌：区域的 issueToken、POST、语音的密钥',
  azureCalls.length === 1 && azureCalls[0].url === 'https://northeurope.api.cognitive.microsoft.com/sts/v1.0/issueToken' && azureCalls[0].method === 'POST'
  && azureCalls[0].headers['Ocp-Apim-Subscription-Key'] === 'speech-secret-key' && azureCalls[0].headers['Content-Length'] === '0', JSON.stringify(azureCalls[0]));
r = await call('GET', '/token', { origin: 'http://127.0.0.1:8123' });
check('本机测试的网页（127.0.0.1）也行', r.status === 200 && r.headers['access-control-allow-origin'] === 'http://127.0.0.1:8123');
r = await call('GET', '/token', { origin: 'https://evil.example' });
check('别的网页：403 origin not allowed，没有 Access-Control-Allow-Origin', r.status === 403 && r.json.error === 'origin not allowed' && !r.headers['access-control-allow-origin'], r.text);
r = await call('GET', '/token', { env: { ...ENV, AZURE_SPEECH_KEY: '' } });
check('没设语音的密钥：500', r.status === 500 && /AZURE_SPEECH_KEY/.test(r.json.error), r.text);
reply = () => new Response('nope', { status: 401 });
r = await call('GET', '/token');
check('Azure 不给令牌：502 azure 401', r.status === 502 && r.json.error === 'azure 401', r.text);
r = await call('OPTIONS', '/token');
check('/token 的预检照旧：204，只允许 GET，不多给别的头', r.status === 204 && r.headers['access-control-allow-methods'] === 'GET' && !r.headers['access-control-allow-headers'] && r.headers['access-control-max-age'] === '86400' && r.headers['access-control-allow-origin'] === SITE, JSON.stringify(r.headers));
r = await call('POST', '/token', { body: '{}' });
check('POST /token：404（和以前一样）', r.status === 404 && r.json.error === 'not found');
r = await call('GET', '/other');
check('别的路径：404', r.status === 404);

// ---------- POST /translate ----------
console.log('\n== POST /translate（微软翻译）');
r = await call('OPTIONS', '/translate');
check('/translate 的预检：204，允许 POST 和 Content-Type，只给这个网页', r.status === 204 && r.headers['access-control-allow-methods'] === 'POST' && /content-type/i.test(r.headers['access-control-allow-headers'] || '') && r.headers['access-control-allow-origin'] === SITE, JSON.stringify(r.headers));
r = await call('OPTIONS', '/translate', { origin: 'https://evil.example' });
check('别的网页的预检：403', r.status === 403 && !r.headers['access-control-allow-origin']);
azureCalls = [];
reply = () => azJson([{ translations: [{ text: '医疗保健由该地区负责。', to: 'zh-Hans' }] }, { translations: [{ text: '局势', to: 'zh-Hans' }] }]);
r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['Vården sköts av regionen.', 'läget'] }) });
check('翻译成功：200 { translations }，和 texts 一一对应', r.status === 200 && JSON.stringify(r.json) === JSON.stringify({ translations: ['医疗保健由该地区负责。', '局势'] }) && r.headers['access-control-allow-origin'] === SITE && r.headers['cache-control'] === 'no-store', r.text);
const ac = azureCalls[0] || {};
check('转给 Azure Translator：固定 sv → zh-Hans，带翻译的密钥和区域，内容是 [{ Text }]',
  azureCalls.length === 1 && ac.url === 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=sv&to=zh-Hans' && ac.method === 'POST'
  && ac.headers['Ocp-Apim-Subscription-Key'] === 'translator-secret-key' && ac.headers['Ocp-Apim-Subscription-Region'] === 'northeurope'
  && /^application\/json/.test(ac.headers['Content-Type']) && ac.body === JSON.stringify([{ Text: 'Vården sköts av regionen.' }, { Text: 'läget' }]), JSON.stringify({ ...ac, headers: Object.keys(ac.headers || {}) }));
r = await call('POST', '/translate', { origin: 'https://evil.example', body: JSON.stringify({ texts: ['hej'] }) });
check('别的网页：403，不转给 Azure', r.status === 403 && azureCalls.length === 1, r.text);
r = await call('POST', '/translate', { origin: '', body: JSON.stringify({ texts: ['hej'] }) });
check('没有 Origin（不是浏览器里的网页）：403', r.status === 403 && azureCalls.length === 1, r.text);

reply = () => azJson({ error: { code: 403001, message: 'The operation isn\'t allowed because the subscription has exceeded its free quota.' } }, 403);
r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['hej'] }) });
check('免费额度用完（Azure 403、403001）：429 { error: quota }', r.status === 429 && JSON.stringify(r.json) === '{"error":"quota"}' && r.headers['access-control-allow-origin'] === SITE, r.text);
for (const code of [429000, 429001, 429002]) {
  reply = () => azJson({ error: { code, message: 'The server rejected the request because the client has exceeded request limits.' } }, 429);
  r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['hej'] }) });
  check(`太频繁（Azure 429、${code}）：429 { error: busy }`, r.status === 429 && JSON.stringify(r.json) === '{"error":"busy"}', r.text);
}
reply = () => azJson({ error: { code: 403000, message: 'The operation isn\'t allowed.' } }, 403);
r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['hej'] }) });
check('别的 403（403000）：502，不当成额度用完', r.status === 502 && r.json.error === 'azure 403 403000', r.text);
reply = () => azJson({ error: { code: 401000, message: 'The request isn\'t authorized because credentials are missing or invalid.' } }, 401);
r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['hej'] }) });
check('密钥不对（Azure 401）：502 azure 401 401000', r.status === 502 && r.json.error === 'azure 401 401000', r.text);
reply = () => azJson({ error: { code: 503000, message: 'Service is temporarily unavailable.' } }, 503);
r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['hej'] }) });
check('Azure 暂时不可用（503）：502', r.status === 502 && r.json.error === 'azure 503 503000', r.text);
reply = () => { throw new TypeError('fetch failed'); };
r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['hej'] }) });
check('连不上 Azure：502', r.status === 502 && r.json.error === 'azure unreachable', r.text);
reply = () => azJson([{ translations: [] }]);
r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['hej'] }) });
check('Azure 的回答不对：502', r.status === 502 && r.json.error === 'azure bad reply', r.text);

// 上限
azureCalls = [];
reply = (url, init) => azJson(JSON.parse(init.body).map(() => ({ translations: [{ text: '好', to: 'zh-Hans' }] })));
r = await call('POST', '/translate', { body: JSON.stringify({ texts: Array(10).fill('hej') }) });
check('10 段：可以', r.status === 200 && r.json.translations.length === 10);
r = await call('POST', '/translate', { body: JSON.stringify({ texts: Array(11).fill('hej') }) });
check('11 段：400，不转给 Azure', r.status === 400 && azureCalls.length === 1, r.text);
r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['å'.repeat(600), 'ä'.repeat(400)] }) });
check('合计 1000 个字符：可以（按 Unicode 码位算）', r.status === 200, r.text);
r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['a'.repeat(600), 'b'.repeat(401)] }) });
check('合计 1001 个字符：413，不转给 Azure', r.status === 413 && azureCalls.length === 2, r.text);
r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['😀'.repeat(1000)] }) });
check('1000 个表情符号（2000 个 UTF-16 单位，但只有 1000 个码位）：可以', r.status === 200, r.text);
r = await call('POST', '/translate', { body: 'x'.repeat(20000) });
check('请求体太大：413', r.status === 413, r.text);
for (const [name, body] of [['空的 texts', { texts: [] }], ['不是数组', { texts: 'hej' }], ['有空字符串', { texts: ['hej', ' '] }], ['有数字', { texts: [1] }], ['没有 texts', {}]]) {
  r = await call('POST', '/translate', { body: JSON.stringify(body) });
  check(`${name}：400`, r.status === 400 && r.json.error === 'bad request', r.text);
}
r = await call('POST', '/translate', { body: '{not json' });
check('不是 JSON：400', r.status === 400, r.text);
r = await call('GET', '/translate');
check('GET /translate：404', r.status === 404);
r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['hej'] }), env: { ...ENV, AZURE_TRANSLATOR_KEY: '' } });
check('没设翻译的密钥：500', r.status === 500 && /AZURE_TRANSLATOR_KEY/.test(r.json.error), r.text);
check('超过上限、出错的请求都没有转给 Azure', azureCalls.length === 3, `${azureCalls.length} 次`);

// textType：'html'（查词选意思，查的词包在 <b> 里）转给 Azure 时加 &textType=html；'plain' 和不写一样；别的值 400
azureCalls = [];
reply = () => azJson([{ translations: [{ text: '这句 <b>没有</b> 新政府。', to: 'zh-Hans' }] }]);
r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['60 dagar <b>utan</b> ny regering'], textType: 'html' }) });
check('textType html：转给 Azure 时加 &textType=html，HTML 原样回来', r.status === 200 && r.json.translations[0] === '这句 <b>没有</b> 新政府。' && azureCalls[0] && azureCalls[0].url.endsWith('&from=sv&to=zh-Hans&textType=html'), azureCalls[0] && azureCalls[0].url);
r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['hej'], textType: 'plain' }) });
check('textType plain：和不写一样，不加 textType', r.status === 200 && azureCalls[1] && azureCalls[1].url.endsWith('&from=sv&to=zh-Hans'), azureCalls[1] && azureCalls[1].url);
r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['hej'], textType: 'xml' }) });
check('textType 是别的值：400，不转给 Azure', r.status === 400 && azureCalls.length === 2, r.text);

// 每个网络地址的上限（Cloudflare 的 Rate Limiting 绑定 TRANSLATE_LIMIT）：按网络地址、按「100 个字符一份」算；超了回 429 busy
const limitCalls = [];
let limitOk = true;
const ENV_L = { ...ENV, TRANSLATE_LIMIT: { limit: async (o) => { limitCalls.push(o); return { success: limitOk }; } } };
azureCalls = [];
reply = () => azJson([{ translations: [{ text: '好', to: 'zh-Hans' }] }]);
r = await call('POST', '/translate', { env: ENV_L, headers: { 'CF-Connecting-IP': '203.0.113.7' }, body: JSON.stringify({ texts: ['a'.repeat(250)] }) });
check('上限：没超，照常翻译；按网络地址算，250 个字符算 3 份', r.status === 200 && limitCalls.length === 1 && limitCalls[0].key === '203.0.113.7' && limitCalls[0].delta === 3, JSON.stringify(limitCalls));
limitOk = false;
r = await call('POST', '/translate', { env: ENV_L, headers: { 'CF-Connecting-IP': '203.0.113.7' }, body: JSON.stringify({ texts: ['hej'] }) });
check('上限：超了，429 { error: busy }，不转给 Azure', r.status === 429 && JSON.stringify(r.json) === '{"error":"busy"}' && azureCalls.length === 1 && limitCalls[1].delta === 1, r.text);
r = await call('POST', '/translate', { env: ENV_L, origin: 'https://evil.example', body: JSON.stringify({ texts: ['hej'] }) });
check('上限：别的网页在算上限以前就被拒（403）', r.status === 403 && limitCalls.length === 2, r.text);
r = await call('GET', '/token', { env: ENV_L });
check('上限：/token 不算', limitCalls.length === 2);
const ENV_LT = { ...ENV, TRANSLATE_LIMIT: { limit: async () => { throw new Error('binding down'); } } };
r = await call('POST', '/translate', { env: ENV_LT, body: JSON.stringify({ texts: ['hej'] }) });
check('上限：绑定出错时不拦（照常翻译）', r.status === 200, r.text);

// 没有 Content-Length 的大请求体：边读边数，超过 16 KB 就不再读，回 413
let pulled = 0;
const big = new ReadableStream({ pull(c) { pulled++; if (pulled > 200) { c.close(); return; } c.enqueue(new TextEncoder().encode('x'.repeat(1024))); } });
const reqBig = new Request('https://svenska-tts.example.workers.dev/translate', { method: 'POST', headers: { Origin: SITE, 'Content-Type': 'application/json' }, body: big, duplex: 'half' });
const resBig = await worker.fetch(reqBig, ENV);
check('没有 Content-Length 的大请求体：读到 16 KB 就停，413（没有整个读进来）', resBig.status === 413 && pulled < 40, `读了 ${pulled} 块（每块 1 KB）`);

// 不回显文字和密钥
const SECRET_TEXT = 'Hemlig mening om Gävle';
const seen = [];
for (const mk of [
  () => azJson([{ translations: [{ text: '秘密', to: 'zh-Hans' }] }]),
  () => azJson({ error: { code: 403001, message: 'quota ' + SECRET_TEXT } }, 403),
  () => azJson({ error: { code: 400000, message: 'bad ' + SECRET_TEXT } }, 400),
  () => azJson({ error: { code: 429001, message: SECRET_TEXT } }, 429),
]) {
  reply = mk;
  seen.push((await call('POST', '/translate', { body: JSON.stringify({ texts: [SECRET_TEXT] }) })).text);
}
seen.push((await call('POST', '/translate', { body: JSON.stringify({ texts: [SECRET_TEXT, ...Array(10).fill('x')] }) })).text);
check('回答里没有要翻译的文字，也没有密钥', seen.every((t) => !t.includes(SECRET_TEXT) && !t.includes('Gävle') && !t.includes('secret-key')), seen.join(' | '));
// ---------- POST /translate/en：英语，其他和 /translate 一样 ----------
console.log('\n== POST /translate/en（英语读报：从英语翻，别的和 /translate 一样）');
azureCalls = [];
reply = () => azJson([{ translations: [{ text: '你好', to: 'zh-Hans' }] }]);
r = await call('POST', '/translate/en', { body: JSON.stringify({ texts: ['Hello'] }) });
const acEn = azureCalls[0];
check('/translate/en：转给 Azure 时 from=en（目标还是简体中文），带同样的密钥、区域，回 { translations }',
  r.status === 200 && r.json.translations[0] === '你好' && acEn && acEn.url === 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=zh-Hans'
  && acEn.headers['Ocp-Apim-Subscription-Key'] === 'translator-secret-key' && acEn.headers['Ocp-Apim-Subscription-Region'] === 'northeurope', JSON.stringify(acEn && acEn.url));
azureCalls = [];
r = await call('POST', '/translate', { body: JSON.stringify({ texts: ['Hej'] }) });
check('/translate 照旧是 from=sv（瑞典语一点没变）', r.status === 200 && azureCalls[0] && azureCalls[0].url === 'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=sv&to=zh-Hans', azureCalls[0] && azureCalls[0].url);
azureCalls = [];
r = await call('POST', '/translate/en', { body: JSON.stringify({ texts: ['<b>Hello</b> world'], textType: 'html' }) });
check('/translate/en：textType html 也一样', r.status === 200 && azureCalls[0] && azureCalls[0].url.endsWith('&from=en&to=zh-Hans&textType=html'), azureCalls[0] && azureCalls[0].url);
r = await call('OPTIONS', '/translate/en');
check('/translate/en 的预检：和 /translate 一样允许 POST、Content-Type', r.status === 204 && r.headers['access-control-allow-methods'] === 'POST' && r.headers['access-control-allow-headers'] === 'Content-Type', JSON.stringify(r.headers));
azureCalls = [];
const rOther = await call('POST', '/translate/fr', { body: JSON.stringify({ texts: ['Bonjour'] }) });
const rOther2 = await call('POST', '/translate/', { body: JSON.stringify({ texts: ['Hej'] }) });
check('别的语言（/translate/fr）、/translate/ 都是 404，不去问 Azure', rOther.status === 404 && rOther2.status === 404 && !azureCalls.length, `${rOther.status} ${rOther2.status}`);
r = await call('POST', '/translate/en', { origin: 'https://evil.example', body: JSON.stringify({ texts: ['Hello'] }) });
check('/translate/en：别的网页 403', r.status === 403, r.text);
reply = () => azJson({ error: { code: 403001, message: 'quota' } }, 403);
r = await call('POST', '/translate/en', { body: JSON.stringify({ texts: ['Hello'] }) });
const rBusy = await (async () => { reply = () => azJson({ error: { code: 429001 } }, 429); return call('POST', '/translate/en', { body: JSON.stringify({ texts: ['Hello'] }) }); })();
check('/translate/en：免费额度用完回 429 quota，太频繁回 429 busy（和瑞典语一样）', r.status === 429 && r.json.error === 'quota' && rBusy.status === 429 && rBusy.json.error === 'busy', `${r.text} ${rBusy.text}`);
r = await call('POST', '/translate/en', { body: JSON.stringify({ texts: ['x'.repeat(1001)] }) });
check('/translate/en：同样的上限（合计 1000 个字符）', r.status === 413, r.text);
const limitEn = [];
const ENV_LEN = { ...ENV, TRANSLATE_LIMIT: { limit: async (o) => { limitEn.push(o); return { success: false }; } } };
reply = () => azJson([{ translations: [{ text: '你好', to: 'zh-Hans' }] }]);
r = await call('POST', '/translate/en', { env: ENV_LEN, body: JSON.stringify({ texts: ['Hello'] }) });
check('/translate/en：和瑞典语共用每个网络地址的上限（同一个绑定），超了 429 busy', r.status === 429 && r.json.error === 'busy' && limitEn.length === 1, JSON.stringify(limitEn));

// ---------- GET /feed、/page：新闻代理（只认写好的源） ----------
console.log('\n== GET /feed、/page（新闻代理：只认写好的源，不带 Origin，缓存，最多 2 MB）');
const RSS = (n) => '<?xml version="1.0"?><rss><channel>' + Array.from({ length: n }, (_, i) => `<item><title>T${i}</title><description>${'x'.repeat(200)}</description></item>`).join('') + '</channel></rss>';
azureCalls = [];
reply = () => new Response(RSS(3), { status: 200, headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
r = await call('GET', '/feed?src=hk-isd');
check('/feed：允许的网页、写好的源：原样转回 RSS（200），只给这个网页，浏览器缓存 15 分钟，不猜类型，沙箱（脚本不运行）',
  r.status === 200 && r.text === RSS(3) && r.headers['access-control-allow-origin'] === SITE && r.headers.vary === 'Origin' && r.headers['cache-control'] === 'public, max-age=900'
  && r.headers['x-content-type-options'] === 'nosniff' && /sandbox/.test(r.headers['content-security-policy']) && r.headers['content-type'] === 'application/xml; charset=utf-8', JSON.stringify(r.headers));
check('/feed：向新闻网站要的是写好的地址，GET，不带 Origin、Cookie、Referer，User-Agent 是本站的说明',
  azureCalls.length === 1 && azureCalls[0].url === 'https://www.info.gov.hk/gia/rss/general_en.xml' && azureCalls[0].method === 'GET'
  && !Object.keys(azureCalls[0].headers).some((k) => /^(origin|cookie|referer)$/i.test(k)) && /SvenskaReader/.test(azureCalls[0].headers['User-Agent']), JSON.stringify(azureCalls[0] && azureCalls[0].headers));
azureCalls = [];
r = await call('GET', '/feed?src=evil');
const r2 = await call('GET', '/feed?src=' + encodeURIComponent('https://evil.example/rss'));
const r3 = await call('GET', '/feed?src=__proto__');
check('/feed：没写的源（包括直接写网址、__proto__）回 404，不去取', r.status === 404 && r2.status === 404 && r3.status === 404 && r.json.error === 'unknown source' && !azureCalls.length, `${r.status} ${r2.status} ${r3.status}`);
r = await call('GET', '/feed?src=hk-isd', { origin: 'https://evil.example' });
const rNo = await call('GET', '/feed?src=hk-isd', { origin: '' });
check('/feed：别的网页（或者没有 Origin）回 403，不去取', r.status === 403 && rNo.status === 403 && !azureCalls.length, `${r.status} ${rNo.status}`);
r = await call('GET', '/page?src=hk-isd&p=/gia/general/202611/14/P2026111400001.htm');
check('/page：没有写网页规则的源回 400，不去取', r.status === 400 && r.json.error === 'path not allowed' && !azureCalls.length, r.text);
reply = () => new Response('nope', { status: 403 });
r = await call('GET', '/feed?src=hk-isd');
check('/feed：新闻网站回 403：502 { error: "upstream 403" }（不转它的内容）', r.status === 502 && r.json.error === 'upstream 403' && !r.text.includes('nope'), r.text);
azureCalls = [];
reply = () => new Response(RSS(1), { status: 200 });
const rNeg = await call('GET', '/feed?src=hk-isd');
const rNegOther = await call('GET', '/feed?src=za-sanews');
check('/feed：出错的地址 90 秒里不再去问（还是 502 upstream 403）；别的源照常', rNeg.status === 502 && rNeg.json.error === 'upstream 403' && rNegOther.status === 200 && azureCalls.length === 1 && /sanews/.test(azureCalls[0].url), JSON.stringify({ neg: rNeg.text, calls: azureCalls.map((c) => c.url) }));
later();
azureCalls = [];
r = await call('GET', '/feed?src=hk-isd');
check('/feed：过了 90 秒再去问', r.status === 200 && azureCalls.length === 1, r.text.slice(0, 60));
later();
reply = () => { throw new TypeError('fetch failed'); };
r = await call('GET', '/feed?src=hk-isd');
check('/feed：连不上新闻网站：502 upstream unreachable', r.status === 502 && r.json.error === 'upstream unreachable', r.text);
azureCalls = [];
reply = () => new Response(null, { status: 302, headers: { Location: 'https://evil.example/rss.xml' } });
r = await call('GET', '/feed?src=hk-isd');
check('/feed：跳转到别的网站：不跟，502', r.status === 502 && r.json.error === 'redirect not allowed' && azureCalls.length === 1, r.text);
later();
azureCalls = [];
let hop = 0;
reply = () => (hop++ === 0 ? new Response(null, { status: 301, headers: { Location: '/gia/rss/general_en_v2.xml' } }) : new Response(RSS(1), { status: 200, headers: { 'Content-Type': 'text/xml' } }));
r = await call('GET', '/feed?src=hk-isd');
check('/feed：跳转到同一个网站上：跟过去（最多 3 次）', r.status === 200 && azureCalls.length === 2 && azureCalls[1].url === 'https://www.info.gov.hk/gia/rss/general_en_v2.xml', JSON.stringify(azureCalls.map((c) => c.url)));
reply = () => new Response(RSS(12000), { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
r = await call('GET', '/feed?src=hk-isd');
check('/feed：太大的 RSS（约 3 MB）截到 2 MB 以内、最后一个完整的条目，补上结尾，还是能解析的 RSS', r.status === 200 && r.text.length <= 2 * 1024 * 1024 + 40 && /<\/item>\s*<\/channel><\/rss>\s*$/.test(r.text) && r.headers['x-sv-truncated'] === '1',
  `${r.text.length} 字节，结尾：${JSON.stringify(r.text.slice(-40))}`);
// Cloudflare 的缓存（假的 caches.default）：第二次不去新闻网站
const store = new Map();
globalThis.caches = { default: { match: async (k) => { const v = store.get(k.url); return v ? new Response(v.body, { headers: v.headers }) : undefined; }, put: async (k, res) => { store.set(k.url, { body: await res.arrayBuffer(), headers: Object.fromEntries(res.headers) }); } } };
azureCalls = [];
reply = () => new Response(RSS(2), { status: 200, headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' } });
const c1 = await call('GET', '/feed?src=hk-isd');
const c2 = await call('GET', '/feed?src=hk-isd', { origin: 'http://127.0.0.1:8123' });
const cached = store.get('https://news.invalid/hk-isd/feed');
check('/feed：放进 Cloudflare 的缓存（30 分钟，不带哪个网页的 CORS），第二次（别的网页）直接从缓存给、带它自己的 CORS',
  c1.status === 200 && c2.status === 200 && c2.text === RSS(2) && azureCalls.length === 1 && cached && cached.headers['cache-control'] === 'public, max-age=1800' && !cached.headers['access-control-allow-origin']
  && c2.headers['access-control-allow-origin'] === 'http://127.0.0.1:8123', JSON.stringify({ calls: azureCalls.length, cached: cached && cached.headers }));
delete globalThis.caches;
// /page：只取这个源的网站上、路径合规则的网页
azureCalls = [];
reply = () => new Response('<html><main><section><p>Hello</p></section></main></html>', { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
const okP = '/n1/daily-quotidien/261113/dq261113a-eng.htm';
r = await call('GET', '/page?src=ca-statcan&p=' + encodeURIComponent(okP));
check('/page：合规则的路径：取这个源的网站上的网页（https、写好的网站），原样转回（text/html，沙箱）',
  r.status === 200 && r.text.includes('Hello') && azureCalls.length === 1 && azureCalls[0].url === 'https://www150.statcan.gc.ca' + okP && r.headers['content-type'] === 'text/html; charset=utf-8' && /sandbox/.test(r.headers['content-security-policy']), JSON.stringify({ url: azureCalls[0] && azureCalls[0].url, ct: r.headers['content-type'] }));
check('/page：User-Agent 里没有「://」（印度政府新闻局的防火墙看到就回 403）', !/:\/\//.test(azureCalls[0].headers['User-Agent']), azureCalls[0].headers['User-Agent']);
azureCalls = [];
const bad = ['/n1/daily-quotidien/../../etc/passwd', '//evil.example/x', 'https://evil.example/n1/daily-quotidien/261113/dq261113a-eng.htm', '/n1/daily-quotidien/261113/dq261113a-eng.htm/../x',
  '/n1/daily-quotidien/%2e%2e/x', '/n1/other/261113/dq261113a-eng.htm', '/n1/daily-quotidien/261113/dq261113a-eng.htm?x=1', '/n1\daily-quotidien/261113/dq261113a-eng.htm', '/n1/daily-quotidien/261113/dq261113a-eng.htm ', ''];
const badRes = [];
for (const b of bad) badRes.push((await call('GET', '/page?src=ca-statcan&p=' + encodeURIComponent(b))).status);
const noP = await call('GET', '/page?src=ca-statcan');
check('/page：不合规则的路径（..、//、整个网址、别的路径、带参数、编码过的 ..、反斜杠、空白、空）都回 400，不去取', badRes.every((x) => x === 400) && noP.status === 400 && !azureCalls.length, badRes.join(' '));
azureCalls = [];
r = await call('GET', '/page?src=in-pib&p=' + encodeURIComponent('/PressReleaseIframePage.aspx?PRID=2190001&reg=3&lang=1'));
const rPib2 = await call('GET', '/page?src=in-pib&p=' + encodeURIComponent('/PressReleaseIframePage.aspx?PRID=2190001&reg=3&lang=2'));
check('/page：带参数的规则也要整个合（PIB 只要英文的 reg=3&lang=1）', r.status === 200 && rPib2.status === 400 && azureCalls.length === 1 && azureCalls[0].url === 'https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=2190001&reg=3&lang=1', `${r.status} ${rPib2.status}`);
azureCalls = [];
reply = () => new Response(null, { status: 301, headers: { Location: 'https://www150.statcan.gc.ca/n1/en/catalogue/xyz' } });
r = await call('GET', '/page?src=ca-statcan&p=' + encodeURIComponent(okP));
check('/page：跳转到同一个网站上、但不合规则的路径：不跟，502', r.status === 502 && r.json.error === 'redirect not allowed' && azureCalls.length === 1, r.text);
later();
reply = () => new Response('<html><head><META NAME="robots"></head><body><script src="/_Incapsula_Resource?x=1"></script></body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } });
r = await call('GET', '/feed?src=nz-beehive');
check('/feed：Incapsula 的验证页（状态码 200 的一小段 HTML）当作被挡了：502 upstream blocked，不转', r.status === 502 && r.json.error === 'upstream blocked', r.text);
later();
// 期限包括读内容：一点一点慢慢给（每 100 毫秒一个字节）的网站，到期限就放弃，504
const enc = new TextEncoder();
const ENV_FAST = { ...ENV, NEWS_TIMEOUT_MS: '400' };
let dripTimer = null;
reply = () => new Response(new ReadableStream({
  start(c) { c.enqueue(enc.encode('<?xml version="1.0"?><rss><channel>')); },
  pull(c) { return new Promise((res) => { dripTimer = setTimeout(() => { c.enqueue(enc.encode('x')); res(); }, 100); }); },
  cancel() { clearTimeout(dripTimer); },
}), { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
let t0 = realNow();
r = await call('GET', '/feed?src=za-sanews', { env: ENV_FAST });
let took = realNow() - t0;
check('/feed：一点一点慢慢给的网站：期限（这里 0.4 秒）到了就放弃，504 upstream timeout（期限包括读内容）', r.status === 504 && r.json.error === 'upstream timeout' && took < 2000, `${r.status} ${r.text} ${took} 毫秒`);
azureCalls = [];
t0 = realNow();
r = await call('GET', '/feed?src=za-sanews', { env: ENV_FAST });
check('/feed：超时也记 90 秒：同一个地址再来，马上回 504 upstream timeout，不再去等', r.status === 504 && r.json.error === 'upstream timeout' && !azureCalls.length && realNow() - t0 < 200, `${r.status} ${r.text} ${azureCalls.length}`);
later();
// 连接（回答的头）一直不来：同一个期限
reply = (u, init) => new Promise((_, rej) => { init.signal.addEventListener('abort', () => { const e = new Error('aborted'); e.name = 'AbortError'; rej(e); }); });
t0 = realNow();
r = await call('GET', '/feed?src=za-sanews', { env: ENV_FAST });
took = realNow() - t0;
check('/feed：新闻网站一直不回答：到期限 504 upstream timeout', r.status === 504 && r.json.error === 'upstream timeout' && took < 2000, `${r.status} ${r.text} ${took} 毫秒`);
later();
// 每个网络地址的上限（假的 NEWS_LIMIT 绑定）：按网络地址，超了 429 busy，不去取；缓存里有的也算
const newsLimit = [];
let newsLimitOk = true;
const ENV_NL = { ...ENV, NEWS_LIMIT: { limit: async (o) => { newsLimit.push(o); return { success: newsLimitOk }; } } };
azureCalls = [];
reply = () => new Response(RSS(1), { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
r = await call('GET', '/feed?src=za-sanews', { env: ENV_NL, headers: { 'CF-Connecting-IP': '198.51.100.7' } });
newsLimitOk = false;
const rLim = await call('GET', '/page?src=ca-statcan&p=' + encodeURIComponent('/n1/daily-quotidien/261113/dq261113a-eng.htm'), { env: ENV_NL, headers: { 'CF-Connecting-IP': '198.51.100.7' } });
check('/feed、/page：每个网络地址的上限（NEWS_LIMIT 绑定，按 CF-Connecting-IP），超了 429 busy、不去取',
  r.status === 200 && rLim.status === 429 && rLim.json.error === 'busy' && azureCalls.length === 1 && newsLimit.length === 2 && newsLimit.every((o) => o.key === '198.51.100.7'), JSON.stringify(newsLimit));
const ENV_NLX = { ...ENV, NEWS_LIMIT: { limit: async () => { throw new Error('binding down'); } } };
r = await call('GET', '/feed?src=za-sanews', { env: ENV_NLX });
check('/feed：上限的绑定出错时不拦（和 /translate 一样）', r.status === 200, r.text.slice(0, 40));
// 缓存的键是合成的（https://news.invalid/<源>/<feed|page><路径>），新闻网站出错也放一份（90 秒）
const store2 = new Map();
globalThis.caches = { default: { match: async (k) => { const v = store2.get(k.url); return v ? new Response(v.body, { headers: v.headers }) : undefined; }, put: async (k, res) => { store2.set(k.url, { body: await res.arrayBuffer(), headers: Object.fromEntries(res.headers) }); } } };
later();
reply = () => new Response(RSS(1), { status: 200, headers: { 'Content-Type': 'application/rss+xml' } });
await call('GET', '/page?src=in-pib&p=' + encodeURIComponent('/PressReleaseIframePage.aspx?PRID=2190002&reg=3&lang=1'));
reply = () => new Response('busy', { status: 503 });
await call('GET', '/feed?src=nz-beehive');
const keys = [...store2.keys()];
const negE = store2.get('https://news.invalid/nz-beehive/feed');
check('缓存的键是合成的（不是新闻网站的地址）；新闻网站出错时放一份 90 秒的「出错」',
  keys.includes('https://news.invalid/in-pib/page/PressReleaseIframePage.aspx?PRID=2190002&reg=3&lang=1') && keys.every((k) => k.startsWith('https://news.invalid/'))
  && negE && negE.headers['cache-control'] === 'public, max-age=90' && negE.headers['x-sv-error'] === '1', JSON.stringify(keys));
later(); // 内存里记的过期了，Cache API 里那一份（假的不会过期）还在：从缓存回 502，不去取
azureCalls = [];
r = await call('GET', '/feed?src=nz-beehive');
check('Cache API 里有「出错」时（别的 isolate 记下的）：回 502 同样的错误，不去取', r.status === 502 && r.json.error === 'upstream 503' && !azureCalls.length, r.text);
delete globalThis.caches;
r = await call('OPTIONS', '/feed?src=hk-isd');
check('/feed 的预检（OPTIONS）：只允许 GET（和 /token 一样）', r.status === 204 && r.headers['access-control-allow-methods'] === 'GET', JSON.stringify(r.headers));
check('Worker 没有写任何日志', !logs.length, logs.join(' | '));

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过。`);
process.exit(failed.length ? 1 : 0);
