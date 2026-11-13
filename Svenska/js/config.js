/* 站点设置。
   ttsUrl：云端自然语音的令牌服务，就是 Tony 的 Cloudflare Worker（代码在 tools/tts-worker，设置步骤见 README「云端语音」），
   例如 'https://svenska-tts.xxx.workers.dev'。空着时只用本机的声音。Worker 只发 Azure 语音的临时令牌，密钥不在这里。
   translateUrl：微软翻译（Azure Translator）的转发服务，就是同一个 Worker 的 /translate（见 README「翻译」）。
   不设时跟着 ttsUrl 走（ttsUrl + '/translate'）；空着时不用微软翻译，查词、翻译一句直接用浏览器内置翻译或 MyMemory。
   测试可以在页面脚本之前设 window.SV_CONFIG 来改这些值。 */
(function () {
  'use strict';
  const SV = window.SV;
  const own = window.SV_CONFIG || {};
  const conf = Object.assign({
    ttsUrl: 'https://svenska-tts.tony6838.workers.dev',
  }, own);
  if (!Object.prototype.hasOwnProperty.call(own, 'translateUrl')) {
    conf.translateUrl = conf.ttsUrl ? String(conf.ttsUrl).replace(/\/+$/, '') + '/translate' : '';
  }
  SV.config = conf;
})();
