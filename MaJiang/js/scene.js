/* 3D 牌桌：牌的摆放、动画、镜头、拾取。这里只知道界面该知道的东西：
 * 对手手里的牌在翻开之前 kind 一直是 null，画面上根本没有牌面可画。 */
(function (root) {
  'use strict';
  const { Gfx, Quat, M4, V3, roundedBox, planeRect } = root.MJ.GFX;
  const Art = root.MJ.Art;

  const W = 1;
  const H = 1.35;
  const D = 0.78;
  const TABLE_X = 31.5;
  const TABLE_Z = 18.4;
  const WALL_SCALE = 0.72;
  const CONSOLE_TOP = 0.34;
  const HUMAN_TILT = 0.88;
  const FIT_ASPECT = 2.05; // 窄于这个宽高比时把镜头拉远，保证左右都看得到

  const FLAT_UP = Quat.axis(1, 0, 0, -Math.PI / 2);
  const FLAT_DOWN = Quat.axis(1, 0, 0, Math.PI / 2);
  const STAND = Quat.identity();
  const TILT = Quat.axis(1, 0, 0, -HUMAN_TILT);
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

  // 横屏布局：手牌占满宽度，牌河排成宽而矮的几行，牌墙收在远处两个角上
  const SIDE = { handScale: 1.05, handV: 21.6, meldScale: 1.4, span: 10.75, shift: -0.75, flowerV: 25.2, flowerS: 1.05, revealScale: 1.5 };
  const LOOK = [
    { handScale: 3.82, handV: 14.4, meldScale: 2.55, span: 28.6, flowerS: 1.25, revealScale: 3.82 },
    SIDE,
    { handScale: 1.15, handV: 13.3, meldScale: 1.85, span: 13.6, flowerV: 16.1, flowerS: 0.8, revealScale: 1.75 },
    SIDE,
  ];
  const look = (seat) => LOOK[seat];
  const rowPos = (seat, u, y, v) => seatPos(seat, u + (LOOK[seat].shift || 0), y, v);

  /** 牌墙一圈 72 墩：分在远处左右两个角，各两排。 */
  function wallSlot(r) {
    const i = r % 36;
    const block = r < 36 ? 1 : -1;
    const far = i >= 18;
    const j = far ? 35 - i : i;
    const x = block * (15.4 + j * W * WALL_SCALE * 1.02);
    const z = far ? -15.9 : -14.8;
    return [x, z];
  }

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const lerp = (a, b, t) => a + (b - a) * t;

  class Scene {
    constructor(canvas) {
      this.canvas = canvas;
      this.gfx = new Gfx(canvas);
      this.speed = 1;
      this.tweens = [];
      this.anims = [];
      this.particles = [];
      this.rings = [];
      this.tiles = [];
      this.seats = [];
      this.dice = [];
      this.flash = 0;
      this.shake = 0;
      this.hoverId = null;
      this.selectedId = null;
      this.mouse = [0, 0];
      this.parallax = [0, 0];
      this.interactive = false;
      this.forbidKind = null;
      this.lastDiscard = null;
      this.winGlow = new Set();
      this.cam = { eye: [0, 50.5, 22.2], at: [0, 0, 2.7], fov: 34 * (Math.PI / 180) };
      this.camHome = { eye: [0, 50.5, 22.2], at: [0, 0, 2.7] };
      this.camReveal = { eye: [0, 52, 20], at: [0, 0, 2] };
      this.statics = [];
      this.onSound = null;
      this.orbit = null;
      this.idleFrames = 0;
      this.lastHover = null;
      this.lastSelected = null;
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
      this.atlasTex = g.texture(atlas.canvas, { premultiply: true });
      this.tileMesh = g.mesh(roundedBox(W, H, D, 0.1, 3));
      this.diceMesh = g.mesh(roundedBox(0.82, 0.82, 0.82, 0.14, 3));
      this.diceTex = g.texture(Art.buildDiceAtlas());
      this.tileDim = new Float32Array([W, H, D]);

      const feltTex = g.texture(Art.buildFelt(), { repeat: true });
      const woodTex = g.texture(Art.buildWood(), { repeat: true });
      const model = (x, y, z) => M4.compose(new Float32Array(16), [x, y, z], Quat.identity(), 1);

      this.statics.push({ mesh: g.mesh(planeRect(TABLE_X, TABLE_Z, 0.28)), model: model(0, 0, 0), tex: feltTex, gloss: [0.03, 12] });
      const lenX = 2 * TABLE_X + 2.5;
      const lenZ = 2 * TABLE_Z + 2.5;
      const longZ = g.mesh(roundedBox(lenX, 1.15, 1.25, 0.28, 3));
      const longX = g.mesh(roundedBox(1.25, 1.15, lenZ, 0.28, 3));
      const rimY = 0.2;
      this.statics.push({ mesh: longZ, model: model(0, rimY, TABLE_Z + 0.6), tex: woodTex, gloss: [0.45, 45], uvMode: 1 });
      this.statics.push({ mesh: longZ, model: model(0, rimY, -TABLE_Z - 0.6), tex: woodTex, gloss: [0.45, 45], uvMode: 1 });
      this.statics.push({ mesh: longX, model: model(TABLE_X + 0.6, rimY, 0), tex: woodTex, gloss: [0.45, 45], uvMode: 2 });
      this.statics.push({ mesh: longX, model: model(-TABLE_X - 0.6, rimY, 0), tex: woodTex, gloss: [0.45, 45], uvMode: 2 });
      this.statics.push({ mesh: g.mesh(roundedBox(lenX + 1.4, 2.4, lenZ + 1.4, 0.4, 2)), model: model(0, -1.5, 0), tex: woodTex, gloss: [0.2, 30], uvMode: 1 });

      if (!this.consoleCanvas) {
        this.consoleCanvas = Art.makeCanvas(1536, 1024);
        this.consoleState = { turn: -1, remaining: 144, dealer: -1 };
        this.drawConsole();
      }
      this.consoleTex = g.texture(this.consoleCanvas);
      this.statics.push({
        mesh: g.mesh(roundedBox(4.9, 0.5, 4.9, 0.16, 3)),
        model: model(0, CONSOLE_TOP - 0.25, 0),
        tex: this.consoleTex,
        gloss: [0.55, 70],
      });
    }

    drawConsole() {
      const c = this.consoleCanvas.getContext('2d');
      const st = this.consoleState;
      c.fillStyle = '#17181c';
      c.fillRect(0, 0, 1536, 1024);
      c.save();
      c.translate(1024, 0);
      const S = 512;
      const grad = c.createLinearGradient(0, 0, S, S);
      grad.addColorStop(0, '#26282e');
      grad.addColorStop(1, '#101115');
      c.fillStyle = grad;
      c.fillRect(0, 0, S, S);
      c.strokeStyle = '#8b7346';
      c.lineWidth = 5;
      c.strokeRect(24, 24, S - 48, S - 48);
      const FONT = '"KaiTi","STKaiti","SimSun",serif';
      const windOf = (seat) => (st.dealer < 0 ? '' : ['東', '南', '西', '北'][(seat - st.dealer + 4) % 4]);
      for (let seat = 0; seat < 4; seat++) {
        c.save();
        c.translate(S / 2, S / 2);
        c.rotate((-seat * Math.PI) / 2);
        const on = st.turn === seat;
        if (on) {
          const g2 = c.createLinearGradient(0, 230, 0, 150);
          g2.addColorStop(0, 'rgba(255,190,80,0.75)');
          g2.addColorStop(1, 'rgba(255,190,80,0)');
          c.fillStyle = g2;
          c.fillRect(-150, 150, 300, 80);
        }
        c.font = 'bold 74px ' + FONT;
        c.textAlign = 'center';
        c.textBaseline = 'middle';
        c.fillStyle = on ? '#ffd27a' : st.dealer === seat ? '#d9534f' : '#8d8f96';
        c.fillText(windOf(seat), 0, 186);
        c.restore();
      }
      c.fillStyle = '#ffcf70';
      c.font = 'bold 118px "Consolas","Menlo",monospace';
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(st.remaining), S / 2, S / 2 + 4);
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
    tween(tile, to, opt) {
      const o = { dur: 300, delay: 0, arc: 0, ease: easeOut, ...opt };
      for (const tw of this.tweens) {
        if (tw.tile === tile && !tw.dead) {
          tw.dead = true;
          tw.res();
        }
      }
      return new Promise((res) => {
        this.tweens.push({
          tile, res, dead: false, arc: o.arc, ease: o.ease,
          start: performance.now() + o.delay / this.speed,
          dur: Math.max(1, o.dur / this.speed),
          fromPos: tile.pos.slice(), fromQ: tile.q.slice(), fromS: tile.s,
          toPos: to.pos || tile.pos.slice(), toQ: to.q || tile.q.slice(), toS: to.s === undefined ? tile.s : to.s,
          started: false,
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
    newHand(dealer, dice) {
      const sum = dice[0] + dice[1];
      const side = (dealer + sum - 1) % 4;
      const breakRing = side * 18 + 17 - sum;
      this.tweens.forEach((t) => { if (!t.dead) { t.dead = true; t.res(); } });
      this.tweens = [];
      this.tiles = [];
      this.seats = [0, 1, 2, 3].map(() => ({ hand: [], drawn: null, melds: [], flowers: [], discards: [] }));
      this.lastDiscard = null;
      this.hoverId = null;
      this.selectedId = null;
      this.winGlow = new Set();
      this.interactive = false;
      this.forbidKind = null;
      this.dice = [];
      const waits = [];
      for (let id = 0; id < 144; id++) {
        const stack = Math.floor(id / 2);
        const level = id % 2 === 0 ? 1 : 0;
        const r = (breakRing - stack + 72 * 4) % 72;
        const wallSide = Math.floor(r / 18);
        const j = r % 18;
        const [wx, wz] = wallSlot(r);
        const pos = [wx, (D / 2 + level * D) * WALL_SCALE, wz];
        const q = seatQuat(0, FLAT_DOWN);
        const tile = {
          id, kind: null, pos: [pos[0], pos[1] - 2.4, pos[2]], q, s: WALL_SCALE,
          lift: 0, liftT: 0, emissive: new Float32Array(3), dim: 1,
          model: new Float32Array(16), cell: null,
        };
        this.tiles.push(tile);
        // 自动麻将桌的感觉：牌墙从桌面升起
        const delay = (wallSide * 90) + j * 16 + level * 30;
        waits.push(this.tween(tile, { pos }, { dur: 520, delay, ease: easeOut }));
      }
      return Promise.all(waits);
    }

    setKind(id, kind) {
      const t = this.tiles[id];
      t.kind = kind;
      t.cell = kind === null ? null : new Float32Array(this.atlasInfo.cell(kind));
    }

    /** 计算一家手牌、副露、花牌的目标位置，并动画过去。 */
    layout(seat, dur, opts) {
      const S = this.seats[seat];
      const L = look(seat);
      const yawed = (local) => seatQuat(seat, local);
      const promises = [];
      const o = { dur: dur === undefined ? 240 : dur, ...opts };

      let cursor = L.span;
      const mw = W * L.meldScale * 1.01;
      for (const m of S.melds) {
        m.tiles.forEach((id, i) => {
          const tile = this.tiles[id];
          const stacked = i === 3;
          const col = stacked ? 1 : i;
          const u = cursor - mw * (2 - col) - mw / 2;
          const y = D * L.meldScale * (stacked ? 1.5 : 0.5);
          const showFace = tile.kind !== null && !(m.hidden && !stacked);
          const pos = rowPos(seat, u, y, L.handV + (seat === 0 ? 0.5 : 0.15));
          const q = yawed(showFace ? FLAT_UP : FLAT_DOWN);
          promises.push(this.tween(tile, { pos, q, s: L.meldScale }, { dur: o.dur, arc: m.fresh ? 1.4 : 0 }));
        });
        m.fresh = false;
        cursor -= 3 * mw + L.meldScale * 0.22;
      }

      const hw = W * L.handScale * 1.012;
      const count = S.hand.length;
      // 手牌已满（庄家起手 14 张、吃碰之后）不再摸牌，不给摸牌位留空，否则最左边的牌会出屏
      const slots = count % 3 === 2 ? count : count + 1;
      const drawGap = L.handScale * 0.14;
      const totalW = slots * hw + drawGap;
      const left = (-L.span + cursor) / 2 - totalW / 2;
      const standQ = yawed(seat === 0 ? TILT : STAND);
      const standY = seat === 0
        ? (H / 2 * Math.cos(HUMAN_TILT) + D / 2 * Math.sin(HUMAN_TILT)) * L.handScale
        : H / 2 * L.handScale;
      S.hand.forEach((id, i) => {
        const u = left + hw * (i + 0.5);
        const pos = rowPos(seat, u, standY, L.handV);
        promises.push(this.tween(this.tiles[id], { pos, q: standQ, s: L.handScale }, { dur: o.dur }));
      });
      if (S.drawn !== null) {
        const u = left + hw * (count + 0.5) + drawGap;
        const pos = rowPos(seat, u, standY, L.handV);
        promises.push(this.tween(this.tiles[S.drawn], { pos, q: standQ, s: L.handScale }, { dur: o.dur, arc: o.drawArc || 0 }));
      }

      S.flowers.forEach((id, i) => {
        const f = this.flowerSlot(seat, i);
        promises.push(this.tween(this.tiles[id], { pos: f.pos, q: yawed(FLAT_UP), s: f.s }, { dur: o.dur, arc: 0 }));
      });
      return Promise.all(promises);
    }

    flowerSlot(seat, i) {
      const L = look(seat);
      const s = L.flowerS;
      const step = W * s * 1.04;
      if (seat === 0) {
        // 玩家的花牌排在右边，手牌上方够不到的地方，两列
        const col = i % 2;
        const row = Math.floor(i / 2);
        return { pos: [29.6 - col * step, D * s / 2, 8.2 - row * H * s * 1.06], s };
      }
      // 电脑的放在自己外侧
      return { pos: seatPos(seat, -3.6 * step + i * step, D * s / 2, L.flowerV), s };
    }

    dealTiles(seat, ids, kinds) {
      const S = this.seats[seat];
      ids.forEach((id, i) => {
        if (kinds) this.setKind(id, kinds[i]);
        S.hand.push(id);
      });
      const L = look(seat);
      const hw = W * L.handScale * 1.012;
      const left = -hw * 7.2;
      const standQ = seatQuat(seat, seat === 0 ? TILT : STAND);
      const standY = seat === 0
        ? (H / 2 * Math.cos(HUMAN_TILT) + D / 2 * Math.sin(HUMAN_TILT)) * L.handScale
        : H / 2 * L.handScale;
      const start = S.hand.length - ids.length;
      ids.forEach((id, i) => {
        const u = left + hw * (start + i + 0.5);
        const pos = rowPos(seat, u, standY, L.handV);
        this.tween(this.tiles[id], { pos, q: standQ, s: L.handScale }, { dur: 300, delay: i * 26, arc: 2.2, ease: easeInOut });
      });
      return this.wait(150);
    }

    /** 开局理牌：牌先趴下，排好序，再一张张立起来。 */
    async sortHuman(animate) {
      const S = this.seats[0];
      const order = () => {
        S.hand.sort((a, b) => this.tiles[a].kind - this.tiles[b].kind || a - b);
      };
      if (!animate) {
        order();
        return this.layout(0, 200);
      }
      const L = look(0);
      const yFlat = D * L.handScale / 2;
      const down = S.hand.map((id, i) => {
        const t = this.tiles[id];
        return this.tween(t, { pos: [t.pos[0], yFlat, t.pos[2]], q: seatQuat(0, FLAT_DOWN) }, { dur: 240, delay: i * 18 });
      });
      await Promise.all(down);
      order();
      const hw = W * L.handScale * 1.012;
      const totalW = (S.hand.length + 1) * hw + 0.3;
      const left = -totalW / 2 + (S.melds.length ? 0 : 0);
      S.hand.forEach((id, i) => {
        const t = this.tiles[id];
        t.pos = [left + hw * (i + 0.5), yFlat, L.handV];
      });
      await this.wait(90);
      return this.layout(0, 300);
    }

    tileAnchor(seat) {
      const L = look(seat);
      return seatPos(seat, 0, 1, L.handV - 1);
    }

    drawTile(seat, id, kind) {
      const S = this.seats[seat];
      if (kind !== null && kind !== undefined) this.setKind(id, kind);
      if (S.drawn !== null) {
        S.hand.push(S.drawn);
        if (seat === 0) S.hand.sort((a, b) => this.tiles[a].kind - this.tiles[b].kind || a - b);
      }
      S.drawn = id;
      return this.layout(seat, 280, { drawArc: 2.4 });
    }

    /** 亮花：飞到自己面前的花牌区，翻开。 */
    async flower(seat, id, kind) {
      const S = this.seats[seat];
      this.setKind(id, kind);
      const inHand = S.hand.indexOf(id);
      if (inHand >= 0) S.hand.splice(inHand, 1);
      if (S.drawn === id) S.drawn = null;
      S.flowers.push(id);
      const { pos, s } = this.flowerSlot(seat, S.flowers.length - 1);
      await this.tween(this.tiles[id], { pos, q: seatQuat(seat, FLAT_UP), s }, { dur: 360, arc: 2.6, ease: easeInOut });
      this.burst(pos, 26, { speed: 3, up: 4, life: 0.8, size: 0.7, colors: [[1, 0.6, 0.75], [1, 0.85, 0.4], [0.95, 0.95, 1]] });
      if (this.onSound) this.onSound('flower');
    }

    discardSlot(seat, i) {
      const s = 1.86;
      const perRow = 10;
      const row = Math.floor(i / perRow);
      const col = i % perRow;
      const u = (col - (perRow - 1) / 2) * W * s * 1.03;
      // 上下两家的牌河紧贴中间，左右两家从更外面开始，四条牌河才不会撞在一起
      const v = (seat % 2 === 0 ? 2.95 : 10.5) + row * H * s * 1.03 + H * s / 2;
      return { pos: seatPos(seat, u, D * s / 2, v), s };
    }

    async discard(seat, id, kind) {
      const S = this.seats[seat];
      this.setKind(id, kind);
      const idx = S.hand.indexOf(id);
      if (idx >= 0) S.hand.splice(idx, 1);
      if (S.drawn === id) S.drawn = null;
      else if (S.drawn !== null) {
        // 打的不是刚摸的牌：摸来的牌收进手里
        const d = S.drawn;
        S.drawn = null;
        if (seat === 0) {
          S.hand.push(d);
          S.hand.sort((a, b) => this.tiles[a].kind - this.tiles[b].kind || a - b);
        } else {
          S.hand.splice(Math.floor(Math.random() * (S.hand.length + 1)), 0, d);
        }
      }
      if (seat === 0) {
        this.selectedId = null;
        this.hoverId = null;
      }
      const slot = this.discardSlot(seat, S.discards.length);
      S.discards.push(id);
      this.layout(seat, 220);
      const q = seatQuat(seat, FLAT_UP);
      await this.tween(this.tiles[id], { pos: slot.pos, q, s: slot.s }, { dur: 340, arc: 3.2, ease: easeInOut });
      this.burst(slot.pos, 10, { speed: 1.8, up: 2, life: 0.5, size: 0.42, gravity: 8, colors: [[0.85, 0.9, 0.85], [0.75, 0.82, 0.78]] });
      this.shake = Math.max(this.shake, 0.05);
      if (this.onSound) this.onSound('clack');
      this.lastDiscard = id;
    }

    /** 碰、吃、杠。evt 是裁判发来的公开事件。 */
    async meld(evt) {
      const S = this.seats[evt.seat];
      const L = look(evt.seat);
      if (evt.kinds) evt.ids.forEach((id, i) => this.setKind(id, evt.kinds[i]));
      this.lastDiscard = null;
      if (evt.upgrade) {
        const m = S.melds.find((x) => x.tiles.some((id) => evt.ids.includes(id)));
        m.tiles = evt.ids.slice();
        m.fresh = true;
      } else {
        for (const id of evt.ids) {
          const i = S.hand.indexOf(id);
          if (i >= 0) S.hand.splice(i, 1);
          if (S.drawn === id) S.drawn = null;
        }
        if (S.drawn !== null) {
          S.hand.push(S.drawn);
          S.drawn = null;
          if (evt.seat === 0) S.hand.sort((a, b) => this.tiles[a].kind - this.tiles[b].kind || a - b);
        }
        if (evt.claimedId !== null && evt.from !== evt.seat) {
          const river = this.seats[evt.from].discards;
          const i = river.indexOf(evt.claimedId);
          if (i >= 0) river.splice(i, 1);
        }
        S.melds.push({ tiles: evt.ids.slice(), hidden: evt.sub === 'an', fresh: true });
      }
      const center = seatPos(evt.seat, L.span - S.melds.length * 3 * W * L.meldScale * 0.8, 0.05, L.handV);
      const isGang = evt.mtype === 'gang';
      await this.layout(evt.seat, isGang ? 420 : 340);
      this.ring(center, isGang ? [1, 0.55, 0.2, 0.9] : [0.5, 0.95, 0.75, 0.75], isGang ? 8 : 5.2, isGang ? 620 : 480);
      this.burst([center[0], 0.6, center[2]], isGang ? 56 : 26, { speed: isGang ? 7 : 4, up: isGang ? 8 : 5, life: 0.9, size: 0.8 });
      this.shake = Math.max(this.shake, isGang ? 0.4 : 0.16);
      if (this.onSound) this.onSound(isGang ? 'kong' : 'clack');
    }

    /** 加杠先把第四张推出来悬着，等别家决定抢不抢。 */
    async kongAttempt(seat, id, kind) {
      const S = this.seats[seat];
      this.setKind(id, kind);
      const i = S.hand.indexOf(id);
      if (i >= 0) S.hand.splice(i, 1);
      if (S.drawn === id) S.drawn = null;
      if (S.drawn !== null) {
        S.hand.push(S.drawn);
        S.drawn = null;
        if (seat === 0) S.hand.sort((a, b) => this.tiles[a].kind - this.tiles[b].kind || a - b);
      }
      this.layout(seat, 220);
      const L = look(seat);
      await this.tween(this.tiles[id], { pos: seatPos(seat, L.span - 1.5, 2.6, L.handV - 1.1), q: seatQuat(seat, TILT), s: L.meldScale }, { dur: 320, ease: easeInOut });
    }

    /** 一家胡牌：把手牌推倒，亮出胜利特效。 */
    async revealAll(result) {
      this.interactive = false;
      this.hoverId = null;
      this.selectedId = null;
      this.lastDiscard = null;
      const winners = new Set(result.winners.map((w) => w.seat));
      await this.moveCamera(this.camReveal, 700);
      const promises = [];
      result.seats.forEach((s) => {
        const S = this.seats[s.seat];
        const L = look(s.seat);
        s.melds.forEach((m) => m.ids.forEach((id, i) => this.setKind(id, m.kinds[i])));
        S.melds.forEach((m) => { m.hidden = false; });
        s.hand.forEach((h) => this.setKind(h.id, h.kind));
        const order = s.hand.map((h) => h.id);
        const inDrawn = S.drawn !== null && order.includes(S.drawn) ? S.drawn : null;
        const rest = order.filter((id) => id !== inDrawn);
        S.hand = rest;
        S.drawn = inDrawn;
        this.layout(s.seat, 300);
        const allIds = inDrawn !== null ? rest.concat([inDrawn]) : rest;
        let cursor = L.span;
        cursor -= S.melds.length * (3 * W * L.meldScale * 1.01 + 0.32);
        const rw = W * L.revealScale * 1.012;
        const totalW = (rest.length % 3 === 2 ? rest.length : rest.length + 1) * rw + L.revealScale * 0.14;
        const left = (-L.span + cursor) / 2 - totalW / 2;
        allIds.forEach((id, i) => {
          const tile = this.tiles[id];
          const u = left + rw * (i + 0.5) + (id === inDrawn ? L.revealScale * 0.14 : 0);
          const scale = L.revealScale;
          const pos = rowPos(s.seat, u, D * scale / 2, L.handV);
          promises.push(this.tween(tile, { pos, q: seatQuat(s.seat, FLAT_UP), s: scale }, {
            dur: 420, delay: i * 26 + (winners.has(s.seat) ? 0 : 120), arc: 1.3, ease: easeInOut,
          }));
        });
      });
      for (const w of result.winners) {
        if (w.how === 'ron' || w.how === 'rob') {
          // 胡的那张飞到赢家面前
          const tile = this.tiles[w.winId];
          this.setKind(w.winId, w.winKind);
          const L = look(w.seat);
          const pos = seatPos(w.seat, L.span - (this.seats[w.seat].melds.length * 3.4 * L.meldScale) - L.revealScale, D * L.revealScale / 2, L.handV - L.revealScale * 1.2);
          promises.push(this.tween(tile, { pos, q: seatQuat(w.seat, FLAT_UP), s: L.revealScale }, { dur: 620, delay: 180, arc: 4, ease: easeInOut }));
          this.winGlow.add(w.winId);
        } else if (w.winId !== null && w.winId !== undefined) {
          this.winGlow.add(w.winId);
        }
      }
      await Promise.all(promises);
      for (const w of result.winners) {
        const center = this.tileAnchor(w.seat);
        this.flash = 1;
        this.shake = 0.7;
        this.burst(center, 280, { speed: 13, up: 18, life: 2.1, size: 1.4 });
        this.ring([center[0], 0.05, center[2]], [1, 0.8, 0.35, 1], 19, 1200);
        this.ring([center[0], 0.05, center[2]], [1, 0.5, 0.2, 0.7], 12, 800);
        if (this.onSound) this.onSound('win');
      }
    }

    async celebrate(seat) {
      const center = this.tileAnchor(seat);
      this.burst(center, 220, { speed: 11, up: 16, life: 2.2, size: 1.2 });
    }

    // ---- 骰子 ----------------------------------------------------------------
    rollDice(a, b) {
      const faceQuat = (v) => {
        switch (v) {
          case 6: return Quat.axis(1, 0, 0, Math.PI);
          case 2: return Quat.axis(0, 0, 1, Math.PI / 2);
          case 5: return Quat.axis(0, 0, 1, -Math.PI / 2);
          case 3: return Quat.axis(1, 0, 0, -Math.PI / 2);
          case 4: return Quat.axis(1, 0, 0, Math.PI / 2);
          default: return Quat.identity();
        }
      };
      const rest = CONSOLE_TOP + 0.41;
      const mk = (v, endX, endZ, startX, spinAxis, spins) => {
        const yaw = Quat.axis(0, 1, 0, Math.random() * Math.PI * 2);
        return {
          model: new Float32Array(16),
          final: Quat.mul(yaw, faceQuat(v)),
          end: [endX, rest, endZ],
          start: [startX, 7, 7.5],
          axis: spinAxis,
          spins,
          pos: [startX, 7, 7.5],
          q: Quat.identity(),
        };
      };
      this.dice = [
        mk(a, -1.72, -1.72, -2.4, V3.norm([1, 0.4, 0.3]), 13),
        mk(b, 1.72, -1.72, 2.3, V3.norm([0.5, 0.2, 1]), 15),
      ];
      let bounces = 0;
      return this.animate(1150, (t) => {
        for (const d of this.dice) {
          const e = easeOut(t);
          d.pos[0] = lerp(d.start[0], d.end[0], e);
          d.pos[2] = lerp(d.start[2], d.end[2], e);
          const decay = Math.pow(1 - t, 2);
          d.pos[1] = rest + 6.5 * decay * Math.abs(Math.cos(t * Math.PI * 3.5));
          const spin = Quat.axis(d.axis[0], d.axis[1], d.axis[2], (1 - e) * d.spins);
          d.q = Quat.mul(d.final, spin);
        }
        const bounceNow = Math.floor(t * 3.5 + 0.5);
        if (bounceNow > bounces) {
          bounces = bounceNow;
          if (this.onSound) this.onSound('dice');
        }
      });
    }

    // ---- 拾取 ----------------------------------------------------------------
    pick(x, y) {
      // x, y 是横屏画面里的坐标（页面可能整个转了 90 度），按画布的布局尺寸换算
      if (!this.vpInv) return null;
      const nx = (x / this.canvas.clientWidth) * 2 - 1;
      const ny = 1 - (y / this.canvas.clientHeight) * 2;
      const near = M4.transform(this.vpInv, [nx, ny, -1]);
      const far = M4.transform(this.vpInv, [nx, ny, 1]);
      const ro = [near[0], near[1], near[2]];
      const rd = V3.norm(V3.sub([far[0], far[1], far[2]], ro));
      const S = this.seats[0];
      if (!S) return null;
      let best = null;
      let bestT = Infinity;
      const list = S.drawn !== null ? S.hand.concat([S.drawn]) : S.hand;
      for (const id of list) {
        const t = this.tiles[id];
        const inv = Quat.conj(t.q);
        const lo = Quat.rotate(inv, V3.sub(ro, t.drawPos || t.pos)).map((x) => x / t.s);
        const ld = Quat.rotate(inv, rd);
        const hx = W / 2, hy = H / 2, hz = D / 2;
        let tmin = -Infinity;
        let tmax = Infinity;
        const ext = [hx, hy, hz];
        let hit = true;
        for (let i = 0; i < 3; i++) {
          if (Math.abs(ld[i]) < 1e-6) {
            if (Math.abs(lo[i]) > ext[i]) { hit = false; break; }
          } else {
            const t1 = (-ext[i] - lo[i]) / ld[i];
            const t2 = (ext[i] - lo[i]) / ld[i];
            tmin = Math.max(tmin, Math.min(t1, t2));
            tmax = Math.min(tmax, Math.max(t1, t2));
          }
        }
        if (hit && tmax >= tmin && tmin < bestT && tmax > 0) {
          bestT = tmin;
          best = id;
        }
      }
      return best;
    }

    project(pos) {
      if (!this.vp) return null;
      const p = M4.transform(this.vp, pos);
      return { x: (p[0] * 0.5 + 0.5) * this.canvas.clientWidth, y: (1 - (p[1] * 0.5 + 0.5)) * this.canvas.clientHeight };
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
        const p = tw.tile.pos;
        p[0] = lerp(tw.fromPos[0], tw.toPos[0], e);
        p[1] = lerp(tw.fromPos[1], tw.toPos[1], e) + (tw.arc ? Math.sin(k * Math.PI) * tw.arc : 0);
        p[2] = lerp(tw.fromPos[2], tw.toPos[2], e);
        tw.tile.q = Quat.slerp(tw.fromQ, tw.toQ, e);
        tw.tile.s = lerp(tw.fromS, tw.toS, e);
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

      // 粒子
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

      // 鼠标轻微视差，让牌桌有纵深感
      this.parallax[0] = lerp(this.parallax[0], this.mouse[0], Math.min(1, dt * 3));
      this.parallax[1] = lerp(this.parallax[1], this.mouse[1], Math.min(1, dt * 3));

      if (this.orbit !== null) {
        this.orbit += dt * 0.1;
        const R = 42;
        this.cam.eye = [Math.sin(this.orbit) * R, 38, Math.cos(this.orbit) * R];
        this.cam.at = [0, 0, 0];
      }

      const lifting = this.tiles.some((t) => Math.abs(t.lift - (t.id === this.selectedId ? 1.5 : t.id === this.hoverId ? 0.8 : 0)) > 0.01);
      const busy = lifting || this.tweens.length || this.particles.length || this.rings.length || this.flash > 0 || this.shake > 0 ||
        this.orbit !== null || this.anims.some((a) => a.fn) || Math.abs(this.parallax[0] - this.mouse[0]) + Math.abs(this.parallax[1] - this.mouse[1]) > 0.002 ||
        this.hoverId !== this.lastHover || this.selectedId !== this.lastSelected;
      this.lastHover = this.hoverId;
      this.lastSelected = this.selectedId;
      if (!busy && ++this.idleFrames % 3 !== 0) return;

      const size = this.gfx.resize();
      const aspect = size.w / Math.max(size.h, 1);
      const widen = aspect < FIT_ASPECT ? FIT_ASPECT / aspect : 1;
      const ampl = this.shake * this.shake;
      const eye = [
        this.cam.at[0] + (this.cam.eye[0] - this.cam.at[0]) * widen + this.parallax[0] * 0.9 + (Math.random() - 0.5) * ampl,
        this.cam.at[1] + (this.cam.eye[1] - this.cam.at[1]) * widen + this.parallax[1] * 0.4 + (Math.random() - 0.5) * ampl,
        this.cam.at[2] + (this.cam.eye[2] - this.cam.at[2]) * widen + (Math.random() - 0.5) * ampl,
      ];
      const view = M4.lookAt(eye, this.cam.at, [0, 1, 0]);
      const proj = M4.perspective(this.cam.fov, aspect, 1, 220);
      this.vp = M4.mul(proj, view);
      this.vpInv = M4.invert(this.vp);

      const tiles = [];
      const pulse = 0.5 + 0.5 * Math.sin(clock * 0.006);
      for (const t of this.tiles) {
        const liftTarget = t.id === this.selectedId ? 1.5 : t.id === this.hoverId ? 0.8 : 0;
        t.lift = lerp(t.lift, liftTarget, Math.min(1, dt * 16));
        let p = t.pos;
        if (t.lift > 0.002) p = [p[0], p[1] + t.lift, p[2] - t.lift * 0.35];
        t.drawPos = p;
        M4.compose(t.model, p, t.q, t.s);
        const e = t.emissive;
        e[0] = 0; e[1] = 0; e[2] = 0;
        if (t.id === this.lastDiscard) {
          e[0] = 0.13 + pulse * 0.17;
          e[1] = 0.08 + pulse * 0.1;
          e[2] = 0.01;
        } else if (this.winGlow.has(t.id)) {
          e[0] = 0.2 + pulse * 0.2;
          e[1] = 0.13 + pulse * 0.13;
          e[2] = 0.02;
        } else if (t.id === this.selectedId || t.id === this.hoverId) {
          e[0] = 0.05; e[1] = 0.06; e[2] = 0.07;
        }
        t.dim = this.interactive && this.forbidKind !== null && t.kind === this.forbidKind ? 0.62 : 1;
        tiles.push({ model: t.model, cell: t.cell, hasFace: t.cell ? 1 : 0, emissive: t.emissive, dim: t.dim });
      }

      const dice = [];
      for (const d of this.dice) {
        M4.compose(d.model, d.pos, d.q, 1);
        dice.push({ mesh: this.diceMesh, model: d.model, tex: this.diceTex });
      }

      if (this.gfx.lost) return; // 动画和牌局照常走，只是先不画
      this.gfx.render({
        vp: this.vp,
        eye,
        statics: this.statics,
        tileMesh: this.tileMesh,
        tiles,
        atlas: this.atlasTex,
        tileDim: this.tileDim,
        dice,
        particleCount: pc,
        rings: ringList,
        flash: this.flash,
      });
    }
  }

  root.MJ.Scene = Scene;
})(typeof self !== 'undefined' ? self : globalThis);
