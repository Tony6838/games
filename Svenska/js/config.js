/* 站点设置。
   ttsUrl：云端自然语音的令牌服务，就是 Tony 的 Cloudflare Worker（代码在 tools/tts-worker，设置步骤见 README「云端语音」），
   例如 'https://svenska-tts.xxx.workers.dev'。空着时只用本机的声音。Worker 只发 Azure 语音的临时令牌，密钥不在这里。
   translateUrl：微软翻译（Azure Translator）的转发服务，就是同一个 Worker 的 /translate（见 README「翻译」）。
   不设时跟着 ttsUrl 走（ttsUrl + '/translate'）；空着时不用微软翻译，查词、翻译一句直接用浏览器内置翻译或 MyMemory。
   translateLangs：Worker 会翻哪些语言（瑞典语走 /translate，英语走 /translate/en）。部署了的 Worker 还没有 /translate/en 时，
   英语查词问它会失败（浏览器的预检不通过），这一次改用浏览器内置翻译、MyMemory，30 秒以后再试（和微软翻译连不上时一样）。
   feedProxy：部署了的 Worker 有没有新闻代理 GET /feed、/page（几个没有 CORS 的英文新闻源由它转一下，见 js/adapters.js）。
   Worker 部署了（2026-11-14，版本 44aca100），是 true；改成 false 时那几个源不取（话题里少了它们的文章，页面上不说）。
   newsUrl：新闻代理的地址，不写就是 ttsUrl（同一个 Worker）。测试用它把新闻代理和假的云端语音分开。
   测试可以在页面脚本之前设 window.SV_CONFIG 来改这些值。 */
(function () {
  'use strict';
  const SV = window.SV;
  const own = window.SV_CONFIG || {};
  const conf = Object.assign({
    ttsUrl: 'https://svenska-tts.tony6838.workers.dev',
    translateLangs: ['sv', 'en'],
    feedProxy: true,
  }, own);
  if (!Object.prototype.hasOwnProperty.call(own, 'translateUrl')) {
    conf.translateUrl = conf.ttsUrl ? String(conf.ttsUrl).replace(/\/+$/, '') + '/translate' : '';
  }
  SV.config = conf;
})();
