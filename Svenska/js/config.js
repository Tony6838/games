/* 站点设置。
   ttsUrl：云端自然语音的令牌服务，就是 Tony 的 Cloudflare Worker（代码在 tools/tts-worker，设置步骤见 README「云端语音」），
   例如 'https://svenska-tts.xxx.workers.dev'。空着时只用本机的声音。Worker 只发 Azure 语音的临时令牌，密钥不在这里。
   测试可以在页面脚本之前设 window.SV_CONFIG 来改这些值。 */
(function () {
  'use strict';
  const SV = window.SV;
  SV.config = Object.assign({
    ttsUrl: '',
  }, window.SV_CONFIG || {});
})();
