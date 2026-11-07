/* 3D 牌桌：牌的摆放、动画、镜头、拾取。对手手里的牌 kind 一直是 null，画面上根本没有牌面可画。 */
(function (root) {
  'use strict';
  const { Gfx, Quat, M4, V3, roundedBox, planeRect, cardMesh } = root.TJ.GFX;
  const Art = root.TJ.Art;
  const Cards = root.TJ.Cards;

  const CW = 1;
  const CH = 1.4;
  const CT = 0.022;
  const TABLE_X = 31.5;
  const TABLE_Z = 18.4;
  const FIT_ASPECT = 2.05; // 窄于这个宽高比时把镜头拉远，保证左右都看得到
  const CONSOLE_TOP = 0.2;
  const HAND_TILT = 0.92;
  const AI_TILT = 1.02;

  const FLAT_UP = Quat.axis(1, 0, 0, -Math.PI / 2);
  const FLAT_DOWN = Quat.axis(1, 0, 0, Math.PI / 2);
  const YAW = [0, Math.PI / 2, Math.PI, -Math.PI / 2].map((a) => Quat.axis(0, 1, 0, a));

  const seatPos = (seat, u, y, v) => {
    switch (seat) {
      case 0: return [u, y, v];
      case 1: return [v, y, -u];
      case 2: return [-u, y, -v];
      default: return [-v, y, u];
    }
  };
  const seatQuat = (seat, local) => Quat.mul(YAW[seat], local);

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;

  // 每家出牌的位置：牌平放，字朝玩家，方便一眼看清四家出了什么
  const SPOTS = [[0, 5.75], [15.2, -0.4], [0, -5.75], [-15.2, -0.4]];
  const PLAY_SCALE = 3.75;
  // 亮主的牌摆在各家出牌的位置，比出牌略大。对家的往外挪一点：发牌时中央那叠牌很高，会挡住它。
  // 自己的放在左边、按钮栏上方：亮主和埋底的按钮栏在正中偏下，手机上占了快一半宽。
  // 亮主和埋底时桌上没有出牌，左家亮的牌也不会同时在桌上，这块地方是空的。
  const BID_SCALE = 4.1;
  const BID_SPOTS = [[-15, 0.2], SPOTS[1], [0, -7.4], SPOTS[3]];
  const HUMAN_SCALE = 5.5;
  // 赢来的牌堆放在四个角，底牌放在对家右手边
  const PILES = [[21.5, 5.6], [21.5, -13.6], [-21.5, -13.6], [-21.5, 5.6]];
  const KITTY_SPOT = [13.2, -12.4];
  // 闲家赢到的分牌正面朝上摊开。对手是闲家：摊在右手盖着的手牌前，一列（牌多分两列）。
  // 我们是闲家：摊在你的左前方，一行（牌多分两行），离镜头近、牌也大，看得清；按钮栏为它往右让。
  // 范围避开出牌位置、四角的牌堆和底牌堆。
  const WON_SCALE = 2.4;
  const WON_RIGHT = { cols: [18.9, 21.7], z0: -11, z1: 3.3, perCol: 12 };
  const WON_MINE = { scale: 3, x0: -19, x1: -4.5, z: 5.5, rowsZ: [4.7, 6.3], perRow: 12 };
  // 右手一次出好几张时会摊到分牌上：分牌贴着桌面叠得很薄，出的牌整体抬高一点，总是压在分牌上面
  const WON_LAYER = 0.005;
  const PLAY_LIFT = 0.16;

  class Scene {
    constructor(canvas) {
      this.canvas = canvas;
      this.gfx = new Gfx(canvas);
      this.speed = 1;
      this.tweens = [];
      this.anims = [];
      this.particles = [];
      this.rings = [];
      this.cards = [];
      this.seats = [];
      this.flash = 0;
      this.shake = 0;
      this.hoverId = null;
      this.selected = new Set();
      this.mouse = [0, 0];
      this.parallax = [0, 0];
      this.interactive = false;
      this.dimFn = null;
      this.glow = new Set();
      this.sorter = (a, b) => a - b;
      this.keyGroup = () => 0;
      this.camHome = { eye: [0, 50.5, 22.6], at: [0, 0, 3.1] };
      this.cam = { eye: this.camHome.eye.slice(), at: this.camHome.at.slice(), fov: 34 * (Math.PI / 180) };
      this.orbit = null;
      this.onSound = null;
      this.statics = [];
      this.idleFrames = 0;
      this.lastHover = null;
      this.lastSelectedN = 0;
      this.consoleKey = '';
      this.buildWorld();
      this.gfx.onRestored = () => this.buildWorld();
      this.frame = this.frame.bind(this);
      this.lastNow = performance.now();
      requestAnimationFrame(this.frame);
    }

    buildWorld() {
      const g = this.gfx;
      this.statics = [];
      const atlas = this.atlasInfo || Art.buildAtlas();
      this.atlasInfo = atlas;
      this.atlasTex = g.texture(atlas.canvas);
      this.cardMeshGl = g.mesh(cardMesh(CW, CH, CT, 0.075, 5));
      this.tileDim = new Float32Array([CW, CH, CT]);
      this.backCell = new Float32Array(atlas.backCell);

      const feltTex = g.texture(Art.buildFelt(), { repeat: true });
      const woodTex = g.texture(Art.buildWood(), { repeat: true });
      const model = (x, y, z) => M4.compose(new Float32Array(16), [x, y, z], Quat.identity(), 1);
      this.statics.push({ mesh: g.mesh(planeRect(TABLE_X, TABLE_Z, 0.28)), model: model(0, 0, 0), tex: feltTex, gloss: [0.03, 12] });
      const lenX = 2 * TABLE_X + 2.5;
      const lenZ = 2 * TABLE_Z + 2.5;
      const longZ = g.mesh(roundedBox(lenX, 1.05, 1.25, 0.28, 3));
      const longX = g.mesh(roundedBox(1.25, 1.05, lenZ, 0.28, 3));
      const wood = (mesh, x, y, z, uvMode) => ({ mesh, model: model(x, y, z), tex: woodTex, gloss: [0.45, 45], uvMode });
      this.statics.push(wood(longZ, 0, 0.16, TABLE_Z + 0.6, 1), wood(longZ, 0, 0.16, -TABLE_Z - 0.6, 1), wood(longX, TABLE_X + 0.6, 0.16, 0, 2), wood(longX, -TABLE_X - 0.6, 0.16, 0, 2));
      this.statics.push(wood(g.mesh(roundedBox(lenX + 1.4, 2.4, lenZ + 1.4, 0.4, 2)), 0, -1.5, 0, 1));

      if (!this.consoleCanvas) {
        this.consoleCanvas = Art.makeCanvas(1536, 1024);
        this.consoleState = { turn: -1, trump: undefined, level: null, points: 0, dealer: null };
        this.drawConsole();
      }
      this.consoleTex = g.texture(this.consoleCanvas);
      this.statics.push({
        mesh: g.mesh(roundedBox(4.7, 0.3, 4.7, 0.12, 3)),
        model: model(0, CONSOLE_TOP - 0.15, 0),
        tex: this.consoleTex,
        gloss: [0.5, 70],
      });
    }

    drawConsole() {
      const c = this.consoleCanvas.getContext('2d');
      const st = this.consoleState;
      c.fillStyle = '#15171c';
      c.fillRect(0, 0, 1536, 1024);
      c.save();
      c.translate(1024, 0);
      const S = 512;
      const grad = c.createLinearGradient(0, 0, S, S);
      grad.addColorStop(0, '#24272e');
      grad.addColorStop(1, '#0f1014');
      c.fillStyle = grad;
      c.fillRect(0, 0, S, S);
      c.strokeStyle = '#8b7346';
      c.lineWidth = 5;
      c.strokeRect(22, 22, S - 44, S - 44);
      // 当前轮到谁：朝向那家的边发亮
      for (let seat = 0; seat < 4; seat++) {
        c.save();
        c.translate(S / 2, S / 2);
        c.rotate((-seat * Math.PI) / 2);
        if (st.turn === seat) {
          const g2 = c.createLinearGradient(0, 232, 0, 170);
          g2.addColorStop(0, 'rgba(255,190,80,0.8)');
          g2.addColorStop(1, 'rgba(255,190,80,0)');
          c.fillStyle = g2;
          c.fillRect(-180, 170, 360, 62);
        }
        if (st.dealer === seat) {
          c.fillStyle = '#d9534f';
          c.font = 'bold 42px "KaiTi","STKaiti","SimSun",serif';
          c.textAlign = 'center';
          c.textBaseline = 'middle';
          c.fillText('庄', 0, 198);
        }
        c.restore();
      }
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      if (st.trump !== undefined) {
        if (st.trump === null) {
          c.fillStyle = '#ffd27a';
          c.font = 'bold 92px "KaiTi","STKaiti","SimSun",serif';
          c.fillText('无主', S / 2, 196);
        } else {
          c.fillStyle = st.trump === 1 || st.trump === 3 ? '#e8505a' : '#f1ece0';
          Art.suitPath(c, st.trump, S / 2, 188, 118);
        }
      }
      if (st.level !== null) {
        c.fillStyle = '#ffcf70';
        c.font = 'bold 60px "KaiTi","STKaiti","SimSun",serif';
        c.fillText('打 ' + Cards.rankText(st.level), S / 2, 300);
      }
      c.fillStyle = '#d7d2c4';
      c.font = 'bold 50px "Consolas","Menlo",monospace';
      c.fillText(String(st.points) + ' 分', S / 2, 368);
      c.restore();
    }

    setConsole(patch) {
      Object.assign(this.consoleState, patch);
      const key = JSON.stringify(this.consoleState);
      if (key === this.consoleKey) return;
      this.consoleKey = key;
      this.drawConsole();
      this.gfx.updateTexture(this.consoleTex, this.consoleCanvas);
    }

    // ---- 动画基础 ------------------------------------------------------------
    tween(card, to, opt) {
      const o = { dur: 300, delay: 0, arc: 0, ease: easeOut, ...opt };
      for (const tw of this.tweens) {
        if (tw.card === card && !tw.dead) {
          tw.dead = true;
          tw.res();
        }
      }
      return new Promise((res) => {
        this.tweens.push({
          card, res, dead: false, arc: o.arc, ease: o.ease,
          start: performance.now() + o.delay / this.speed,
          dur: Math.max(1, o.dur / this.speed),
          fromPos: card.pos.slice(), fromQ: card.q.slice(), fromS: card.s,
          toPos: to.pos || card.pos.slice(), toQ: to.q || card.q.slice(), toS: to.s === undefined ? card.s : to.s,
        });
      });
    }

    wait(ms) {
      return new Promise((res) => {
        this.anims.push({ start: performance.now(), dur: Math.max(1, ms / this.speed), fn: null, res });
      });
    }

    animate(ms, fn, ease) {
      return new Promise((res) => {
        this.anims.push({ start: performance.now(), dur: Math.max(1, ms / this.speed), fn, res, ease: ease || ((t) => t) });
      });
    }

    burst(pos, count, opts) {
      const o = { speed: 7, up: 8, life: 1.3, size: 1, colors: [[1, 0.82, 0.35], [1, 0.55, 0.2], [1, 0.95, 0.7]], gravity: 15, ...opts };
      for (let i = 0; i < count && this.particles.length < this.gfx.maxParticles; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * o.speed;
        const c = o.colors[Math.floor(Math.random() * o.colors.length)];
        const life = o.life * (0.55 + Math.random() * 0.6);
        this.particles.push({
          p: pos.slice(),
          v: [Math.cos(a) * r, Math.random() * o.up + 1, Math.sin(a) * r],
          life, max: life, c, size: o.size * (0.5 + Math.random() * 0.8), g: o.gravity,
        });
      }
    }

    ring(center, color, maxR, dur) {
      this.rings.push({ center, color, maxR, dur: dur / this.speed, start: performance.now() });
    }

    moveCamera(to, ms) {
      const from = { eye: this.cam.eye.slice(), at: this.cam.at.slice() };
      return this.animate(ms, (t) => {
        for (let i = 0; i < 3; i++) {
          this.cam.eye[i] = lerp(from.eye[i], to.eye[i], t);
          this.cam.at[i] = lerp(from.at[i], to.at[i], t);
        }
      }, easeInOut);
    }

    // ---- 一局的摆放 ----------------------------------------------------------
    newHand() {
      this.tweens.forEach((t) => { if (!t.dead) { t.dead = true; t.res(); } });
      this.tweens = [];
      this.cards = [];
      // shown：亮在桌上的牌。它们仍在 hand 里（裁判也这样算），只是排手牌和点选时跳过
      this.seats = [0, 1, 2, 3].map(() => ({ hand: [], pile: [], play: [], shown: [] }));
      this.won = [];        // 闲家赢到的分牌，摊在 wonSeat 面前
      this.wonSeat = 1;
      this.kitty = [];
      this.hoverId = null;
      this.selected = new Set();
      this.glow = new Set();
      this.interactive = false;
      this.dimFn = null;
      const waits = [];
      // 牌堆：整副牌从上方落到桌子中央，发牌顺序对应从顶上往下拿
      for (let id = 0; id < 108; id++) {
        const stackIndex = 107 - id;
        const pos = [0, CONSOLE_TOP + CT / 2 + stackIndex * CT * 1.15, 0];
        const q = FLAT_DOWN;
        const card = {
          id, kind: null, pos: [pos[0] + (Math.random() - 0.5) * 14, 14 + stackIndex * 0.1, pos[2] + (Math.random() - 0.5) * 10], q, s: 3.3,
          lift: 0, emissive: new Float32Array(3), dim: 1, model: new Float32Array(16), cell: null, drawPos: null,
        };
        this.cards.push(card);
        waits.push(this.tween(card, { pos }, { dur: 620, delay: stackIndex * 7, ease: easeOut }));
      }
      return Promise.all(waits);
    }

    setKind(id, kind) {
      const c = this.cards[id];
      c.kind = kind;
      c.cell = kind === null ? null : new Float32Array(this.atlasInfo.cell(kind));
    }

    /** 拿在手里的牌：手牌去掉亮在桌上的。 */
    held(seat) {
      const S = this.seats[seat];
      return S.shown.length ? S.hand.filter((id) => !S.shown.includes(id)) : S.hand;
    }

    /** 玩家手牌的布局。分门之间留一点空隙，主牌在最左。 */
    humanSlots() {
      const hand = this.held(0);
      const n = hand.length;
      const scale = HUMAN_SCALE;
      const w = CW * scale;
      const groupGap = 0.55;
      let gaps = 0;
      for (let i = 1; i < n; i++) {
        if (this.keyGroup(this.cards[hand[i]].kind) !== this.keyGroup(this.cards[hand[i - 1]].kind)) gaps++;
      }
      const maxW = 57.5;
      const spacing = n > 1 ? Math.min(3.1, (maxW - w - gaps * groupGap) / (n - 1)) : 0;
      const total = w + spacing * Math.max(0, n - 1) + gaps * groupGap;
      let x = -total / 2 + w / 2;
      const out = [];
      for (let i = 0; i < n; i++) {
        if (i > 0 && this.keyGroup(this.cards[hand[i]].kind) !== this.keyGroup(this.cards[hand[i - 1]].kind)) x += groupGap;
        const t = total > 0 ? x / (total / 2) : 0; // -1..1
        const angle = -t * 0.05;
        // 弧形只在牌面平面内偏移，层次沿法线方向一张张加，右边的牌一定压在左边的牌上
        const arc = (1 - t * t) * 0.8;
        const tiltS = Math.sin(HAND_TILT);
        const tiltC = Math.cos(HAND_TILT);
        const layer = i * 0.03;
        const y = CH * scale * 0.5 * tiltC + 0.15 + arc * tiltC + layer * tiltS;
        const z = 13.9 - arc * tiltS + layer * tiltC;
        const q = Quat.mul(Quat.axis(1, 0, 0, -HAND_TILT), Quat.axis(0, 0, 1, angle));
        out.push({ id: hand[i], pos: [x, y, z], q, s: scale });
        x += spacing;
      }
      return out;
    }

    /** 电脑手牌：牌背朝上斜靠着，只能看到张数。 */
    otherSlots(seat) {
      const hand = this.held(seat);
      const n = hand.length;
      const top = seat === 2;
      const scale = top ? 2.5 : 2.15;
      const spacing = Math.min(top ? 0.78 : 0.62, (top ? 21 : 16) / Math.max(n, 1));
      const total = spacing * Math.max(0, n - 1);
      const q = seatQuat(seat, Quat.axis(1, 0, 0, AI_TILT));
      return hand.map((id, i) => {
        const u = -total / 2 + spacing * i;
        return {
          id,
          pos: seatPos(seat, u, 1.05 + i * 0.008, (top ? 13.3 : 26) - i * 0.012),
          q,
          s: scale,
        };
      });
    }

    layoutHand(seat, dur, arc) {
      const slots = seat === 0 ? this.humanSlots() : this.otherSlots(seat);
      const ps = slots.map((sl) => this.tween(this.cards[sl.id], { pos: sl.pos, q: sl.q, s: sl.s }, { dur: dur === undefined ? 240 : dur, arc: arc || 0 }));
      return Promise.all(ps);
    }

    sortHuman() {
      const S = this.seats[0];
      S.hand.sort((a, b) => this.sorter(this.cards[a].kind, this.cards[b].kind) || a - b);
    }

    /** 发一张牌：从牌堆飞到手里，玩家自己的牌一路翻过来。 */
    dealCard(seat, id, kind) {
      const S = this.seats[seat];
      if (kind !== null && kind !== undefined) this.setKind(id, kind);
      S.hand.push(id);
      if (seat === 0) this.sortHuman();
      const slots = seat === 0 ? this.humanSlots() : this.otherSlots(seat);
      for (const sl of slots) {
        const fresh = sl.id === id;
        this.tween(this.cards[sl.id], { pos: sl.pos, q: sl.q, s: sl.s }, {
          dur: fresh ? 300 : 170, arc: fresh ? 2.6 : 0, ease: fresh ? easeInOut : easeOut,
        });
      }
      if (this.onSound) this.onSound('deal');
    }

    /**
     * 亮主：亮出的牌（一张或一对）正面朝上摆在亮主人面前的桌上，一直留到庄家扣完底（returnShown）。
     * 被反主时，前一家亮的牌先收回手里，电脑的重新盖住。
     */
    async showBid(seat, ids, kinds) {
      const relayout = new Set([seat]);
      this.seats.forEach((S, s) => {
        const back = S.shown.filter((id) => !(s === seat && ids.includes(id)));
        if (!back.length) return;
        if (s !== 0) back.forEach((id) => this.setKind(id, null));
        S.shown = S.shown.filter((id) => !back.includes(id));
        relayout.add(s);
      });
      this.seats[seat].shown = ids.slice();
      ids.forEach((id, i) => this.setKind(id, kinds[i]));
      const spot = BID_SPOTS[seat];
      const step = CW * BID_SCALE + 0.45;
      const ps = ids.map((id, i) => this.tween(this.cards[id], {
        pos: [spot[0] + (i - (ids.length - 1) / 2) * step, CT + i * 0.03, spot[1]],
        q: FLAT_UP,
        s: BID_SCALE,
      }, { dur: 420, arc: 2.4, ease: easeInOut }));
      for (const s of relayout) ps.push(this.layoutHand(s, 300, s === seat ? 0 : 1.4));
      this.ring([spot[0], 0.03, spot[1]], [1, 0.75, 0.3, 0.9], 6.5, 600);
      this.burst([spot[0], 0.6, spot[1]], 46, { speed: 4, up: 5, life: 0.8, size: 0.7 });
      if (this.onSound) this.onSound('bid');
      await Promise.all(ps);
    }

    /** 庄家扣完底：亮在桌上的牌收回手里，电脑的重新盖住。 */
    returnShown() {
      const ps = [];
      this.seats.forEach((S, s) => {
        if (!S.shown.length) return;
        if (s !== 0) S.shown.forEach((id) => this.setKind(id, null));
        S.shown = [];
        ps.push(this.layoutHand(s, 380, 1.6));
      });
      return Promise.all(ps);
    }

    /** 翻底牌定主。 */
    async flipKitty(id, kind, index) {
      this.setKind(id, kind);
      const pos = [-14.7 + index * 4.2, 0.1, 6.2];
      await this.tween(this.cards[id], { pos, q: FLAT_UP, s: 3.6 }, { dur: 380, arc: 2.1, ease: easeInOut });
      if (this.onSound) this.onSound('deal');
    }

    /** 庄家把底牌拿进手里。 */
    async takeKitty(seat, ids, kinds) {
      const S = this.seats[seat];
      if (kinds) ids.forEach((id, i) => { this.setKind(id, kinds[i]); this.glow.add(id); });
      S.hand.push(...ids);
      if (seat === 0) this.sortHuman();
      await this.layoutHand(seat, 460, 2.2);
    }

    /** 埋牌：八张牌盖着放到桌上。 */
    async bury(seat, ids) {
      const S = this.seats[seat];
      this.glow = new Set();
      this.selected = new Set();
      for (const id of ids) S.hand.splice(S.hand.indexOf(id), 1);
      this.kitty = ids.slice();
      const anchor = this.kittySpot(seat);
      const ps = ids.map((id, i) => this.tween(this.cards[id], {
        pos: [anchor[0], CT + i * CT * 1.2, anchor[2]],
        q: FLAT_DOWN,
        s: 2.7,
      }, { dur: 460, delay: i * 45, arc: 2.3, ease: easeInOut }));
      this.layoutHand(seat, 280);
      await Promise.all(ps);
      if (this.onSound) this.onSound('clack');
    }

    kittySpot() {
      return [KITTY_SPOT[0], 0, KITTY_SPOT[1]];
    }

    /** 出牌：飞到自己面前的出牌区，翻成正面。 */
    async play(seat, ids, kinds) {
      const S = this.seats[seat];
      ids.forEach((id, i) => this.setKind(id, kinds[i]));
      this.selected = new Set();
      this.hoverId = null;
      for (const id of ids) {
        const i = S.hand.indexOf(id);
        if (i >= 0) S.hand.splice(i, 1);
      }
      S.play = ids.slice();
      const spot = SPOTS[seat];
      const room = seat % 2 === 0 ? 30 : 12.5;
      const step = Math.min(2.25, room / Math.max(ids.length, 1));
      const total = step * (ids.length - 1);
      const yaw = Quat.axis(0, 1, 0, (Math.random() - 0.5) * 0.05);
      const q = Quat.mul(yaw, FLAT_UP);
      const ps = ids.map((id, i) => this.tween(this.cards[id], {
        pos: [spot[0] - total / 2 + step * i, CT + PLAY_LIFT + i * 0.03, spot[1]],
        q,
        s: PLAY_SCALE,
      }, { dur: 330, delay: i * 26, arc: 2.6, ease: easeInOut }));
      this.layoutHand(seat, 220);
      await Promise.all(ps);
      if (this.onSound) this.onSound('clack');
      const c = [spot[0], 0.2, spot[1]];
      this.burst(c, 8, { speed: 1.6, up: 2, life: 0.45, size: 0.4, gravity: 8, colors: [[0.85, 0.9, 1], [0.7, 0.8, 0.95]] });
    }

    /** 甩牌失败：想甩的牌亮一下，再收回。 */
    async throwFail(seat, ids, kinds) {
      ids.forEach((id, i) => this.setKind(id, kinds[i]));
      const step = Math.min(2.6, 26 / Math.max(ids.length, 1));
      const total = step * (ids.length - 1);
      const ps = ids.map((id, i) => {
        const pos = [-total / 2 + step * i, 3 + i * 0.03, 1.5];
        return this.tween(this.cards[id], { pos, q: Quat.axis(1, 0, 0, -1.2), s: 3.9 }, { dur: 340, arc: 1.2, ease: easeInOut });
      });
      await Promise.all(ps);
      this.shake = 0.3;
      this.flash = 0.5;
      await this.wait(900);
      if (seat !== 0) ids.forEach((id) => { this.setKind(id, null); });
      await this.layoutHand(seat, 280);
    }

    /**
     * 一墩结束：赢家的牌先亮一下，然后收到赢家的牌堆。
     * wonIds：闲家赢到的分牌，不进牌堆，正面朝上摊到 wonSeat 面前；庄家方守住的分照旧盖着收走。
     */
    async collect(winner, ids, points, toAttackers, wonIds) {
      const S = this.seats[winner];
      const winCards = this.seats[winner].play;
      for (const id of winCards) this.glow.add(id);
      await this.wait(points > 0 ? 620 : 460);
      this.glow = new Set();
      const won = wonIds || [];
      const toPile = ids.filter((id) => !won.includes(id));
      const pileCount = S.pile.length;
      const anchor = [PILES[winner][0], 0, PILES[winner][1]];
      const q = FLAT_DOWN;
      const ps = toPile.map((id, i) => this.tween(this.cards[id], {
        pos: [anchor[0], CT + (pileCount + i) * CT * 1.1, anchor[2]],
        q,
        s: 2.7,
      }, { dur: 420, delay: i * 16, arc: 1.8, ease: easeInOut }));
      S.pile.push(...toPile);
      for (const s of this.seats) s.play = [];
      if (won.length) {
        this.won.push(...won);
        ps.push(this.layoutWon(won));
      }
      await Promise.all(ps);
      if (points > 0) {
        const c = won.length ? this.wonCenter() : [anchor[0], 0.3, anchor[2]];
        this.ring(c, toAttackers ? [1, 0.55, 0.3, 0.85] : [0.45, 0.8, 1, 0.75], 4.6, 520);
        this.burst(c, Math.min(60, 14 + points), { speed: 4, up: 5, life: 0.8, size: 0.7, colors: toAttackers ? [[1, 0.6, 0.3], [1, 0.82, 0.4]] : [[0.5, 0.8, 1], [0.8, 0.92, 1]] });
      }
      if (this.onSound) this.onSound(points > 0 ? 'points' : 'sweep');
    }

    /** 分牌摊开的位置：按 5、10、K 排，同点数按花色；后面的牌压着前面的，露出左上角的点数。 */
    wonSlots() {
      const key = (id) => {
        const k = this.cards[id].kind;
        return Cards.rankOf(k) * 4 + Cards.suitOf(k);
      };
      const list = this.won.slice().sort((a, b) => key(a) - key(b) || a - b);
      if (this.wonSeat === 0) {
        const M = WON_MINE;
        const w = CW * M.scale;
        const rows = list.length > M.perRow ? 2 : 1;
        const per = Math.ceil(list.length / rows);
        const step = per > 1 ? Math.min(w * 0.6, (M.x1 - M.x0 - w) / (per - 1)) : 0;
        // 第二行压住第一行的下半截，第一行仍露出左上角的点数
        return list.map((id, i) => ({
          id,
          pos: [M.x0 + w / 2 + step * (i % per), CT + i * WON_LAYER, rows === 1 ? M.z : M.rowsZ[Math.floor(i / per)]],
          s: M.scale,
        }));
      }
      const s = WON_SCALE;
      const h = CH * s;
      const R = WON_RIGHT;
      const cols = list.length > R.perCol ? 2 : 1;
      const per = Math.ceil(list.length / cols);
      const step = per > 1 ? Math.min(h * 0.3, (R.z1 - R.z0 - h) / (per - 1)) : 0;
      return list.map((id, i) => {
        const col = Math.floor(i / per);
        const row = i % per;
        return { id, pos: [R.cols[col], CT + i * WON_LAYER, R.z0 + h / 2 + step * row], s };
      });
    }

    layoutWon(fresh) {
      const ps = this.wonSlots().map((sl) => {
        const isNew = fresh && fresh.includes(sl.id);
        return this.tween(this.cards[sl.id], { pos: sl.pos, q: FLAT_UP, s: sl.s }, {
          dur: isNew ? 460 : 260, arc: isNew ? 2.2 : 0, ease: easeInOut,
        });
      });
      return Promise.all(ps);
    }

    wonCenter() {
      const slots = this.wonSlots();
      const c = [0, 0.3, 0];
      for (const sl of slots) { c[0] += sl.pos[0] / slots.length; c[2] += sl.pos[2] / slots.length; }
      return c;
    }

    /** 亮底牌。我们赚的分牌摊在左前方时，底牌从它右边排起，不盖住分牌。 */
    async revealKitty(ids, kinds) {
      const left = this.wonSeat === 0 && this.won.length ? WON_MINE.x1 + 1.5 + 3.75 / 2 : -14.7;
      const step = (14.7 - left) / Math.max(1, ids.length - 1);
      const ps = ids.map((id, i) => {
        this.setKind(id, kinds[i]);
        return this.tween(this.cards[id], {
          pos: [left + i * step, 0.03 + i * 0.01, 6.2],
          q: FLAT_UP,
          s: 3.75,
        }, { dur: 560, delay: i * 75, arc: 2.4, ease: easeInOut });
      });
      await Promise.all(ps);
    }

    celebrate(team) {
      this.flash = 1;
      this.shake = 0.6;
      for (const seat of [team, team + 2]) {
        const c = seatPos(seat, 0, 1.5, seat % 2 === 0 ? 9 : 16);
        this.burst(c, 240, { speed: 12, up: 17, life: 2.2, size: 1.35 });
        this.ring([c[0], 0.03, c[2]], [1, 0.8, 0.35, 1], 17, 1200);
      }
      if (this.onSound) this.onSound('win');
    }

    // ---- 拾取 ----------------------------------------------------------------
    pick(x, y) {
      // x, y 是横屏画面里的坐标（页面可能整个转了 90 度），按画布的布局尺寸换算
      if (!this.vpInv || !this.seats[0]) return null;
      const nx = (x / this.canvas.clientWidth) * 2 - 1;
      const ny = 1 - (y / this.canvas.clientHeight) * 2;
      const near = M4.transform(this.vpInv, [nx, ny, -1]);
      const far = M4.transform(this.vpInv, [nx, ny, 1]);
      const ro = [near[0], near[1], near[2]];
      const rd = V3.norm(V3.sub([far[0], far[1], far[2]], ro));
      const list = this.held(0); // 桌上亮着的牌点不到，不能拿来扣底
      // 右边的牌压在左边的牌上面，从最上面一张往下找
      for (let i = list.length - 1; i >= 0; i--) {
        const c = this.cards[list[i]];
        const inv = Quat.conj(c.q);
        const lo = Quat.rotate(inv, V3.sub(ro, c.drawPos || c.pos));
        const ld = Quat.rotate(inv, rd);
        if (Math.abs(ld[2]) < 1e-6) continue;
        const t = -lo[2] / ld[2];
        if (t <= 0) continue;
        const x = (lo[0] + ld[0] * t) / c.s;
        const y = (lo[1] + ld[1] * t) / c.s;
        if (Math.abs(x) <= CW / 2 && Math.abs(y) <= CH / 2) return list[i];
      }
      return null;
    }

    project(pos) {
      if (!this.vp) return null;
      const p = M4.transform(this.vp, pos);
      return { x: (p[0] * 0.5 + 0.5) * this.canvas.clientWidth, y: (1 - (p[1] * 0.5 + 0.5)) * this.canvas.clientHeight };
    }

    seatAnchor(seat) {
      return seatPos(seat, 0, 1, seat % 2 === 0 ? 9 : 16);
    }

    // ---- 每帧 ----------------------------------------------------------------
    frame(now) {
      requestAnimationFrame(this.frame);
      const dt = Math.max(0, Math.min(0.05, (now - this.lastNow) / 1000));
      this.lastNow = now;
      const clock = performance.now();

      this.tweens = this.tweens.filter((tw) => {
        if (tw.dead) return false;
        const t = (clock - tw.start) / tw.dur;
        if (t < 0) return true;
        const k = Math.min(1, t);
        const e = tw.ease(k);
        const p = tw.card.pos;
        p[0] = lerp(tw.fromPos[0], tw.toPos[0], e);
        p[1] = lerp(tw.fromPos[1], tw.toPos[1], e) + (tw.arc ? Math.sin(k * Math.PI) * tw.arc : 0);
        p[2] = lerp(tw.fromPos[2], tw.toPos[2], e);
        tw.card.q = Quat.slerp(tw.fromQ, tw.toQ, e);
        tw.card.s = lerp(tw.fromS, tw.toS, e);
        if (t >= 1) {
          tw.res();
          return false;
        }
        return true;
      });

      this.anims = this.anims.filter((a) => {
        const t = Math.min(1, (clock - a.start) / a.dur);
        if (a.fn) a.fn(a.ease ? a.ease(t) : t);
        if (t >= 1) {
          a.res();
          return false;
        }
        return true;
      });

      let pc = 0;
      const buf = this.gfx.partData;
      this.particles = this.particles.filter((p) => {
        p.life -= dt * this.speed;
        if (p.life <= 0) return false;
        p.v[1] -= p.g * dt;
        p.p[0] += p.v[0] * dt;
        p.p[1] += p.v[1] * dt;
        p.p[2] += p.v[2] * dt;
        if (p.p[1] < 0.05) {
          p.p[1] = 0.05;
          p.v[1] *= -0.45;
          p.v[0] *= 0.7;
          p.v[2] *= 0.7;
        }
        const a = Math.min(1, p.life / p.max * 1.6);
        const o = pc * 8;
        buf[o] = p.p[0]; buf[o + 1] = p.p[1]; buf[o + 2] = p.p[2];
        buf[o + 3] = p.c[0]; buf[o + 4] = p.c[1]; buf[o + 5] = p.c[2]; buf[o + 6] = a;
        buf[o + 7] = p.size;
        pc++;
        return true;
      });

      const ringList = [];
      this.rings = this.rings.filter((r) => {
        const t = (clock - r.start) / r.dur;
        if (t >= 1) return false;
        ringList.push({ center: r.center, radius: r.maxR * easeOut(t), color: [r.color[0], r.color[1], r.color[2], r.color[3] * (1 - t)] });
        return true;
      });

      this.flash = Math.max(0, this.flash - dt * 1.6);
      this.shake = Math.max(0, this.shake - dt * 1.3);
      this.parallax[0] = lerp(this.parallax[0], this.mouse[0], Math.min(1, dt * 3));
      this.parallax[1] = lerp(this.parallax[1], this.mouse[1], Math.min(1, dt * 3));

      if (this.orbit !== null) {
        this.orbit += dt * 0.1;
        const R = 42;
        this.cam.eye = [Math.sin(this.orbit) * R, 38, Math.cos(this.orbit) * R];
        this.cam.at = [0, 0, 0];
      }

      // 什么都没动时少画几帧：手机不发烫，动起来时也不受影响
      const lifting = this.cards.some((c) => Math.abs(c.lift - (this.selected.has(c.id) ? 1.8 : c.id === this.hoverId ? 0.7 : 0)) > 0.01);
      const busy = lifting || this.tweens.length || this.particles.length || this.rings.length || this.flash > 0 || this.shake > 0 ||
        this.orbit !== null || this.anims.some((a) => a.fn) || Math.abs(this.parallax[0] - this.mouse[0]) + Math.abs(this.parallax[1] - this.mouse[1]) > 0.002 ||
        this.hoverId !== this.lastHover || this.selected.size !== this.lastSelectedN;
      this.lastHover = this.hoverId;
      this.lastSelectedN = this.selected.size;
      if (!busy && ++this.idleFrames % 3 !== 0) return;

      const size = this.gfx.resize();
      const aspect = size.w / Math.max(size.h, 1);
      const widen = aspect < FIT_ASPECT ? FIT_ASPECT / aspect : 1;
      const ampl = this.shake * this.shake;
      const eye = [
        this.cam.at[0] + (this.cam.eye[0] - this.cam.at[0]) * widen + this.parallax[0] * 0.7 + (Math.random() - 0.5) * ampl,
        this.cam.at[1] + (this.cam.eye[1] - this.cam.at[1]) * widen + this.parallax[1] * 0.35 + (Math.random() - 0.5) * ampl,
        this.cam.at[2] + (this.cam.eye[2] - this.cam.at[2]) * widen + (Math.random() - 0.5) * ampl,
      ];
      const view = M4.lookAt(eye, this.cam.at, [0, 1, 0]);
      const proj = M4.perspective(this.cam.fov, aspect, 1, 220);
      this.vp = M4.mul(proj, view);
      this.vpInv = M4.invert(this.vp);

      const tiles = [];
      const pulse = 0.5 + 0.5 * Math.sin(clock * 0.006);
      for (const c of this.cards) {
        const liftTarget = this.selected.has(c.id) ? 1.8 : c.id === this.hoverId ? 0.7 : 0;
        c.lift = lerp(c.lift, liftTarget, Math.min(1, dt * 16));
        let p = c.pos;
        if (c.lift > 0.002) p = [p[0], p[1] + c.lift * Math.cos(HAND_TILT), p[2] - c.lift * Math.sin(HAND_TILT)];
        c.drawPos = p;
        M4.compose(c.model, p, c.q, c.s);
        const e = c.emissive;
        e[0] = 0; e[1] = 0; e[2] = 0;
        if (this.glow.has(c.id)) {
          e[0] = 0.1 + pulse * 0.12;
          e[1] = 0.07 + pulse * 0.08;
          e[2] = 0.01;
        } else if (this.selected.has(c.id)) {
          e[0] = 0.04; e[1] = 0.05; e[2] = 0.08;
        } else if (c.id === this.hoverId) {
          e[0] = 0.03; e[1] = 0.035; e[2] = 0.04;
        }
        c.dim = this.interactive && this.dimFn && c.kind !== null && this.seats[0].hand.includes(c.id) && this.dimFn(c.kind) ? 0.52 : 1;
        tiles.push({ model: c.model, cell: c.cell, hasFace: c.cell ? 1 : 0, emissive: c.emissive, dim: c.dim });
      }

      if (this.gfx.lost) return; // 动画和牌局照常走，只是先不画
      this.gfx.render({
        vp: this.vp,
        eye,
        statics: this.statics,
        tileMesh: this.cardMeshGl,
        tiles,
        atlas: this.atlasTex,
        tileDim: this.tileDim,
        backCell: this.backCell,
        particleCount: pc,
        rings: ringList,
        flash: this.flash,
      });
    }
  }

  root.TJ.Scene = Scene;
})(typeof self !== 'undefined' ? self : globalThis);
