/* 瑞典语：瑞典广播电台（Sveriges Radio）的新闻。话题、关键词、声音、分句的规则都在这里；
   别的语言的设置（js/lang/*.js）写法一样，见 README「语言」。这些值和以前一模一样（从 js/sources.js 搬过来的）。 */
(function () {
  'use strict';
  const SV = window.SV;

  // 简易瑞典语：Radio Sweden på lätt svenska、Klartext
  const EASY_FEEDS = [4916, 493];
  // 普通新闻的主力：Ekot（SR 的新闻部，全天滚动）、Dagens Eko、Studio Ett、P3 Nyheter
  const G = [83, 5526, 1637, 5335];
  const P4 = [103, 104, 96, 114]; // P4 斯德哥尔摩、哥德堡、马尔默、乌普萨拉的地方新闻

  // zh：话题按钮上的中文名；sv：瑞典文名，是话题按钮的瑞典文提示（每个按钮都有瑞典文提示）。
  // 关键词写法：普通词按词头匹配（regering 也匹配 regeringen、regeringsbildning），
  // 「=」开头的必须整词相同，「_」表示词组里的空格，「+」开头的算两倍分。都用小写。
  // all：这些节目的文章不看关键词，全部属于这个话题。min：至少要几分才算（默认 3，见 score）。
  // strict：不够分时不拿沾边的文章充数（宗教、趣闻轶事用：一篇提了一次 kyrkan、katten 的新闻不是宗教、趣闻）；core：「+」词至少要出现几次（标题里出现算两次），现在没有话题用（用过它的「电动车」2026-11-14 去掉了）。
  // no：不要的词（写法和 kw 一样）：标题里出现一次、或者正文里出现两次，这篇就不算这个话题（趣闻轶事用：不要犯罪、战争、事故）。
  // 手机上话题不是一排按钮，是标题旁边的话题按钮，点开是两列的话题面板，顺序和这张表一样（js/app.js 的 renderChips 用这同一张表做按钮和面板）。
  // 简易瑞典语只是最后一个单独的话题，别的话题都用普通的新闻。
  const TOPICS = [
    { key: 'idag', zh: '今日要闻', sv: 'Dagens nyheter', feeds: [83, 5526, 1637, 5335], all: [83, 5526, 1637, 5335], kw: '' },
    {
      key: 'sverige', zh: '瑞典', sv: 'Sverige', feeds: [83, ...P4, 5526], all: P4,
      kw: '=sverige sveriges svensk stockholm göteborg malmö uppsala skåne norrland lappland skellefteå umeå luleå kiruna linköping norrköping örebro västerås jönköping gävle sundsvall gotland halland värmland dalarna småland smhi polisen kommunen kommuner regionen riksdag regering försäkringskassan migrationsverket skatteverket arbetsförmedlingen folkhälsomyndigheten',
    },
    {
      key: 'politik', zh: '政治', sv: 'Politik', feeds: [...G, 438], all: [],
      kw: 'politik regering riksdag minister statsminister partiledar =parti =partiet =partier =partierna opposition budget socialdemokrat moderat sverigedemokrat vänsterparti centerparti liberalerna kristdemokrat miljöparti talman =val =valet valrörelse valresultat riksdagsval väljar regeringsbildning övergångsregering lagförslag proposition president presidentval parlament kongress senat premiärminister eu-kommission kommunfullmäktige demokrati diktatur sanktion',
    },
    {
      key: 'varlden', zh: '国际', sv: 'Världen', feeds: [...G, 438, 4773, 2946, 5459], all: [4773, 2946, 5459],
      kw: '=usa amerikansk trump ryssland rysk putin ukraina ukrain kiev kyiv =eu europeiska =fn =nato israel gaza palestin hamas hizbollah iran syrien libanon jemen krig konflikt vapenvila fredsavtal fredssamtal indien japan sydkorea nordkorea afrika frankrike fransk tyskland storbritannien brittisk london spanien italien polen finland norge danmark utrikes diplomat flykting terror =g7 =g20 venezuela brasilien mexiko turkiet egypten',
    },
    {
      key: 'usa', zh: '美国', sv: 'USA', feeds: [...G, 4923, 438, 4773], all: [4923],
      kw: '+=usa +=usa:s +amerikansk trump vita_huset washington kongressen senaten representanthuset demokraterna republikanerna new_york kalifornien texas florida pentagon =fbi =cia biden harris vance mellanårsval',
    },
    {
      key: 'eu', zh: '欧盟', sv: 'EU', feeds: [...G, 4941, 438, 4773], all: [4941],
      kw: '+=eu +=eu:s eu-kommission eu-parlament eu-länder europaparlament europeiska_unionen europeiska_kommissionen ministerrådet bryssel von_der_leyen =euro euron eurozon schengen strasbourg europaval eu-domstol',
    },
    {
      key: 'kina', zh: '中国', sv: 'Kina', feeds: [...G, 5386, 438, 4773], all: [5386],
      kw: 'kina kines peking beijing shanghai =xi jinping hongkong taiwan tibet xinjiang uigur kommunistpartiet huawei =byd alibaba shenzhen guangzhou wuhan =yuan',
    },
    {
      key: 'forsvar', zh: '军事国防', sv: 'Försvar', feeds: [...G, 438, 2946, 1300, 4773], all: [], min: 4,
      kw: '+försvar +militär +=nato +nato:s soldat +armé armén +marinen +flygvapn +värnplikt +totalförsvar krigsmakt vapen vapenexport krigsmateriel ammunition missil robotar ubåt stridsvagn stridsflyg =jas gripen =saab drönare säkerhetspolitik beredskap civilförsvar hybridhot sabotage spion =must säpo kärnvapen invasion fronten anfall attack krig',
    },
    {
      key: 'ekonomi', zh: '经济', sv: 'Ekonomi', feeds: [...G, 2778, 6679], all: [2778, 6679],
      kw: 'ekonomi ränta räntan riksbank inflation arbetslös =jobb =jobben konkurs varsel =lön =löner =lönen skatt budget bostadspris bolån export import =tull =tullar tullkrig handelskrig =bnp tillväxt lågkonjunktur högkonjunktur recession investering =priser =priserna prishöjning elpris matpris =hyra =hyror pension företag =bank =banken =banker',
    },
    {
      key: 'borsen', zh: '股市', sv: 'Börsen', feeds: [...G, 2778, 6679], all: [], min: 4,
      kw: '+börs +aktie +stockholmsbörsen +nasdaq +=omx +=omxs30 dow_jones wall_street index =kursen kursras kursrus +utdelning investerare fond fonder =vd vd:n bolag bolaget börsvärde marknadsvärde kvartalsrapport rapporten vinst förlust omsättning riksbank ränta nvidia tesla ericsson volvo kryptovaluta bitcoin',
    },
    {
      key: 'teknik', zh: '科技', sv: 'Teknik', feeds: [...G, 4090], all: [4090],
      kw: '=ai artificiell_intelligens teknik techbolag techjätte =app =appen =appar internet mobiltelefon =mobilen smartphone dator datacenter robot =chip =chipet chipjätte halvledar nvidia =apple google microsoft =meta tiktok spotify ericsson samsung openai chatgpt cyber hackare hackar it-attack it-säkerhet digital bredband =5g algoritm sociala_medier instagram facebook youtube =musk drönare satellit datorspel tv-spel',
    },
    {
      key: 'vetenskap', zh: '科学', sv: 'Vetenskap', feeds: [83, 412, 406, 3345], all: [412, 406],
      kw: 'forskare forskning forskar studie studien vetenskap universitet rymd =nasa =esa planet galax svart_hål svarta_hål astronom fysik kemi biolog arkeolog fossil =dna genetisk evolution nobelpris experiment laborator karolinska mikrob bakterie upptäckt',
    },
    {
      key: 'halsa', zh: '健康', sv: 'Hälsa', feeds: [...G, 1272, 412], all: [1272],
      kw: 'hälsa =ohälsa vård sjukvård sjukhus sjukdom läkare sjuksköterska patient cancer vaccin virus smitta covid influensa medicin läkemedel psykisk depression demens diabetes hjärt stroke tandvård folkhälsa vårdcentral akuten operation alkohol rökning narkotika sömn övervikt',
    },
    {
      key: 'klimat', zh: '环境气候', sv: 'Miljö och klimat', feeds: [...G, 3345], all: [3345],
      kw: 'klimat miljö utsläpp koldioxid växthusgas fossila förnybar solenergi solcell vindkraft kärnkraft energi natur skog biologisk_mångfald utrotning =hav =havet =haven plast översvämning torka värmebölja =storm stormen oväder snöfall =snö smhi =väder vädret klimatmöte cop1 cop2 cop3 naturvård återvinning',
    },
    {
      key: 'utbildning', zh: '教育', sv: 'Utbildning', feeds: [...G, ...P4], all: [], min: 4,
      kw: '+skola +skolan +skolor +elev +lärare +förskola +gymnasi +högskola +universitet utbildning studenter =student betyg skolinspektionen skolverket läxor klassrum rektor =sfi svenska_för_invandrare yrkesutbildning folkhögskola =csn studielån',
    },
    {
      key: 'migration', zh: '移民', sv: 'Migration', feeds: [...G, ...P4], all: [], min: 4,
      kw: '+migration +invandr +asyl +flykting +medborgarskap +uppehållstillstånd +migrationsverket +utvisning utvisad +arbetstillstånd integration nyanländ =sfi svenska_för_invandrare gränskontroll anhöriginvandring återvandring',
    },
    {
      key: 'brott', zh: '治安法律', sv: 'Lag och ordning', feeds: [...G, ...P4, 4702, 5413], all: [4702, 5413], min: 4,
      kw: '+polis +gripen +gripna +greps +åtal +åtalad +misstänkt +misstänks +mord +dödsskjutning +skjutning +sprängning +gäng rättegång tingsrätt hovrätt fängelse =dom =domen dömd döms brott brottsling stöld rån bedrägeri bluff våldtäkt misshandel narkotika säpo',
    },
    {
      key: 'kultur', zh: '文化', sv: 'Kultur', feeds: [83, 478, 5053, 5335], all: [478, 5053],
      kw: 'kultur musik film =bok =boken böcker författar konst konstnär teater museum utställning konsert artist sångare sångerska roman litteratur festival opera =dans tv-serie melodifestival eurovision skådespelar regissör poesi =dikt =bio =bion biograf datorspel',
    },
    {
      // 宗教（Tony 加的，2026-11-14）：SR 没有还在出新文章的宗教节目（「Människor och tro」2024 年停了，「Andakten」「Helgsmål」只有一句话的简介），
      // 所以和别的话题一样从新闻里按关键词找：Ekot、Dagens Eko、P1 Morgon、Godmorgon världen 和 P4 地方台（教会的新闻多在地方台）。
      // Konflikt、Kulturnytt 试过，一篇也没有（Kulturnytt 的源里只有音频），去掉了，少取两个源。P4 的几个地方台和趣闻轶事共用，取一次两个话题都用。
      // 有的词要整词（=）：biskop 也是 Biskopsgården（哥德堡的一个区）的开头，munk 是 Munkedal，islam 是 Islamabad，kristen 是 Kristensen。
      key: 'religion', zh: '宗教', sv: 'Religion', feeds: [...G, 1650, 438, ...P4, 78, 94, 101, 109, 159, 160], all: [], min: 6, strict: true,
      kw: '+religion +religiös +religiöst +religiösa +kyrka +kyrkan +kyrkor +kyrkans svenska_kyrkan +=präst +=prästen +=präster +=prästerna +=prästens +=biskop +=biskopen +=biskopar +=biskoparna +=biskopens +ärkebiskop +påve +påven vatikanen +moské +imam +=islam +=islams +islamisk +muslim =kristen =kristet =kristna =kristnas +kristendom +judisk +judar +judendom +synagog +rabbin +buddhis +hinduis +katolsk +ortodox +frikyrk +pingstkyrk +=samfund +=samfundet +=samfunden +trossamfund +gudstjänst =gud =guds =gudar =bibeln =bibel =koranen =koran koranbränning +sekulär ateis +=kloster +=klostret +=klostren +=munk +=munken +=munkar +=munkarna +=nunna +=nunnan +=nunnor +=nunnorna pilgrim konfirmation =dopet =jul =julen =påsk =påsken =ramadan =eid =pingst helgdag antisemitism islamofobi religionsfrihet livsåskådning hijab =slöja =slöjan sharia =etik =etiska =etiskt =etisk värdegrund',
    },
    {
      key: 'sport', zh: '体育', sv: 'Sport', feeds: [83, 179, 5514, 6656, 5335, 103, 104], all: [179, 5514, 6656],
      kw: 'sport fotboll hockey ishockey =os olympisk =vm =em allsvensk landslag =match =matchen =matcher tränare =spelare =spelaren =seger =segern =final =finalen tennis golf friidrott skidor längdskid skidskytte handboll parahandboll bandy basket simning cykling boxning =nhl zlatan =fifa paralympics parasport idrott =guld =silver =brons',
    },
    {
      // 趣闻轶事（Tony 加的，2026-11-14）：奇怪的、好玩的、出人意料的日常新闻，动物、纪录、少见的事。主要来自 P4 地方台和 P3 Nyheter。
      // no：出现这些词（标题里一次，或者正文里两次）的文章不算，免得把犯罪、战争、事故、死人的新闻当趣闻。
      // 有的要整词：=brand 不要火灾，但「Brandmän räddade katten」（消防员救了猫）要；=skott 不碰 Skottland；不用 skjut（skjuter upp 是推迟）。
      // 动物也要整词，人名不算：没有 björn（Björn Ulvaeus）、svan（Gunde Svan）、uggla（Magnus Uggla），只有 björnen、svanen、ugglan 这些。
      key: 'kuriosa', zh: '趣闻轶事', sv: 'Kuriosa', feeds: [5335, ...P4, 78, 91, 94, 101, 109, 159, 160], all: [], min: 6, strict: true,
      kw: '+kuriosa +ovanlig +ovanligt +ovanliga +märklig +märkligt +märkliga +bisarr +udda +knasig +lustig +oväntad +oväntat +överraskning +överraskade +=rekord +=rekordet +världsrekord +=rekordförsök +guinness +=älg +=älgen +=älgar +=björnen +=björnar +=björnarna +=räv +=räven +=katt +=katten +=katter +=hund +=hunden +=hundar +=häst +=hästen +=kossa +=kossan +=säl +=sälen +=ugglan +=ugglor +=igelkott +=ekorre +=papegoja +=orm +=ormen +djurpark +=grävling +=svanen +=svanar fågel fåglar =djur =djuret =djuren jättepumpa pumpa =svamp =svampar hittade hittat upphittad =fynd =fyndet lotteri jackpot miljonvinst =vinst =vann 100-åring 100-årsdag =fyller tävling tävlade =viral ovanligt_väder snögubbe',
      no: '=polis =polisen polisens biljakt bedrägeri =bluff mord =död =döda =dödad dödades dödsfall dödlig dödsskjut skjutning =skjuten =skjutna =skjutits =skott =skotten =skottet skottlossning krig =attack attacken bomb explosion sprängning terror gripen gripna =greps häktad åtal åtalad dömd våldtäkt =rån rånet misshandel knivhugg olycka olyckan omkom omkomna =avled =dog förolyckad =brand =branden =bränder =bränderna =svält konkurs varsel',
    },
    // 额外的一个话题：SR 专门用简易瑞典语写的新闻（句子短、词简单）
    { key: 'latt', zh: '简易瑞典语', sv: 'Lätt svenska', feeds: EASY_FEEDS, all: EASY_FEEDS, kw: '' },
  ];

  SV.addLang({
    code: 'sv', // 网址的 ?lang=、浏览器存储的前缀（瑞典语就是以前的 sv.settings.v1、sv.shown.v1……）
    htmlLang: 'sv', // 文章、按钮提示的 lang 属性
    zh: '瑞典语', // 中文名
    zhText: '瑞典文', // 「瑞典文提示」
    native: 'Svenska',
    title: '瑞典语读报',
    tagline: '今天的瑞典新闻 · 朗读 · 点词看中文',
    flag: '<svg viewBox="0 0 16 10" aria-hidden="true"><rect width="16" height="10" fill="#006aa7"/><rect x="5" width="2" height="10" fill="#fecc00"/><rect y="4" width="16" height="2" fill="#fecc00"/></svg>',
    timeZone: 'Europe/Stockholm', // 「今天」「昨天」和文章的时间按瑞典时间
    tzLabel: '瑞典时间',
    topics: TOPICS,
    easyBadge: '简易瑞典语', // 用简易语言写的文章的标签
    sourceName: 'Sveriges Radio', // 加载、出错的提示里说从哪里取文章（瑞典语的提示照旧写在 js/app.js 里）
    glossary: true, // 小词典（js/glossary.js）和按这一句选词义（js/sense.js）只有瑞典语有
    // 朗读：本机的声音挑 sv 开头的，云端用微软的瑞典语神经语音。female、male：按名字认男女声
    tts: {
      locale: 'sv-SE',
      match: /^sv([-_]|$)/i,
      exact: /^sv-se/i,
      cloud: [
        { name: 'sv-SE-SofieNeural', label: 'Sofie', gender: 'f' },
        { name: 'sv-SE-HilleviNeural', label: 'Hillevi', gender: 'f' },
        { name: 'sv-SE-MattiasNeural', label: 'Mattias', gender: 'm' },
      ],
      female: ['sofie', 'hedvig', 'hillevi', 'alva', 'klara', 'astrid', 'elin', 'karin', 'ingrid', 'linnea', 'maja', 'emma', 'sara', 'kvinna', 'kvinnlig'],
      male: ['mattias', 'bengt', 'oskar', 'erik', 'anders', 'johan', 'lars', 'manlig'],
    },
    // 翻译：微软翻译走 Worker 的 /translate（只翻瑞典语）；浏览器内置翻译、MyMemory 的源语言。
    // weak：小词（介词、连词、代词、助动词……）。在整句译文里给点的词画下划线时（js/wordspan.js），小词的标签要和它的译文
    // 有共同的字才算，单独译出来的意思也不拿来比（常常不对）
    tr: {
      from: 'sv', azurePath: '/translate', mymemory: 'sv',
      weak: 'och i på att det som en ett är av för med till den de dem har inte om var jag du han hon vi ni man sig sin sitt sina så då '
        + 'men eller när där här från vid mot efter under över ut upp in kan ska skulle vill ville måste får fick hade blir blev bli varit '
        + 'vara alla andra också bara nu än hos utan mellan genom sedan redan ju väl dock denna detta dessa deras hans hennes dess vår vårt '
        + 'våra er ert era min mitt mina din ditt dina något några någon inget ingen inga vilken vilket vilka vad vem hur varför eftersom '
        + 'därför även mycket mer mest många flera hela samma själv egen eget egna ha',
    },
  });
})();
