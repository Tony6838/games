// 检查云端服务（tools/tts-worker/worker.js，Cloudflare Worker）：不联网，用 Node 自己的 Request / Response，
// 把 Worker 向 Azure 发的请求换成假的，看它怎么回答网页。
//   node tests/worker_check.mjs
// 1. GET /token 和以前完全一样（云端语音在用）：允许的网页拿到 { token, region }，别的网页 403，没设密钥 500，
//    Azure 不给令牌 502；预检（OPTIONS）照旧只允许 GET。
// 2. POST /translate：只给允许的网页；预检允许 POST 和 Content-Type；转给 Azure Translator 时语言固定（sv → zh-Hans），
//    带密钥和区域；免费额度用完（Azure 403、403001）回 429 quota，限流（Azure 429）回 429 busy，别的错误 502；
//    一次最多 10 段、合计 1000 个字符；textType html；每个网络地址的上限（假的绑定）；没有 Content-Length 的大请求体边读边停；
//    回答和日志里都没有要翻译的文字和密钥。
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
check('Worker 没有写任何日志', !logs.length, logs.join(' | '));

const failed = results.filter((x) => !x.ok);
console.log(`\n${results.length - failed.length}/${results.length} 项通过。`);
process.exit(failed.length ? 1 : 0);
