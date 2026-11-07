// 模拟真人操作的机器人：用真实的鼠标或触摸事件玩你的座位，同时做真人会做的乱七八糟的事：
// 动画中乱点、连点、转屏、改窗口、开关面板、切后台、丢失 WebGL 上下文，以及打不合规的牌。
// tests/soak.mjs --human 1 时使用。麻将和拖拉机共用这份脚本（两边各放一份）。
const rnd = () => Math.random();
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };

export function newRobotStats() {
  return {
    ticks: 0, taps: 0, discards: 0, plays: 0, hints: 0, manual: 0, throwsTried: 0, illegalSelections: 0,
    bidsLast: 0, bidsDuringDeal: 0, buries: 0, claims: {}, forbidTried: 0, forbidAccepted: 0,
    noise: {}, missed: {}, blocked: {}, untappable: 0, hintBad: 0,
    sweeps: 0, sweepBad: 0, contextLoss: 0, contextBad: 0, freezes: 0, resizes: 0, portrait: 0, audio: [], strips: [],
  };
}

const STATE = `(()=>{const d=window.__mjDebug||window.__tjDebug;if(!d)return null;const s=d.scene;const $=(i)=>document.getElementById(i);
 const mj=!!window.__mjDebug;const p=d.pending;const me=s.seats&&s.seats[0];
 const list=!me?[]:(mj&&me.drawn!==null?me.hand.concat([me.drawn]):me.hand);
 if(p&&window.__robotLast!==p){window.__robotLast=p;window.__robotSeq=(window.__robotSeq||0)+1;}
 return {mj,kind:p?p.kind:null,forbid:mj&&p&&p.opts?p.opts.forbid:null,leadLen:!mj&&p&&p.info?p.info.lead.length:0,
  acts:[...document.querySelectorAll('#actions .act')].map(b=>b.className.replace('act ','')),
  resume:!$('fsResume').hidden,start:!$('startScreen').hidden,result:!$('resultScreen').hidden,rules:!$('rulesScreen').hidden,log:!$('logPanel').hidden,back:!$('btnBackResult').hidden,
  hand:list,selected:mj?s.selectedId:[...s.selected],confirm:!mj&&$('btnConfirm')?!$('btnConfirm').disabled:false,
  w:innerWidth,h:innerHeight,tweens:s.tweens.length,speed:s.speed,seq:p?window.__robotSeq:0};})()`;

const ELEM = (sel) => `(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e||e.disabled)return null;const r=e.getBoundingClientRect();if(!r.width)return null;
 const x=r.left+r.width/2,y=r.top+r.height/2;const t=document.elementFromPoint(x,y);const ok=!!t&&(t===e||e.contains(t));return {x,y,ok,by:ok?'':(t&&(t.id||t.className||t.tagName))}})()`;

// 找一个真的点得到这张牌的位置：拾取结果是这张牌，而且这一点没有被界面元素盖住
const TAP_POINT = (id) => `(()=>{const s=(window.__mjDebug||window.__tjDebug).scene;const t=(s.tiles||s.cards)[${id}];if(!t)return null;const c=s.project(t.pos);if(!c)return null;
 let hidden=null;const free=(x,y)=>{const e=document.elementFromPoint(x,y);if(e===s.canvas)return true;hidden=e&&(e.id||e.className||e.tagName);return false};
 for(const dy of [0,-8,8,-16,16,-28,28,-40,40])for(const dx of [0,-4,4,-8,8,-12,12,-18,18,-26,26,-36,36,-48,48,-60,60,-72,72]){const x=c.x+dx,y=c.y+dy;if(s.pick(x,y)===${id}&&free(x,y))return {x,y}}
 return {hidden}})()`;

const AI_PLAN = `(()=>{const d=window.__mjDebug;const p=d.pending;if(!p)return null;const ai=window.__robotAI||(window.__robotAI=MJ.AI.createPlayer({}));
 const a=p.kind==='turn'?ai.chooseTurn(p.view,p.opts):p.kind==='claim'?ai.chooseClaim(p.view,p.claim):ai.chooseRob(p.view,p.info);
 const o={...a};if(a.type==='discard'&&o.id===undefined)o.id=p.view.hand.find(t=>t.kind===a.kind).id;if(p.kind==='claim'&&a.type==='chi')o.chiIndex=p.claim.options.chi.findIndex(x=>x[0]===a.chi[0]&&x[1]===a.chi[1]);
 if(p.kind==='turn'&&a.type==='gang')o.gangIndex=p.opts.gangs.findIndex(g=>g.kind===a.kind&&g.sub===a.sub);
 return o})()`;

const FORBID_IDS = `(()=>{const d=window.__mjDebug;const p=d.pending;if(!p||p.kind!=='turn'||p.opts.forbid===null)return [];return p.view.hand.filter(t=>t.kind===p.opts.forbid).map(t=>t.id)})()`;

// 拖拉机手动选牌：领牌时一张、一对或同门几张（可能甩牌失败），跟牌时优先选同门
const TJ_PICK = (mode) => `(()=>{const d=window.__tjDebug;const p=d.pending;if(!p)return [];const R=TJ.Rules;const v=p.view;const ctx=R.makeCtx(v.level,v.trump);
 const shuffle=(a)=>{for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
 const hand=shuffle(v.hand.slice());
 if(p.kind==='follow'){const cls=ctx.cls[p.info.lead[0]];const n=p.info.lead.length;const same=hand.filter(t=>ctx.cls[t.kind]===cls);const other=hand.filter(t=>ctx.cls[t.kind]!==cls);return same.concat(other).slice(0,n).map(t=>t.id)}
 const mode=${JSON.stringify(mode)};
 if(mode==='single')return [hand[0].id];
 if(mode==='pair'){for(const a of hand){const b=hand.find(t=>t.id!==a.id&&t.kind===a.kind);if(b)return [a.id,b.id]}return [hand[0].id]}
 const by={};for(const t of hand){(by[ctx.cls[t.kind]]=by[ctx.cls[t.kind]]||[]).push(t)}
 const groups=Object.values(by).filter(g=>g.length>=2);if(!groups.length)return [hand[0].id];
 const g=groups[Math.floor(Math.random()*groups.length)];return g.slice(0,2+Math.floor(Math.random()*3)).map(t=>t.id)})()`;

const STRIPS = `(()=>{const s=window.__tjDebug.scene;const me=s.seats[0];const v=[];for(const id of me.hand){const c=s.project(s.cards[id].pos);let n=0;for(let x=Math.max(0,c.x-90);x<Math.min(innerWidth,c.x+90);x+=1){if(s.pick(x,c.y)===id)n++}v.push(n)}v.sort((a,b)=>a-b);return {count:me.hand.length,min:v[0],median:v[v.length>>1],w:innerWidth}})()`;

const AUDIO_STATE = `(window.__ac?window.__ac.state:'none')`;

export async function runRobot({ send: rawSend, ev: rawEv, stats, isDone, sleep, touch, home, sizes, shot, trace: T }) {
  const trace = (x) => { T.push(new Date().toLocaleTimeString() + ' ' + x); if (T.length > 30) T.shift(); };
  // 调试协议的调用可能因为页面卡住而不返回：记下来，不让机器人跟着挂死
  const limit = (p, what) => {
    let settled = false;
    return Promise.race([
      p.then((v) => { settled = true; return v; }),
      sleep(9000).then(() => { if (!settled) bump(stats.missed, '调用超时 ' + what); return undefined; }),
    ]);
  };
  const send = (m, params) => limit(rawSend(m, params), m);
  const ev = (expr) => limit(rawEv(expr), 'evaluate ' + expr.slice(0, 40));
  let seq = -1;
  let portraitLeft = 0;
  let lastContext = Date.now();
  let lastFreeze = Date.now();
  let audioChecks = 0;
  let stripChecks = 0;

  const metrics = (w, h, dpr) => send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: touch });
  const tapAt = async (x, y) => {
    stats.taps++;
    trace('tap ' + Math.round(x) + ',' + Math.round(y));
    if (touch) {
      await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      return;
    }
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, pointerType: 'mouse' });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
  };
  const clickSel = async (sel, nth) => {
    const q = nth === undefined ? sel : `${sel}:nth-of-type(${nth + 1})`;
    let box = await ev(ELEM(q));
    if (!box && nth !== undefined) box = await ev(ELEM(sel));
    if (!box) return false;
    if (!box.ok) bump(stats.blocked, sel + ' 被 ' + box.by + ' 挡住');
    await tapAt(box.x, box.y);
    return box;
  };
  const tapCard = async (id, what) => {
    const p = await ev(TAP_POINT(id));
    if (!p || p.x === undefined) {
      stats.untappable++;
      trace('untappable id=' + id + ' ' + JSON.stringify(p));
      if (p && p.hidden) bump(stats.blocked, what + ' 被 ' + p.hidden + ' 挡住');
      return false;
    }
    await tapAt(p.x, p.y);
    return true;
  };
  const stillSame = async (oldSeq, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const s = await ev(STATE);
      if (!s || !s.kind || s.seq !== oldSeq) return false;
      await sleep(40);
    }
    return true;
  };

  // ---- 乱来 ------------------------------------------------------------------
  const noise = async (st, inTurn) => {
    const kinds = inTurn
      ? ['tapTable', 'tapTable', 'doubleTap', 'resize', 'rightClick']
      : ['tapTable', 'tapTable', 'tapHand', 'tapHand', 'doubleTap', 'rules', 'log', 'sound', 'resize', 'portrait', 'rightClick', 'context', 'freeze'];
    const k = pick(kinds);
    trace('noise ' + k);
    if (k === 'tapTable') {
      await tapAt(st.w * rnd(), st.h * rnd());
    } else if (k === 'tapHand') {
      if (st.hand.length) await tapCard(pick(st.hand), '手牌');
    } else if (k === 'doubleTap') {
      const x = st.w * rnd();
      const y = st.h * (0.5 + rnd() * 0.5);
      await tapAt(x, y);
      await tapAt(x, y);
    } else if (k === 'rules') {
      await clickSel('#btnRules');
    } else if (k === 'log') {
      await clickSel('#btnLog');
    } else if (k === 'sound') {
      await clickSel('#btnSound');
    } else if (k === 'resize') {
      const z = pick(sizes);
      stats.resizes++;
      await metrics(z[0], z[1], z[2]);
    } else if (k === 'portrait') {
      stats.portrait++;
      portraitLeft = 2 + Math.floor(rnd() * 4);
      await metrics(home[1], home[0], home[2]);
    } else if (k === 'rightClick') {
      if (!touch) {
        const x = st.w * rnd();
        const y = st.h * rnd();
        await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'right', clickCount: 1, pointerType: 'mouse' });
        await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'right', clickCount: 1, pointerType: 'mouse' });
      }
    } else if (k === 'context') {
      if (Date.now() - lastContext < 90000) return;
      lastContext = Date.now();
      stats.contextLoss++;
      await ev(`(()=>{const s=(window.__mjDebug||window.__tjDebug).scene;window.__robotLose=s.gfx.gl.getExtension('WEBGL_lose_context');window.__robotLose.loseContext()})()`);
      await sleep(200 + rnd() * 1500);
      await ev('window.__robotLose.restoreContext()');
      await sleep(300);
      // 恢复之后真的画出东西才算：读刚画完的画面中心，牌桌中控台那个位置不可能是全黑透明
      const ok = await ev(`new Promise((res)=>{const s=(window.__mjDebug||window.__tjDebug).scene;const G=s.gfx;const g=G.gl;const orig=G.render;let done=false;
        G.render=function(f){orig.call(this,f);if(done)return;done=true;G.render=orig;const b=new Uint8Array(4);g.readPixels(g.drawingBufferWidth>>1,g.drawingBufferHeight>>1,1,1,g.RGBA,g.UNSIGNED_BYTE,b);res(!G.lost&&b[3]>0&&b[0]+b[1]+b[2]>0)};
        setTimeout(()=>{if(!done){done=true;G.render=orig;res(false)}},4000)})`);
      if (!ok) {
        stats.contextBad++;
        await shot('context-lost-black');
      } else if (stats.contextLoss === 1) {
        await shot('context-restored');
      }
    } else if (k === 'freeze') {
      if (Date.now() - lastFreeze < 60000) return;
      lastFreeze = Date.now();
      stats.freezes++;
      await send('Page.setWebLifecycleState', { state: 'frozen' });
      await sleep(500 + rnd() * 1500);
      await send('Page.setWebLifecycleState', { state: 'active' });
      await sleep(200);
      const alive = await ev(`new Promise((res)=>{requestAnimationFrame(()=>res(true));setTimeout(()=>res(false),3000)})`);
      if (!alive) bump(stats.missed, '切后台回来后画面不动');
    }
    bump(stats.noise, k);
  };

  // ---- 麻将 ------------------------------------------------------------------
  const stepMJ = async (st) => {
    if (!st.kind || st.seq === seq) {
      if (st.kind && st.seq === seq) seq = -1; // 上一次点了没反应：重新决定
      return;
    }
    seq = st.seq;
    const plan = rnd() < 0.7 ? await ev(AI_PLAN) : null;
    if (st.kind === 'turn') {
      if (st.acts.includes('hu') && (rnd() < 0.95 || (plan && plan.type === 'hu'))) { await clickSel('#actions .act.hu'); bump(stats.claims, '自摸胡'); return; }
      if (plan && plan.type === 'gang') {
        const n = plan.gangIndex;
        const buttons = st.acts.map((a, i) => (a === 'gang' ? i : -1)).filter((i) => i >= 0);
        await clickSel('#actions .act', buttons[n] === undefined ? buttons[0] : buttons[n]);
        bump(stats.claims, '杠');
        return;
      }
      if (!plan && st.acts.includes('gang') && rnd() < 0.5) { await clickSel('#actions .act.gang'); bump(stats.claims, '杠'); return; }
      if (st.forbid !== null && rnd() < 0.4) {
        const ids = await ev(FORBID_IDS);
        if (ids && ids.length) {
          stats.forbidTried++;
          await tapCard(ids[0], '手牌');
          if (touch) await tapCard(ids[0], '手牌');
          await sleep(80);
          const after = await ev(STATE);
          if (!after || after.seq !== st.seq || !after.kind) stats.forbidAccepted++;
          if (!after || after.seq !== st.seq) return;
        }
      }
      const id = plan && plan.type === 'discard' ? plan.id : pick(st.hand);
      if (touch && rnd() < 0.2) await tapCard(pick(st.hand), '手牌'); // 先抬起一张，再改主意
      await tapCard(id, '手牌');
      if (touch) { await sleep(30); await tapCard(id, '手牌'); }
      stats.discards++;
      if (await stillSame(st.seq, 1200)) {
        bump(stats.missed, '打牌没反应');
        const page = await ev(`(()=>{const d=window.__mjDebug;const s=d.scene;const me=s.seats[0];const t=s.tiles[${id}];const c=s.project(t.pos);const e=document.elementFromPoint(c.x,c.y);return JSON.stringify({id:${id},inHand:me.hand.includes(${id})||me.drawn===${id},selectedId:s.selectedId,interactive:s.interactive,pending:d.pendingKind,forbid:d.pending&&d.pending.opts?d.pending.opts.forbid:null,kind:t.kind,tweens:s.tweens.length,at:[Math.round(c.x),Math.round(c.y)],pick:s.pick(c.x,c.y),el:e&&(e.id||e.tagName),hint:document.getElementById('hint').textContent,w:innerWidth,h:innerHeight})})()`);
        (stats.missedTraces = stats.missedTraces || []).push({ touch, page, trace: T.slice(-10) });
      }
      return;
    }
    // 吃碰杠胡过：优先照 AI 的决定点，否则随便选一个
    let sel = null;
    let nth;
    if (plan) {
      if (plan.type === 'chi') {
        const idx = st.acts.map((a, i) => (a === 'chi' ? i : -1)).filter((i) => i >= 0);
        nth = idx[plan.chiIndex] === undefined ? idx[0] : idx[plan.chiIndex];
        sel = '#actions .act';
      } else {
        sel = '#actions .act.' + plan.type;
      }
      bump(stats.claims, plan.type);
    } else {
      const a = st.acts.includes('hu') && rnd() < 0.9 ? 'hu' : pick(st.acts);
      sel = '#actions .act.' + a;
      bump(stats.claims, a);
    }
    await clickSel(sel, nth);
    if (await stillSame(st.seq, 1200)) bump(stats.missed, '吃碰按钮没反应');
  };

  // ---- 拖拉机 ----------------------------------------------------------------
  const hintThenConfirm = async (oldSeq) => {
    stats.hints++;
    await clickSel('#actions .act.tip');
    let enabled = false;
    for (let i = 0; i < 80; i++) {
      const s = await ev(STATE);
      if (!s || s.seq !== oldSeq) return;
      if (s.confirm) { enabled = true; break; }
      await sleep(50);
    }
    if (!enabled) {
      stats.hintBad++;
      await shot('hint-bad');
      return;
    }
    await clickSel('#btnConfirm');
    stats.plays++;
    if (await stillSame(oldSeq, 1500)) bump(stats.missed, '出牌没反应');
  };

  const stepTJ = async (st) => {
    if (!st.kind) {
      if (st.acts.includes('bid') && rnd() < 0.1) {
        await clickSel('#actions .act.bid');
        stats.bidsDuringDeal++;
      }
      return;
    }
    if (st.seq === seq) { seq = -1; return; }
    seq = st.seq;
    if (st.kind === 'bid') {
      await clickSel(st.acts.includes('bid') && rnd() < 0.7 ? '#actions .act.bid' : '#actions .act.pass');
      stats.bidsLast++;
      return;
    }
    if (st.kind === 'bury') {
      stats.buries++;
      if (touch && stripChecks < 6) {
        stripChecks++;
        stats.strips.push(await ev(STRIPS));
      }
      if (rnd() < 0.6) return hintThenConfirm(st.seq);
      if (rnd() < 0.3) {
        // 按住滑动连选：从一张牌滑到旁边几张
        const pts = [];
        const start = Math.floor(rnd() * (st.hand.length - 6));
        for (let i = 0; i < 5; i++) pts.push(await ev(TAP_POINT(st.hand[start + i])));
        if (pts.every((p) => p && p.x !== undefined)) {
          stats.sweeps++;
          if (touch) {
            await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: pts[0].x, y: pts[0].y }] });
            for (const p of pts.slice(1)) await send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: p.x, y: p.y }] });
            await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          } else {
            await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pts[0].x, y: pts[0].y, pointerType: 'mouse' });
            await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: pts[0].x, y: pts[0].y, button: 'left', clickCount: 1, pointerType: 'mouse' });
            for (const p of pts.slice(1)) await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: p.x, y: p.y, button: 'left', buttons: 1, pointerType: 'mouse' });
            await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: pts[4].x, y: pts[4].y, button: 'left', clickCount: 1, pointerType: 'mouse' });
          }
          await sleep(60);
          const after = await ev(STATE);
          if (after && after.seq === st.seq && after.selected.length !== 5) {
            stats.sweepBad++;
            trace('sweep selected ' + after.selected.length);
          }
          await clickSel('#actions .act.pass');
        }
      }
      const cards = st.hand.slice().sort(() => rnd() - 0.5);
      const n = rnd() < 0.25 ? 9 : 8;
      for (let i = 0; i < n; i++) await tapCard(cards[i], '手牌');
      if (n === 9) await tapCard(cards[8], '手牌');
      const s = await ev(STATE);
      if (s && s.seq === st.seq && s.confirm) {
        await clickSel('#btnConfirm');
        if (await stillSame(st.seq, 1500)) bump(stats.missed, '埋牌没反应');
        return;
      }
      if (s && s.seq === st.seq) {
        stats.illegalSelections++;
        await clickSel('#actions .act.pass');
        return hintThenConfirm(st.seq);
      }
      return;
    }
    if (rnd() < 0.6) return hintThenConfirm(st.seq);
    stats.manual++;
    const mode = st.kind === 'lead' ? pick(['single', 'single', 'pair', 'throw']) : 'follow';
    if (mode === 'throw') stats.throwsTried++;
    const ids = await ev(TJ_PICK(mode));
    for (const id of ids || []) {
      await tapCard(id, '手牌');
      if (rnd() < 0.03) await noise(st, true);
    }
    const s = await ev(STATE);
    if (!s || s.seq !== st.seq) return;
    if (s.confirm) {
      await clickSel('#btnConfirm');
      stats.plays++;
      if (await stillSame(st.seq, 1500)) bump(stats.missed, '出牌没反应');
      return;
    }
    stats.illegalSelections++;
    await clickSel('#actions .act.pass');
    return hintThenConfirm(st.seq);
  };

  // ---- 主循环 ----------------------------------------------------------------
  while (!isDone()) {
    await sleep(40 + rnd() * 120);
    const st = await ev(STATE);
    if (!st) continue;
    stats.ticks++;
    trace('tick kind=' + st.kind + ' seq=' + st.seq + ' w=' + st.w + ' h=' + st.h + (st.rules ? ' rules' : '') + (st.log ? ' log' : '') + (st.start ? ' start' : '') + (st.result ? ' result' : '') + (st.back ? ' back' : ''));
    if (st.h > st.w) { // 竖屏：过一会儿转回来
      if (--portraitLeft <= 0) await metrics(home[0], home[1], home[2]);
      continue;
    }
    if (st.resume) {
      await clickSel('#btnFsResume');
      continue;
    }
    if (st.rules) {
      if (rnd() < 0.5) await clickSel('#btnRulesClose');
      else await tapAt(4, st.h / 2); // 点弹窗外面关掉
      continue;
    }
    if (st.log && !st.result && !st.start) {
      await clickSel('#btnLog');
      continue;
    }
    if (st.start) {
      await clickSel('#btnStart');
      if (audioChecks++ < 1) {
        await sleep(1200);
        stats.audio.push(await ev(AUDIO_STATE));
      }
      continue;
    }
    if (st.result) {
      await sleep(900); // 监控每 700 ms 才看一次结果页，点太快这一局就漏记了
      if (rnd() < 0.2) {
        await clickSel('#btnViewTable');
        await sleep(150 + rnd() * 300);
        await clickSel('#btnBackResult');
        await sleep(60);
      }
      const box = await clickSel('#btnNext');
      if (box && rnd() < 0.2) await tapAt(box.x, box.y); // 连点
      continue;
    }
    if (st.back) {
      await clickSel('#btnBackResult');
      continue;
    }
    if (rnd() < 0.04) {
      await noise(st, false);
      continue;
    }
    if (st.mj) await stepMJ(st);
    else await stepTJ(st);
  }
}
