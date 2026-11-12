// 《瑞典语读报》的云端语音令牌服务（Cloudflare Worker）。
// 网页（js/cloudtts.js）来要一个微软 Azure 语音服务的临时令牌（10 分钟有效），拿它直接向 Azure 合成声音。
// Azure 的密钥只在这里（Cloudflare 的机密变量 AZURE_SPEECH_KEY），不在网页、也不在 GitHub 上。
//
// 变量（Cloudflare 控制台 → 这个 Worker → Settings → Variables and Secrets）：
//   AZURE_SPEECH_KEY     机密（Secret）：Azure 语音资源的「密钥 1」
//   AZURE_SPEECH_REGION  普通变量：Azure 语音资源的区域，例如 northeurope、westeurope、swedencentral
//   ALLOWED_ORIGINS      普通变量，可以不设：允许的网页来源，逗号分开；默认 https://tony6838.github.io
//
// 只回答 GET /token，返回 { token, region }。只给允许的网页（看 Origin），本机测试（http://127.0.0.1、localhost）也允许。
// Origin 在浏览器外可以伪造，所以真正的保护是 Azure 用免费档（F0）：额度用完就停，不会扣钱。
export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const allowed = (env.ALLOWED_ORIGINS || 'https://tony6838.github.io').split(',').map((s) => s.trim()).filter(Boolean);
    const ok = allowed.includes(origin) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin);
    const cors = ok ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : { Vary: 'Origin' };
    const json = (obj, status = 200) => new Response(JSON.stringify(obj), {
      status, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });

    if (req.method === 'OPTIONS') {
      return new Response(null, { status: ok ? 204 : 403, headers: { ...cors, 'Access-Control-Allow-Methods': 'GET', 'Access-Control-Max-Age': '86400' } });
    }
    const url = new URL(req.url);
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
