/* 常用词小词典（本站自己编写）：瑞典语最常用的几百个词和中文意思。
   查词时先查这里：不用联网、不占在线翻译的额度，而且「som、att、på」这类小词
   单独交给翻译引擎往往译不好。查不到的词再交给翻译引擎。
   每行：原形|中文|变化形式（空格分开，可以没有） */
(function () {
  'use strict';
  const SV = window.SV;

  const RAW = `
jag|我|
du|你|
han|他|
hon|她|
den|它；那个；（定冠词，通性）|
det|它；这；那；（定冠词，中性）|
vi|我们|
ni|你们；您|
de|他们；她们；它们；（复数定冠词）|
mig|我（宾格）|mej
dig|你（宾格）|dej
honom|他（宾格）|
henne|她（宾格）|
oss|我们（宾格）|
er|你们（宾格）；你们的|ert era
dem|他们（宾格）|
dom|判决；（口语）他们|domen domar
sig|自己（反身代词）|
min|我的|mitt mina
din|你的|ditt dina
hans|他的|
hennes|她的|
dess|它的|
vår|我们的；春天|vårt våra
deras|他们的|
sin|自己的（反身物主代词）|sitt sina
man|人们（泛指）；男人|
någon|某人；任何人；某个|något några
ingen|没有人；没有|inget inga
all|所有的|alla allt
varje|每个|
varandra|互相|
själv|自己；亲自|självt själva
denna|这个|detta dessa
vilken|哪个；哪|vilket vilka
vem|谁|
vad|什么|
var|在哪里；每个|
när|什么时候；当……的时候|
hur|怎样；多么|
varför|为什么|
vart|去哪里|
som|（关系代词）……的；像；作为|
och|和；并且|
eller|或者|
men|但是|
att|（不定式标记）；（连词）……这件事|
om|关于；如果；是否；在……之后|
eftersom|因为|
därför|所以；因此|
för|为了；因为；对于；太|
så|所以；这么；那么；于是|
medan|当……的时候；而|
innan|在……之前|
sedan|然后；自从；以前|
sen|晚的；（口语）然后|sent sena
tills|直到|
fast|虽然；但是；牢固的|
trots|尽管|
både|两个都；既（både … och 既……又……）|
varken|既不（varken … eller 既不……也不……）|
antingen|要么（antingen … eller 要么……要么……）|
utan|没有；而是|
än|比（比较）；还|
i|在……里；在|
på|在……上；在|
av|……的；被；由；从|
till|到；给；为了|
från|从|
med|和；用；带着|
under|在……下面；在……期间|
över|在……上方；超过|
efter|在……之后；沿着|
före|在……之前|
mot|朝向；反对；对抗|
vid|在……旁边；在|
hos|在……那里|
genom|通过；穿过|
mellan|在……之间|
bland|在……之中|
enligt|根据；据|
inom|在……之内|
kring|围绕；大约|
runt|围绕；大约；周围|
bakom|在……后面|
framför|在……前面|
bredvid|在……旁边|
utanför|在……外面|
per|每|
åt|给；向|
ur|从……里出来|
inför|面对；在……之前|
inte|不；没有|
också|也|
bara|只；仅仅|
redan|已经|
nu|现在|
då|那时；那么；于是|
här|这里|
där|那里|
idag|今天|
igår|昨天|
imorgon|明天|
snart|很快；不久|
ofta|经常|
alltid|总是|
aldrig|从不|
ibland|有时|
mycket|很；很多|
lite|一点；有点|
mer|更多；更|
mest|最；最多|
ganska|相当|
väldigt|非常|
även|甚至；也|
ju|当然；毕竟（语气词）|
väl|吧；大概（语气词）；好好地|
nog|大概；足够|
kanske|也许|
fortfarande|仍然|
igen|再次|
tillbaka|回来；回去|
bort|离开；走开|
hem|回家；家|
hemma|在家|
ut|出去|
in|进来；进去|
upp|向上|
ner|向下|ned
tidigare|以前；更早|
senare|后来；更晚|
först|首先；最先|
sist|最后|
längre|更长；更远；（inte längre）不再|
ännu|还；尚；更|
dock|然而|
alltså|也就是说；所以|
ungefär|大约|
nästan|几乎|
just|正好；刚刚|
precis|正好；刚刚|
tillsammans|一起|
helt|完全|
särskilt|特别|
dessutom|此外|
däremot|相反；然而|
plötsligt|突然|
tyvärr|可惜；不幸的是|
förstås|当然|
ja|是；对|
nej|不；不是|
vara|是；存在|är var varit
ha|有|har hade haft
bli|成为；变得；（被动）被|blir blev blivit
kunna|能；会|kan kunde kunnat
ska|将要；应该|skall skulle
vilja|想要|vill ville velat
måste|必须|
få|得到；可以；必须；很少（可数）|får fick fått
göra|做|gör gjorde gjort
säga|说|säger sa sade sagt
komma|来；（kommer att）将会|kommer kom kommit
gå|走；去|går gick gått
se|看；看见|ser såg sett
ta|拿；乘坐；花费（时间）|tar tog tagit
ge|给|ger gav gett givit
finnas|存在；有|finns fanns funnits
tycka|认为；觉得|tycker tyckte tyckt
tro|相信；认为|tror trodde trott
veta|知道|vet visste vetat
känna|感觉；认识|känner kände känt
behöva|需要|behöver behövde behövt
börja|开始|
sluta|停止；结束|
använda|使用|använder använde använt
arbeta|工作|
jobba|工作|
bo|住|bor bodde bott
leva|生活；活着|lever levde levt
dö|死|dör dog dött
hända|发生|händer hände hänt
visa|显示；表明|
hitta|找到|
försöka|尝试；试图|försöker försökte försökt
betala|付钱|
köpa|买|köper köpte köpt
sälja|卖|säljer sålde sålt
öka|增加|
minska|减少|
fortsätta|继续|fortsätter fortsatte fortsatt
stänga|关闭|stänger stängde stängt
öppna|打开；开放的|
berätta|讲述；告诉|
fråga|问；问题|
svara|回答|
skriva|写|skriver skrev skrivit
läsa|读|läser läste läst
prata|说话；聊天|
tala|说；讲|
höra|听到|hör hörde hört
lyssna|听|
förstå|理解；懂|förstår förstod förstått
lära|教；学（lära sig 学习）|lär lärde lärt
studera|学习；研究|
hjälpa|帮助|hjälper hjälpte hjälpt
välja|选择|väljer valde valt
vinna|赢|vinner vann vunnit
förlora|输；失去|
spela|玩；演奏；比赛|
resa|旅行；旅程|reser reste rest
flytta|搬家；移动|
stå|站；写着|står stod stått
sitta|坐|sitter satt suttit
ligga|躺；位于|ligger låg legat
hålla|拿着；举行；保持|håller höll hållit
kräva|要求|kräver krävde krävt
planera|计划|
bestämma|决定|bestämmer bestämde bestämt
föreslå|建议；提议|föreslår föreslog föreslagit
presentera|介绍；公布|
meddela|通知；宣布|
varna|警告|
gripa|逮捕；抓住|griper grep gripit gripen gripna greps
misstänka|怀疑|misstänker misstänkte misstänks misstänkt misstänkta
döma|判决|dömer dömde dömt döms dömdes
skada|伤害；损坏；伤|skadad skadade skadas
kosta|花费；价钱是|
handla|购物；（handla om）涉及、关于|
gälla|涉及；有效|gäller gällde gällt
tänka|想；打算|tänker tänkte tänkt
hoppas|希望|hoppades
verka|似乎；起作用|
kallas|被称为|kallades
anses|被认为|ansågs
satsa|投资；致力于|
undersöka|调查；检查|undersöker undersökte undersökt
rösta|投票|
bygga|建造|bygger byggde byggt
äta|吃|äter åt ätit
dricka|喝|dricker drack druckit
sova|睡觉|sover sov sovit
köra|开车；驾驶|kör körde kört
åka|乘坐；去|åker åkte åkt
flyga|飞；坐飞机|flyger flög flugit
falla|落下；跌倒|faller föll fallit
snöa|下雪|
träffa|遇见；见面|
vänta|等待|
ringa|打电话|ringer ringde ringt
ändra|改变|
skicka|寄；发送|
sätta|放；（sätta sig）坐下|sätter satte satt
lägga|放；放下|lägger lade la lagt
dra|拉；（dra ut på tiden）拖延|drar drog dragit
år|年；岁|året åren
dag|天；日|
vecka|星期；周|
månad|月|
tid|时间|
gång|次；走廊|gången gånger
timme|小时|timmar
minut|分钟|
människa|人|människor människorna
person|人|
barn|孩子|barnen
kvinna|女人|kvinnor kvinnorna
män|男人（复数）|männen mannen
familj|家庭|
föräldrar|父母|föräldrarna
vän|朋友|vänner
land|国家；陆地|länder länderna landet
stad|城市|städer städerna staden
kommun|市镇（地方政府）|
region|大区；地区|
regering|政府|
riksdag|（瑞典）议会|
minister|部长|ministern ministrar
statsminister|首相|
parti|党；政党|partiet partier partierna
val|选举；选择；鲸|valet
politiker|政治家|politikerna
polis|警察|polisen
skola|学校|
elev|学生（中小学）|
lärare|老师|lärarna
jobb|工作|jobbet
arbete|工作；劳动|arbetet
företag|公司；企业|företaget företagen
pengar|钱|pengarna
krona|克朗|kronor kronorna
pris|价格；奖|priset priser
procent|百分比|
miljon|百万|miljoner
miljard|十亿|miljarder
hus|房子|huset
bostad|住房|bostäder
väg|路|vägen vägar
bil|汽车|bilen bilar bilarna
buss|公交车|bussen bussar
tåg|火车|tåget
flyg|飞机；航空|flyget
sjukhus|医院|sjukhuset
vård|医疗；护理|vården
läkare|医生|läkaren
hälsa|健康|
nyhet|新闻；新鲜事|nyheter nyheterna
problem|问题|problemet
svar|回答|svaret
förslag|建议；提案|förslaget
beslut|决定|beslutet
lag|法律；队|lagen
domstol|法院|
krig|战争|kriget
fred|和平|freden
mat|食物|maten
vatten|水|vattnet
el|电|elen
energi|能源|
väder|天气|vädret
snö|雪|snön
regn|雨|regnet
vinter|冬天|vintern
sommar|夏天|sommaren
höst|秋天|hösten
morgon|早上；明天|morgonen
kväll|晚上|kvällen
natt|夜里|natten
värld|世界|världen
sverige|瑞典|
svensk|瑞典的；瑞典人；（svenska）瑞典语|svenska svenskar svenskarna
kina|中国|
kinesisk|中国的|kinesiska kineser
eu|欧盟|
usa|美国|
ryssland|俄罗斯|
ukraina|乌克兰|
forskare|研究人员；科学家|forskaren forskarna
forskning|研究|forskningen
studie|研究（报告）|studien studier
universitet|大学|universitetet
teknik|技术|tekniken
dator|电脑|datorn datorer
mobil|手机；移动的|mobilen
bok|书|boken böcker
film|电影|filmen
musik|音乐|musiken
fotboll|足球|
match|比赛|matchen matcher
del|部分|delen delar
sätt|方式；方法|sättet
exempel|例子（till exempel 例如）|
grupp|组；团体|gruppen grupper
samhälle|社会|samhället
ekonomi|经济|ekonomin
skatt|税；宝藏|skatten skatter
ränta|利率；利息|räntan
budget|预算|budgeten
kris|危机|krisen
risk|风险|risken
säkerhet|安全|säkerheten
brott|犯罪|brottet
olycka|事故；不幸|olyckan olyckor
miljö|环境|miljön
klimat|气候|klimatet
natur|自然|naturen
djur|动物|djuret
hav|海|havet
skog|森林|skogen
stor|大|stort stora större störst största
liten|小|litet lilla små mindre minst minsta
ny|新|nytt nya
gammal|老；旧|gammalt gamla äldre äldst
bra|好|bättre bäst
dålig|坏；差|dåligt dåliga sämre sämst
god|好；美味|gott goda
viktig|重要|viktigt viktiga viktigare viktigast
svår|难；严重|svårt svåra svårare
lätt|容易；轻|lätta lättare
enkel|简单|enkelt enkla enklare
lång|长|långt långa
kort|短；卡片|korta
hög|高|högt höga högre högst
låg|低|lågt låga lägre lägst
många|很多（可数）|
flera|好几个；多个|
olika|不同的|
samma|相同的|
annan|别的；另一个|annat andra
egen|自己的|eget egna
hela|整个|
första|第一|
sista|最后的|
nästa|下一个|
förra|上一个；上次的|
vanlig|普通；常见|vanligt vanliga
möjlig|可能的|möjligt möjliga
säker|安全；确定|säkert säkra
fri|自由；免费|fritt fria
gratis|免费|
dyr|贵|dyrt dyra dyrare
billig|便宜|billigt billiga
rik|富有|rika
fattig|贫穷|fattiga
ung|年轻|unga yngre
kall|冷|kallt kalla
varm|暖；热|varmt varma
snabb|快|snabbt snabba
tidig|早|tidigt tidiga
utländsk|外国的|utländska
internationell|国际的|internationella
politisk|政治的|politiska
ekonomisk|经济的|ekonomiska
allvarlig|严重的|allvarligt allvarliga
stark|强|starkt starka
svag|弱|svagt svaga
glad|高兴|glada
ledsen|难过|
rädd|害怕|rädda
trött|累|
sjuk|生病的|sjuka
en|一；一个（不定冠词，通性）|
ett|一；一个（不定冠词，中性）|
två|二|
tre|三|
fyra|四|
fem|五|
sex|六|
sju|七|
åtta|八|
nio|九|
tio|十|
elva|十一|
tolv|十二|
tjugo|二十|
trettio|三十|
hundra|百|
tusen|千|
måndag|星期一|
tisdag|星期二|
onsdag|星期三|
torsdag|星期四|
fredag|星期五|
lördag|星期六|
söndag|星期日|
januari|一月|
februari|二月|
mars|三月|
april|四月|
maj|五月|
juni|六月|
juli|七月|
augusti|八月|
september|九月|
oktober|十月|
november|十一月|
december|十二月|
`;

  // 词形 -> [{ lemma, zh }]；一个词形可以属于几个词（låg：低，也是 ligga 的过去式）
  const map = new Map();
  const add = (form, entry) => {
    const list = map.get(form) || [];
    if (!list.includes(entry)) list.push(entry);
    map.set(form, list);
  };
  for (const line of RAW.split(/\r?\n/)) {
    const [lemma, zh, forms] = line.split('|');
    if (!lemma || !zh) continue;
    const entry = { lemma, zh };
    add(lemma, entry);
    for (const f of (forms || '').split(/\s+/).filter(Boolean)) add(f, entry);
  }
  // 原形排在前面
  for (const [form, list] of map) list.sort((a, b) => (b.lemma === form) - (a.lemma === form));

  // 常见词尾：名词定式/复数、动词现在时/过去时/完成式/被动、形容词变化、所有格
  const SUFFIXES = ['arnas', 'ernas', 'ornas', 'arna', 'erna', 'orna', 'ades', 'ande', 'ende', 'aste', 'ade', 'are', 'ast', 'ats', 'ens', 'ets', 'nas', 'na', 'ar', 'er', 'or', 'en', 'et', 'at', 'de', 'te', 'ts', 'es', 'as', 'n', 't', 's', 'r', 'a', 'e'];

  // 返回 [{ lemma, zh, guessed }] 或 null；guessed 表示按词尾推出的原形，不一定对
  function lookup(word) {
    const w = (word || '').toLowerCase().replace(/[’']/g, '');
    if (!w) return null;
    const pack = (list, guessed) => list.map((e) => ({ lemma: e.lemma, zh: e.zh, guessed }));
    if (map.has(w)) return pack(map.get(w), false);
    const base = w.replace(/:s$/, ''); // EU:s -> eu
    if (base !== w && map.has(base)) return pack(map.get(base), false);
    for (const suf of SUFFIXES) {
      if (!w.endsWith(suf)) continue;
      const stem = w.slice(0, -suf.length);
      if (stem.length < 2) continue;
      for (const cand of [stem, stem + 'a', stem + 'e']) {
        const list = (map.get(cand) || []).filter((e) => e.lemma === cand);
        if (list.length) return pack(list, true);
      }
    }
    return null;
  }

  SV.glossary = { lookup, size: map.size };
})();
