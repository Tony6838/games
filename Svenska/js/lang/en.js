/* 英语（美国国旗，美国口音 en-US；文章来自各个说英语的国家）。Tony 定的，2026-11-14：一个英语版，美国国旗、美式发音。
   源（sources）：许可允许转载的英文网站，每篇的许可简称在文章开头一行，点它是许可要求写明的整句（js/app.js 的 metaLine）。
   - 浏览器直接取（有 CORS）：GOV.UK（Open Government Licence v3.0）、NASA（美国政府作品）、KFF Health News（CC BY-NC-ND 4.0）、
     Global Voices（CC BY 3.0）、欧盟委员会新闻室（CC BY 4.0）、ESO、ESA/Webb（CC BY 4.0）、eLife digests（CC BY 4.0）、
     维基百科首页（CC BY-SA 4.0）、Simple English Wikipedia（CC BY-SA 4.0）。
   - 经过 Worker 的新闻代理（proxy：Worker 里 NEWS_SOURCES 的名字；js/config.js 的 feedProxy 是 true 才取）：新西兰政府、
     南非政府新闻社、香港政府、加拿大政府、印度政府新闻局、Frontiers for Young Minds。（加拿大统计局关着，见下面 statcan。）
   不用：The Conversation、The Guardian、BBC、NPR、AP、ProPublica（条款不允许，或者只给标题）；Carbon Brief（要「完整、不改」
   地转载，图表转不了）。加一个源：在 sources 里加一项（adapter 是 js/adapters.js 的取法），在话题的 feeds 里写上它的名字。 */
(function () {
  'use strict';
  const SV = window.SV;

  const FLAG_US = '<svg viewBox="0 0 19 10" aria-hidden="true"><rect width="19" height="10" fill="#b22234"/>' +
    '<path d="M0 1.15h19M0 2.69h19M0 4.23h19M0 5.77h19M0 7.31h19M0 8.85h19" stroke="#fff" stroke-width=".77"/>' +
    '<rect width="7.6" height="5.38" fill="#3c3b6e"/>' +
    '<g fill="#fff"><circle cx="1.3" cy="1" r=".38"/><circle cx="3.1" cy="1" r=".38"/><circle cx="4.9" cy="1" r=".38"/><circle cx="6.7" cy="1" r=".38"/>' +
    '<circle cx="2.2" cy="2.1" r=".38"/><circle cx="4" cy="2.1" r=".38"/><circle cx="5.8" cy="2.1" r=".38"/>' +
    '<circle cx="1.3" cy="3.2" r=".38"/><circle cx="3.1" cy="3.2" r=".38"/><circle cx="4.9" cy="3.2" r=".38"/><circle cx="6.7" cy="3.2" r=".38"/>' +
    '<circle cx="2.2" cy="4.3" r=".38"/><circle cx="4" cy="4.3" r=".38"/><circle cx="5.8" cy="4.3" r=".38"/></g></svg>';

  // 许可：short 是文章开头一行的简称（一个按钮），statement 是许可要求写的整句（点简称打开的「来源和许可」里），url 是许可的网址
  const CC = (v, url, statement) => ({ short: v, text: v, url, statement: statement || 'Licensed under ' + v + '.' });
  const CC_BY_NC_ND = 'https://creativecommons.org/licenses/by-nc-nd/4.0/';
  const CC_BY_4 = 'https://creativecommons.org/licenses/by/4.0/';
  // 每个源：adapter（js/adapters.js 的取法）、name（文章开头一行写的来源）、short（很窄的手机上）、zh（中文说明）、
  // license（许可：short 是开头一行的简称，statement 是点它看到的整句）、note（中文说明，比如只转了文字）
  const sources = {
    govuk: {
      adapter: 'govuk', name: 'GOV.UK', zh: '英国政府网站', count: 60,
      license: { short: 'OGL v3', text: 'Open Government Licence v3.0', url: 'https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/', statement: 'Contains public sector information licensed under the Open Government Licence v3.0.' },
    },
    nasa: {
      adapter: 'wp', name: 'NASA', zh: '美国国家航空航天局', base: 'https://www.nasa.gov', path: 'press-release', count: 20, lang: 'en',
      program: 'NASA News Release', license: { short: 'Public domain', text: 'NASA (public domain)', url: 'https://www.nasa.gov/nasa-brand-center/images-and-media/', statement: 'Credit: NASA. NASA text is not subject to copyright in the United States; images are not reproduced here.' },
      skip: /^(-end-|Media Contact|Contacts?:?$)/i, stop: /^(-end-|###)$/i,
    },
    nasaStories: {
      adapter: 'wp', name: 'NASA', zh: '美国国家航空航天局', base: 'https://www.nasa.gov', path: 'posts', count: 20, lang: 'en',
      program: 'NASA', license: { short: 'Public domain', text: 'NASA (public domain)', url: 'https://www.nasa.gov/nasa-brand-center/images-and-media/', statement: 'Credit: NASA. NASA text is not subject to copyright in the United States; images are not reproduced here.' },
      skip: /^(Share|Details|Last Updated|Editor|Contact|Location|Related Terms|Explore More|Keep Exploring)\b/i,
    },
    kff: {
      adapter: 'wp', name: 'KFF Health News', short: 'KFF', zh: '美国的医疗新闻编辑部（KFF）', base: 'https://kffhealthnews.org', count: 20, lang: 'en',
      author: 'yoast', typeField: 'content-types', skipTypes: [439533110, 439532974, 439532754, 439530901, 439530844, 439530843, 439530842, 439531946, 439530968],
      remove: '.wp-block-kff-shared-article-hero, .wp-block-kff-shared-related-stories, .wp-block-kff-shared-newsletter-signup, .wp-block-kff-shared-republish-button',
      rejectText: /All Rights Reserved/i, keepLinks: true, maxLinkShare: 0.3, tables: 'text', captions: true,
      lazy: true, // 有的文章里有十几 MB 的互动图表脚本：列表只要标题和摘要，列出来的几篇再取正文
      skipTitle: /^(Listen to|Watch|Hear )|Health News Minute|Reporters Discuss/i, // 播客、记者上节目的汇编
      license: CC('CC BY-NC-ND 4.0', CC_BY_NC_ND, 'Republished from KFF Health News under CC BY-NC-ND 4.0: the story text unedited, with all story links; tables as text; photos and graphics not reproduced (their captions are kept as text).'),
      note: '照片、图表没有转载（说明照登成文字），请看原文。',
      tagline: 'KFF Health News is a national newsroom that produces in-depth journalism about health issues and is one of the core operating programs at KFF — the independent source for health policy research, polling, and journalism.',
    },
    gv: {
      adapter: 'wp', name: 'Global Voices', short: 'GV', zh: '世界各地的公民报道', base: 'https://globalvoices.org', count: 20, lang: 'en', author: 'yoast',
      lazy: true, // 文章里常有嵌进来的推文、视频：和 KFF 一样只取列出来的几篇的正文
      remove: '.gv-translations, .wp-caption, .gv-promo, .sharedaddy', skip: /^(Read more|Subscribe|Start the conversation)\b/i,
      license: CC('CC BY 3.0', 'https://creativecommons.org/licenses/by/3.0/', 'Republished from Global Voices under CC BY 3.0; text only (images and embedded media not reproduced).'),
    },
    ec: {
      adapter: 'ec', name: 'European Commission', short: 'EU Commission', zh: '欧盟委员会新闻室（新闻稿、讲话、声明）', count: 16,
      license: CC('CC BY 4.0', CC_BY_4, 'Reused under CC BY 4.0; text only (images and attachments not reproduced; tables as text).'), note: '只转了文字（图片、附件没有转载）。',
    },
    eso: {
      adapter: 'djangoplicity', url: 'https://www.eso.org/public/news/feed/', name: 'ESO', zh: '欧洲南方天文台', program: 'ESO Press Release', count: 6,
      license: CC('CC BY 4.0', CC_BY_4, 'Credit: ESO. CC BY 4.0; text only (images and videos not reproduced).'), note: '只转了新闻稿的文字（图片、视频没有转载）。',
    },
    webb: {
      adapter: 'djangoplicity', url: 'https://esawebb.org/news/feed/', name: 'ESA/Webb', zh: '欧洲空间局的韦布太空望远镜', program: 'ESA/Webb Release', count: 6,
      license: CC('CC BY 4.0', CC_BY_4, 'Credit: ESA/Webb. CC BY 4.0; text only (images and videos not reproduced).'), note: '只转了新闻稿的文字（图片、视频没有转载）。',
    },
    elife: {
      adapter: 'elife', name: 'eLife', zh: '生命科学期刊 eLife 给一般读者写的简讯', program: 'eLife digest', count: 8,
      license: CC('CC BY 4.0', CC_BY_4, 'eLife digest, CC BY 4.0.'),
    },
    // ---- 没有 CORS、经过 Worker 的新闻代理（proxy 是 Worker 里 NEWS_SOURCES 的名字；js/config.js 的 feedProxy 是 true 才取） ----
    beehive: {
      adapter: 'rss', proxy: 'nz-beehive', name: 'New Zealand Government', short: 'NZ Govt', zh: '新西兰政府（Beehive）的新闻稿', program: 'Government release', lang: 'en',
      license: { short: 'Source: NZ Govt', text: 'New Zealand Government (beehive.govt.nz)', url: 'https://www.beehive.govt.nz/', statement: 'Source: New Zealand Government (www.beehive.govt.nz). Reproduced accurately, with the source acknowledged.' },
    },
    sanews: {
      adapter: 'rss', proxy: 'za-sanews', name: 'SAnews', short: 'SAnews', zh: '南非政府新闻社', program: 'South African Government News Agency', lang: 'en',
      // 每条是 <span>标题</span><div>正文</div><div>一个数字</div>：标题去掉（和文章的标题一样），只有数字的一段不要
      remove: 'body > span', skip: /^[-–]?\s*SAnews\.gov\.za\s*$|^\d{1,7}$/i, bylineOf: () => '', // dc:creator 是网站编辑的用户名，不是记者
      license: { short: 'SAnews.gov.za', text: 'SAnews.gov.za', url: 'https://www.sanews.gov.za/', statement: 'All media are welcome to utilise SA Government News Agency’s content and credit such use to SAnews.gov.za.' },
    },
    hk: {
      adapter: 'rss', proxy: 'hk-isd', name: 'HKSAR Government', short: 'HK Govt', zh: '香港特区政府新闻公报（英文）', program: 'Government press release', lang: 'en', tables: 'text',
      license: { short: '© HKSAR Govt', text: '© HKSAR Government', url: 'https://www.info.gov.hk/gia/general/today.htm', statement: 'Source: HKSAR Government press release (www.info.gov.hk). © HKSAR Government; reproduced accurately, not for resale.' },
    },
    gc: {
      adapter: 'gcnews', proxy: 'ca-gc', name: 'Government of Canada', short: 'Canada', zh: '加拿大政府的新闻稿', program: 'Government release', query: '&type=newsreleases', count: 16,
      license: { short: 'Non-commercial reproduction', text: 'Government of Canada terms', url: 'https://www.canada.ca/en/transparency/terms.html', statement: 'Reproduced for non-commercial use under the Government of Canada terms and conditions.' },
    },
    // 加拿大统计局「每日」：关着（2026-11-14）。它的文章网页经过 Cloudflare 的新闻代理每一篇都等 10 秒超时（504），
    // 直接取只要不到 1 秒（看来是挡着 Cloudflare 的出口），只会让经济、健康、教育第一次打开时多等 10 秒。
    // 要再打开：在下面经济（feeds 和 all）、健康、教育的 feeds 里加回 'statcan'（Worker 里的 ca-statcan 还在）
    statcan: {
      adapter: 'statcan', proxy: 'ca-statcan', name: 'Statistics Canada', short: 'StatCan', zh: '加拿大统计局「每日」', program: 'The Daily', count: 8,
      license: { short: 'Statistics Canada Open Licence', text: 'Statistics Canada Open Licence', url: 'https://www.statcan.gc.ca/en/terms-conditions/open-licence', statement: 'Adapted from Statistics Canada, The Daily. This does not constitute an endorsement by Statistics Canada of this product.' },
    },
    pib: {
      adapter: 'pib', proxy: 'in-pib', name: 'PIB India', short: 'PIB', zh: '印度政府新闻局', program: 'Government release', count: 16,
      license: { short: 'Source: PIB', text: 'Press Information Bureau', url: 'https://www.pib.gov.in/', statement: 'Source: Press Information Bureau (pib.gov.in), Government of India; material reproduced free of charge, accurately.' },
    },
    frym: {
      adapter: 'frym', proxy: 'frym', name: 'Frontiers for Young Minds', short: 'Young Minds', zh: '给青少年读的科学文章', program: 'Science for kids', easy: true, count: 6,
      license: CC('CC BY 4.0', CC_BY_4, 'Frontiers for Young Minds, CC BY 4.0 (Frontiers is the original publisher).'),
    },
    wikiNews: { adapter: 'wiki', wiki: 'en', kind: 'news', name: 'Wikipedia', zh: '维基百科「新闻动态」', program: 'In the news' },
    wikiDyk: { adapter: 'wiki', wiki: 'en', kind: 'dyk', name: 'Wikipedia', zh: '维基百科「你知道吗」', program: 'Did you know', dykPrefix: 'Did you know' },
    wikiOtd: { adapter: 'wiki', wiki: 'en', kind: 'onthisday', name: 'Wikipedia', zh: '维基百科「历史上的今天」', program: 'On this day' },
    wikiTfa: { adapter: 'wiki', wiki: 'en', kind: 'tfa', name: 'Wikipedia', zh: '维基百科「今日特色条目」', program: "Today's featured article" },
    simple: { adapter: 'simplewiki', from: 'en', wiki: 'simple', skipTitle: /^(List of|Lists of|Timeline of)\b|^\d{4} /i, name: 'Simple English Wikipedia', short: 'Simple Wikipedia', zh: '简易英语维基百科', program: 'Simple English', easy: true, minBody: 120 },
  };
  const NEWS = ['govuk', 'ec', 'kff', 'nasa', 'gv', 'wikiNews', 'gc', 'beehive', 'sanews', 'hk'];
  const gov = (...slugs) => slugs.map((s) => 'govuk:' + s);

  // 关键词的写法和瑞典语一样（js/lang/sv.js）：词头匹配，「=」整词，「_」词组里的空格，「+」两倍分；
  // 开头和人名、地名一样的词写整词（=）。all 里写源的名字或者 GOV.UK 的部门（govuk:部门的网址名），这些文章直接算这个话题。
  const TOPICS = [
    { key: 'top', zh: '今日要闻', native: 'Top stories', feeds: NEWS, all: NEWS, kw: '' },
    {
      key: 'politics', zh: '政治', native: 'Politics', feeds: ['govuk', 'ec', 'kff', 'gv', 'wikiNews', 'gc', 'beehive', 'sanews', 'hk', 'pib'],
      all: gov('prime-ministers-office-10-downing-street', 'cabinet-office', 'office-of-the-leader-of-the-house-of-commons', 'northern-ireland-office', 'scotland-office', 'wales-office', 'ministry-of-housing-communities-local-government'),
      min: 10,
      kw: '+politics +political +politician =government parliament =parliamentary +election +elections +elected =vote =votes voter voting =ballot =minister =ministers +prime_minister +chancellor =cabinet +congress =congressional =senate =senator =senators =legislation =legislative lawmaker lawmakers =bill =bills =policy =policies =labour =conservative =conservatives =tory =tories =democrat =democrats =democratic =republican =republicans =white_house =president =presidential =campaign =referendum =opposition =mp =mps devolution =council =councils mayor',
    },
    {
      key: 'world', zh: '国际', native: 'World', feeds: ['govuk', 'ec', 'gv', 'wikiNews', 'gc', 'pib', 'sanews'],
      all: ['gv', 'wikiNews', 'govuk-type:world_news_story', 'govuk:foreign-commonwealth-development-office'],
      min: 8,
      kw: '+international =foreign =diplomatic diplomat embassy ambassador =united_nations =un =nato =g7 =g20 =war ceasefire =peace sanctions =treaty =summit ukraine russia china gaza israel iran syria sudan haiti venezuela africa asia europe =eu =european_union latin_america refugees humanitarian',
    },
    {
      key: 'economy', zh: '经济', native: 'Economy', feeds: ['govuk', 'ec', 'kff', 'gv', 'gc', 'beehive', 'sanews', 'hk', 'pib'],
      all: [...gov('hm-treasury', 'department-for-business-and-trade', 'hm-revenue-customs', 'department-for-work-pensions', 'competition-and-markets-authority', 'insolvency-service', 'national-wealth-fund', 'office-for-national-statistics')],
      min: 10,
      kw: '+economy +economic +economics +inflation =interest_rates +budget =tax =taxes taxation +growth +gdp =jobs =employment unemployment =wages =wage =pay +business businesses =trade =tariff =tariffs =exports =imports +investment investors =markets =prices =cost_of_living =savings =pension =pensions =debt =spending =finance financial =bank =banks banking =industry =manufacturing',
    },
    {
      key: 'tech', zh: '科技', native: 'Technology', feeds: ['govuk', 'ec', 'nasa', 'nasaStories', 'gv', 'kff', 'gc', 'pib'],
      all: gov('department-for-science-innovation-and-technology', 'uk-defence-innovation', 'ofcom', 'information-commissioners-office'),
      min: 12,
      kw: '+technology +technologies =tech =digital +artificial_intelligence =ai +internet =online +software =data =cyber cybersecurity +robot robotics =computer =computers computing =quantum +semiconductor =chips =chip =app =apps =smartphone =innovation +engineering engineers +rocket =satellite =satellites =spacecraft =telescope =electric_vehicles =battery =batteries =broadband =5g',
    },
    {
      key: 'science', zh: '科学', native: 'Science', feeds: ['nasa', 'nasaStories', 'eso', 'webb', 'elife', 'govuk', 'ec', 'wikiNews', 'gc'],
      all: ['nasa', 'nasaStories', 'eso', 'webb', 'elife', ...gov('government-office-for-science', 'uk-space-agency', 'uk-research-and-innovation', 'met-office')],
      min: 8,
      no: 'tax_credit tax_credits tax_relief',
      kw: '+science +scientific +scientist +scientists =research +researchers =study =studies =discovery discovered =astronomy astronomers =planet =planets =moon =mars =asteroid =comet =galaxy =universe =physics =chemistry =biology =genetic =genes =dna =species =fossil fossils evolution =experiment =laboratory =lab =nasa =space =orbit =climate_science',
    },
    {
      key: 'health', zh: '健康', native: 'Health', feeds: ['kff', 'govuk', 'elife', 'ec', 'gv', 'gc', 'hk', 'pib', 'sanews'],
      all: ['kff', ...gov('department-of-health-and-social-care', 'uk-health-security-agency', 'medicines-and-healthcare-products-regulatory-agency', 'nhs-england', 'food-standards-agency', 'national-institute-for-health-and-care-excellence')],
      min: 8,
      kw: '+health +healthcare +medical +medicine +medicines +=hospital +=hospitals +=doctor +=doctors +=nurse +=nurses =nursing +=patient +=patients =nhs =medicaid =medicare =insurance +disease +diseases +vaccine +vaccines vaccination =virus =flu =covid =cancer =diabetes +mental_health =drug =drugs =opioid =opioids =pharmacy =pharmaceutical =clinic =clinics =treatment =therapy =surgery =care',
    },
    {
      key: 'climate', zh: '环境气候', native: 'Environment & climate', feeds: ['govuk', 'ec', 'nasa', 'nasaStories', 'gv', 'gc', 'beehive', 'pib'],
      all: [...gov('department-for-environment-food-rural-affairs', 'department-for-energy-security-and-net-zero', 'environment-agency', 'natural-england', 'marine-management-organisation', 'forestry-commission')],
      min: 8,
      kw: '+climate +environment +environmental =emissions =carbon =co2 =net_zero +renewable renewables =solar =wind_power =wind_farm =wind_farms =heatwave =flood =floods flooding =drought =wildfire =wildfires +pollution +biodiversity =wildlife =nature =conservation =deforestation =fossil_fuels =coal =oil_and_gas =energy =cop30 =cop31 =recycling =plastic =plastics =rivers =water_quality =sewage',
    },
    {
      key: 'education', zh: '教育', native: 'Education', feeds: ['govuk', 'ec', 'kff', 'gv', 'nasa', 'gc', 'beehive', 'sanews', 'pib'],
      all: gov('department-for-education', 'ofsted', 'ofqual', 'office-for-students', 'education-and-skills-funding-agency'),
      min: 12,
      kw: '+education +educational +school +schools +pupil +pupils +student +students +teacher +teachers +university +universities =college =colleges =classroom =exam =exams =curriculum =learning =apprenticeship apprenticeships =skills =tuition =graduates =childcare =nursery',
    },
    {
      key: 'culture', zh: '文化', native: 'Culture', feeds: ['govuk', 'ec', 'gv', 'wikiTfa', 'wikiNews', 'gc', 'pib', 'sanews', 'hk'],
      all: ['wikiTfa', ...gov('department-for-culture-media-and-sport', 'department-for-digital-culture-media-and-sport', 'arts-council-england', 'historic-england', 'british-library')],
      min: 10,
      kw: '+culture +cultural +=art +=arts =artist =artists =museum =museums =gallery =music =musician =film =films =cinema =theatre =theater =book =books =novel =author =writer =poet =poetry =festival =heritage =history =historic =library =libraries =dance =television =tv =award =awards =prize',
    },
    {
      // 体育的文章几乎都来自经过新闻代理的源：没有新闻代理（js/config.js 的 feedProxy）时不列这个话题。
      // 有新闻代理时大多数日子也只有一两篇：hideBelow，不到 3 篇不列（js/app.js 的 checkThinTopics）。
      // 用的源都是「今日要闻」也用的（取过了有缓存，数一数不多花流量）；不用 PIB（每次十几个请求，体育的文章也没有从它来的）
      key: 'sport', zh: '体育', native: 'Sport', needsProxy: true, hideBelow: 3, feeds: ['govuk', 'gc', 'sanews', 'hk', 'wikiNews'],
      all: gov('department-for-culture-media-and-sport', 'uk-sport', 'sport-england'),
      min: 16, strict: true,
      kw: '+sport +sports =athlete =athletes =olympic =olympics =paralympic =paralympics =football =soccer =cricket =rugby =tennis =golf =hockey =basketball =baseball =boxing =cycling =marathon =athletics =swimming =tournament =championship =championships =world_cup =medal =medals =coach =stadium =fifa =ipl =commonwealth_games =khelo_india =team_canada',
    },
    {
      // 移民：经常只有一两篇，不到 3 篇不列（hideBelow，同上）；用的源也都是「今日要闻」用的
      key: 'migration', zh: '移民', native: 'Migration', hideBelow: 3, feeds: ['govuk', 'ec', 'kff', 'gv', 'gc', 'beehive'],
      all: gov('home-office', 'uk-visas-and-immigration', 'border-force'),
      min: 12, strict: true,
      kw: '+migration +migrant +migrants +immigration +immigrant +immigrants +asylum =refugee =refugees =visa =visas =border =borders =deportation =deported =citizenship =ice =small_boats =channel_crossings =resettlement =displaced',
    },
    {
      key: 'crime', zh: '治安法律', native: 'Law & order', feeds: ['govuk', 'kff', 'gv', 'gc', 'sanews', 'hk', 'beehive'],
      all: gov('ministry-of-justice', 'hm-prison-and-probation-service', 'crown-prosecution-service', 'attorney-generals-office', 'youth-justice-board-for-england-and-wales', 'national-crime-agency', 'serious-fraud-office', 'security-industry-authority'),
      min: 10,
      kw: '+=crime +=crimes +criminal +police +policing =court =courts =judge =judges =trial =prison =prisons =prisoner =prisoners =sentence =sentenced =offender =offenders =victim =victims =fraud =violence =murder =knife =arrest =arrested =law =laws =justice =legal =lawsuit =prosecution =prosecutors =jail',
    },
    {
      key: 'defence', zh: '军事国防', native: 'Defence', feeds: ['govuk', 'ec', 'gv', 'wikiNews', 'gc', 'pib'],
      all: gov('ministry-of-defence', 'uk-defence-innovation', 'defence-equipment-and-support', 'royal-navy', 'british-army', 'royal-air-force'),
      min: 10,
      kw: '+defence +defense +military +armed_forces =army =navy =air_force =soldier =soldiers =troops =nato =weapons =missile =missiles =drone =drones =warship =submarine =veterans =veteran',
    },
    { key: 'dyk', zh: '趣闻轶事', native: 'Did you know', feeds: ['wikiDyk', 'eso', 'webb'], all: ['wikiDyk', 'eso', 'webb'], kw: '' },
    { key: 'onthisday', zh: '历史上的今天', native: 'On this day', feeds: ['wikiOtd'], all: ['wikiOtd'], kw: '' },
    { key: 'simple', zh: '简易英语', native: 'Simple English', feeds: ['simple', 'frym'], all: ['simple', 'frym'], kw: '', easy: true },
  ];

  // 按钮的英文提示（js/app.js 里写的是瑞典文，按这张表换成英文）
  const tips = {
    'Stoppa efter artikeln': 'Stop after the article',
    'Fortsätt med nästa artikel': 'Continue with the next article',
    'Upprepa artikeln': 'Repeat the article',
    'Steg för steg: läs tre gånger': 'Step by step: read it three times',
    'Fler artiklar': 'More articles',
    'Nästa artikel': 'Next article',
    'Välj ämne': 'Choose a topic',
    'Välj språk': 'Choose a language',
    'Byt språk': 'Switch language',
    'Tillbaka till listan': 'Back to the list',
    'Till toppen': 'Back to top',
    'Välj röst': 'Choose a voice',
    'Automatiskt': 'Automatic',
    'Mindre text': 'Smaller text',
    'Större text': 'Larger text',
    'Hjälp': 'Help',
    'Inställningar': 'Settings',
    'Läs upp': 'Read aloud',
    'Pausa': 'Pause',
    'Fortsätt': 'Resume',
    'Talhastighet': 'Speaking rate',
    'Provlyssna': 'Listen to a sample',
    'Rensa läshistoriken': 'Clear reading history',
    'Manlig röst': 'Male voice',
    'Kvinnlig röst': 'Female voice',
    'Röst': 'Voice',
    'Kvinnoröst': 'Female voice',
    'Mansröst': 'Male voice',
    'Försök igen': 'Try again',
    'Börja om från de senaste': 'Start again from the latest',
    'Läs upp ordet': 'Read the word aloud',
    'Läs härifrån': 'Read from here',
    'Översätt meningen': 'Translate the sentence',
    'Slå på onlineöversättning': 'Turn on online translation',
    'Stäng': 'Close',
    'Original': 'Original article',
  };
  const tipRe = [
    [/^Talhastighet (\d),(\d)×$/, 'Speaking rate $1.$2×'],
    [/^Talhastighet (\d)×$/, 'Speaking rate $1×'],
    [/^(.+), kvinnoröst$/, '$1, female voice'],
    [/^(.+), mansröst$/, '$1, male voice'],
  ];

  // 分句器不断、但要断开的地方（见下面 text.split）。用了「后顾」（?<=），Safari 16.4 以前不认识：写成字面量的话整个文件
  // 都载入不了、英语读报就没了，所以在 try 里造，造不出来就不另外断（只是这几种地方少断一句）
  let SPLIT = null;
  try { SPLIT = new RegExp('(?<=(?:^|[\\s(])(?:U\\.S|U\\.K|U\\.N|E\\.U|etc|a\\.m|p\\.m|Inc|Ltd|Co|Corp|Jr|Sr|Ph\\.D|est|[A-Z])\\.["”’)]*\\s+)(?=["“‘(]?(?:The|A|An|In|It|Its|This|That|These|Those|He|She|They|We|I|You|But|And|Or|So|Yet|However|There|Here|His|Her|Their|Our|My|As|At|On|For|If|When|While|After|Before|Since|Although|Meanwhile|Also|Today|Yesterday|Now|Some|Many|Most|All|One|Officials|According)\\b(?!\\.))|(?<=\\p{N}[.!?]["”’)]*\\s+)(?=\\p{N})', 'u'); } catch (e) { SPLIT = null; }

  SV.addLang({
    code: 'en',
    // 一批：各个源轮流、一个源最多 3 篇（不让加拿大政府一下子发的十几篇占满一批）；一样的新闻稿发了好几次的只留最新的一篇（js/sources.js）
    batch: { interleave: true, perSource: 3, dedupe: true },
    htmlLang: 'en-US',
    zh: '英语',
    zhText: '英文',
    native: 'English',
    title: '英语读报',
    tagline: '英文新闻和百科 · 朗读 · 点词看中文',
    flag: FLAG_US,
    timeZone: null, // 文章来自好几个国家：按读者自己这里的时间
    tzLabel: '你这里的时间',
    topics: TOPICS,
    sources,
    easyBadge: '简易英语',
    // 说明框「简易英语」「文章来源」两段、设置「文章从哪里来」一段（HTML，js/app.js 的 applyLangTexts 放进去）
    easyNote: '最后一个话题，是 Simple English Wikipedia（简易英语维基百科）里的条目：今天维基百科首页上提到的东西，简易版里也有的，就读简易版（句子短、词简单）。别的话题是普通的英文文章。',
    sourcesHelp: '文章来自允许转载的英文网站，每次打开时现取，不保存；只转文字（图片、视频不转），有的是节选（停在给记者的联系方式、「Notes to editors」这类段落前面）。每篇文章开头一行写着来源、栏目（作者）、许可的简称、发布时间（你这里的时间）和「原文」链接；<b>点许可的简称</b>（电脑、手机一样），下面打开这一篇许可要求写明的整句、节选到哪里、许可和原文的链接。点词、「本句译文」出来的中文是机器翻译，只是帮你读，不是原文的一部分。各个来源要求写明的：'
      + '<br><b>GOV.UK</b>（英国政府网站的新闻稿、讲话）：Contains public sector information licensed under the Open Government Licence v3.0.'
      + '<br><b>European Commission</b>（欧盟委员会新闻室）：© European Union（年份），CC BY 4.0；全文照登，只转了文字，给记者的联系方式没有转。'
      + '<br><b>KFF Health News</b>（美国的医疗新闻）：CC BY-NC-ND 4.0，署名记者和 KFF Health News，正文不改、保留原文的所有链接（文章里的小箭头），表格变成文字，照片、图表不转（说明照登）；最后一段是它的介绍语：KFF Health News is a national newsroom that produces in-depth journalism about health issues and is one of the core operating programs at KFF — the independent source for health policy research, polling, and journalism.'
      + '<br><b>NASA</b>：美国政府作品（Credit: NASA）。<b>ESO</b>、<b>ESA/Webb</b>：新闻稿 CC BY 4.0（Credit: ESO、ESA/Webb）。<b>eLife</b>：给一般读者写的科研简讯，CC BY 4.0。'
      + '<br><b>Global Voices</b>（世界各地的公民报道）：CC BY 3.0，署名作者，只转文字。'
      + '<br><b>Government of Canada</b>（加拿大政府的新闻稿）：非商业转载，写明标题和部门，This reproduction is a copy of the version available at（原文网址）。'
      + '<br><b>PIB India</b>（印度政府新闻局）：Source: Press Information Bureau (pib.gov.in)，照原样免费转载。<b>New Zealand Government</b>（新西兰政府的新闻稿）：照原样转载、写明来源。<b>SAnews</b>（南非政府新闻社）：credit SAnews.gov.za。<b>HKSAR Government</b>（香港特区政府的英文新闻公报，英式拼写）：Source: HKSAR Government press release (www.info.gov.hk). © HKSAR Government，照原样、不转卖。'
      + '<br><b>Frontiers for Young Minds</b>（给青少年读的科学文章，在「简易英语」里）：CC BY 4.0，全部作者、标题、DOI；只转文字，到「Glossary」（词汇表）为止。'
      + '<br><b>维基百科</b>：首页的「新闻动态」「你知道吗」「历史上的今天」「今日特色条目」，读它链到的条目的开头部分（导言，摘录），CC BY-SA 4.0，作者见条目的历史；「简易英语」是 Simple English Wikipedia 的条目，也是 CC BY-SA 4.0。',
    sourcesNote: '文章来自允许转载的英文网站，每次打开时现取，不保存，只转文字（有的是节选），每篇都附原文链接和许可（点文章开头一行的许可简称看整句）：英国政府网站 <b>GOV.UK</b>（Open Government Licence v3.0）、<b>欧盟委员会</b>（CC BY 4.0）、<b>KFF Health News</b>（CC BY-NC-ND 4.0）、<b>NASA</b>、<b>ESO</b>、<b>ESA/Webb</b>、<b>eLife</b>、<b>Global Voices</b>，加拿大、新西兰、南非、香港、印度政府的新闻稿，<b>Frontiers for Young Minds</b>，还有<b>维基百科</b>首页上的条目（CC BY-SA 4.0）。最后一个话题「简易英语」是 Simple English Wikipedia 的条目，句子短、词简单。朗读是美国口音（微软的 Ava、Emma、Andrew、Brian）。',
    sourceName: '英文新闻网站和维基百科',
    glossary: false,
    tts: {
      locale: 'en-US',
      match: /^en([-_]|$)/i,
      exact: /^en-us/i,
      cloud: [
        { name: 'en-US-AvaNeural', label: 'Ava', gender: 'f' },
        { name: 'en-US-EmmaNeural', label: 'Emma', gender: 'f' },
        { name: 'en-US-AndrewNeural', label: 'Andrew', gender: 'm' },
        { name: 'en-US-BrianNeural', label: 'Brian', gender: 'm' },
      ],
      female: ['ava', 'emma', 'jenny', 'aria', 'michelle', 'samantha', 'zira', 'susan', 'karen', 'moira', 'tessa', 'serena', 'allison', 'victoria', 'fiona', 'kate', 'libby', 'sonia', 'hazel', 'catherine', 'nicky', 'joanna', 'salli', 'kimberly'],
      male: ['andrew', 'brian', 'guy', 'david', 'mark', 'daniel', 'alex', 'fred', 'tom', 'oliver', 'ryan', 'george', 'aaron', 'christopher', 'eric', 'roger', 'steffan', 'arthur', 'rishi'],
    },
    // weak：小词（见 js/lang/sv.js 的 tr.weak）
    tr: {
      from: 'en', azurePath: '/translate/en', mymemory: 'en',
      weak: 'a an the of to in on at by for from with about as into onto over under after before between through during without within '
        + 'against among and or but nor so yet if than that this these those which who whom whose what when where why how it its he him '
        + 'his she her hers they them their theirs we us our ours you your yours i me my mine is are was were be been being am has have '
        + 'had having do does did will would shall should can could may might must not no there here also very just then too up down '
        + 'out off all any some each both either neither such own same other more most much many few only',
    },
    text: {
      segmenter: 'en',
      // 词：字母、数字，中间可以有撇号、连字符（don't、well-known、Trump's），数字里可以有小数点、千分位（3.5、1,000）；
      // 带点的缩写（U.S.、e.g.、i.e.、a.m.、p.m.、Ph.D.）算一个词
      wordRe: /(?:\p{L}{1,2}\.)+\p{L}{1,2}\.?(?![\p{L}\p{N}])|[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+|[.,]\p{N}+)*/gu,
      // 这些缩写后面的句点不是句子结束……
      abbr: /(?:^|[\s(])(?:Mr|Mrs|Ms|Dr|Prof|St|Sr|Jr|Gen|Lt|Col|Sgt|Capt|Rev|Gov|Sen|Rep|Hon|Inc|Ltd|Co|Corp|No|vs|etc|e\.g|i\.e|approx|est|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec|U\.S|U\.K|U\.N|E\.U|a\.m|p\.m|Ph\.D|[A-Z])\.["”’)]*\s*$/,
      // ……除非是可以在句末的缩写（U.S.、p.m.、etc.、单个大写字母「vitamin D.」），后面又是常见的句首词：「U.S. The」断开，「U.S. Senate」不断
      abbrEnd: /(?:^|[\s(])(?:U\.S|U\.K|U\.N|E\.U|etc|a\.m|p\.m|Inc|Ltd|Co|Corp|Jr|Sr|Ph\.D|est|[A-Z])\.["”’)]*\s*$/,
      starter: /^\s*["“‘(]?(?:The|A|An|In|It|Its|This|That|These|Those|He|She|They|We|I|You|But|And|Or|So|Yet|However|There|Here|His|Her|Their|Our|My|As|At|On|For|If|When|While|After|Before|Since|Although|Meanwhile|Also|Today|Yesterday|Now|Some|Many|Most|All|One|Officials|According)\b(?!\.)/,
      // 分句器（Intl.Segmenter）不断、但要断开的：上面那种缩写后面的句首词；数字后面的句点，下一句以数字开头（「in 2025. 12 people」）
      split: SPLIT,
      // 下一段以小写字母开头就不是新句子（数字开头的是：「2025. 12 people」）
      cont: /^\s*[a-z]/,
    },
    tips,
    tipRe,
  });
})();
