// ---------------------------------------------------------------------------
// physics.js - one bowling lane: ball, pins, gutters, pin deck, kickbacks and pit.
//
// cannon-es does the collisions. The ball's contact with the lane is modelled here
// instead, because that is what makes a bowling ball hook: the contact point slides
// while the ball skids, friction acts against that slip, and the friction grows where
// the oil ends (40 ft pattern), so a ball released with side rotation goes straight in
// the oil, hooks in the dry back end and rolls out. Once the slip is gone the ball
// rolls and stops hooking. The same model runs in tests/physics_tune.mjs (node).
// A standing pin is held by the deck for a slow ball (pinHold): a slower ball deflects more
// off the pins and carries less, a faster one drives through.
//
// Units: metres, kilograms, seconds. x across the lane (0 = middle, + = right as the
// bowler sees it), y up, z down the lane (0 = foul line, the pins at -18.288).
// ---------------------------------------------------------------------------
import * as CANNON from 'cannon-es';

export const LANE = {
  width: 1.0541,                // 41.5 in
  gutter: 0.235,                // 9.25 in
  gutterDepth: 0.048,
  headPin: 18.288,              // 60 ft from the foul line
  pitEdge: 18.288 + 0.868,      // the end of the pin deck
  oilLength: 12.19,             // a 40 ft house pattern
  boards: 39,
  board: 1.0541 / 39,
  pinSpacing: 0.3048,
  ballRadius: 0.1085,
  ballMass: 6.8,                // a 15 lb ball
  pinMass: 1.55,
  pinHeight: 0.381,
  laneSpacing: 1.0541 + 2 * 0.235 + 0.16   // lane centre to lane centre
};

// The bumpers (hall bumper rails): the rail's face 12 mm outside the lane edge, so a ball's centre
// stays 0.43 m from the middle at most and never drops into the gutter; 14 cm high, from 25 cm
// past the foul line to 20 cm before the end of the pin deck (a ball dropping into the pit is clear
// of the rail's end). A padded rail gives the ball back about half its speed across the lane.
// Down, the rail lies in the gutter, below the reach of the ball.
export const BUMPER = {
  face: 1.0541 / 2 + 0.012, halfWidth: 0.05, height: 0.14, downY: -0.6,
  z0: -0.25, z1: -(18.288 + 0.868 - 0.2), restitution: 0.45, friction: 0.12
};

// Pin spots, bit (n-1) for pin n: x, z (head pin first)
export const PIN_SPOTS = (() => {
  const s = LANE.pinSpacing, row = s * Math.sin(Math.PI / 3);
  const z0 = -LANE.headPin;
  return [
    [0, z0],
    [-s / 2, z0 - row], [s / 2, z0 - row],
    [-s, z0 - 2 * row], [0, z0 - 2 * row], [s, z0 - 2 * row],
    [-1.5 * s, z0 - 3 * row], [-s / 2, z0 - 3 * row], [s / 2, z0 - 3 * row], [1.5 * s, z0 - 3 * row]
  ];
})();

// The pin's outline (USBC specification), height y and radius r in metres. Used for the
// collision shape here and for the lathe geometry in scene.js.
export const PIN_PROFILE = [
  [0.0, 0.0258], [0.019, 0.0359], [0.057, 0.0496], [0.086, 0.0573], [0.114, 0.0605], [0.149, 0.0580],
  [0.184, 0.0476], [0.219, 0.0346], [0.238, 0.0284], [0.254, 0.0239], [0.276, 0.0229], [0.298, 0.0257],
  [0.320, 0.0290], [0.343, 0.0315], [0.360, 0.0290], [0.372, 0.0220], [0.379, 0.0120], [0.381, 0.0]
];
const PIN_COM = 0.150;          // centre of mass above the base
const PIN_SAMPLES = [0.02, 0.06, 0.10, 0.12, 0.15, 0.19, 0.24, 0.30, 0.345];
// Contact constants (tests/physics_tune.mjs varies them)
export const TUNE = {
  pinPinFriction: 0.15, pinPinRestitution: 0.85, pinLaneFriction: 0.18, pinLaneRestitution: 0.2,
  wallRestitution: 0.6, pinLinearDamping: 0.05, pinAngularDamping: 0.12, ballPinRestitution: 0.75,
  // the deck's hold on a standing pin (ballPinContacts): a ball meeting it slower than
  // pinHoldSpeed (m/s) meets a pin that is effectively 1 + pinHold * (pinHoldSpeed / speed - 1) times heavier
  pinHold: 2.0, pinHoldSpeed: 6.0
};
// [y0, y1, r0, r1] - the collision pieces, from the profile above
const PIN_PIECES = [
  [0.000, 0.057, 0.0258, 0.0496],
  [0.057, 0.098, 0.0496, 0.0600],
  [0.098, 0.136, 0.0605, 0.0605],
  [0.136, 0.184, 0.0595, 0.0476],
  [0.184, 0.254, 0.0476, 0.0239],
  [0.254, 0.330, 0.0239, 0.0300]
];

// The pin's radius at height h above its base (from the outline)
export function pinRadiusAt(h) {
  if (h <= 0) return PIN_PROFILE[0][1];
  for (let i = 1; i < PIN_PROFILE.length; i++) {
    const [y1, r1] = PIN_PROFILE[i];
    if (h <= y1) {
      const [y0, r0] = PIN_PROFILE[i - 1];
      return r0 + (r1 - r0) * (h - y0) / (y1 - y0);
    }
  }
  return 0;
}

function oilFriction(d) {       // d = metres from the foul line
  if (d < LANE.oilLength) return 0.02;
  if (d < LANE.oilLength + 1.5) return 0.02 + (d - LANE.oilLength) / 1.5 * 0.15;
  return 0.17;
}

export class LanePhysics {
  // laneX: the lane's centre in world x (for the second lane of an American pair)
  constructor({ laneX = 0 } = {}) {
    this.laneX = laneX;
    const world = this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
    world.broadphase = new CANNON.SAPBroadphase(world);
    world.solver.iterations = 24;
    world.allowSleep = true;
    this.dt = 1 / 360;

    const M = this.mat = {
      lane: new CANNON.Material('lane'), ball: new CANNON.Material('ball'),
      pin: new CANNON.Material('pin'), wall: new CANNON.Material('wall')
    };
    const cm = (a, b, friction, restitution) => world.addContactMaterial(new CANNON.ContactMaterial(a, b, { friction, restitution, contactEquationStiffness: 5e7, contactEquationRelaxation: 3 }));
    cm(M.ball, M.lane, 0.0, 0.0);      // the ball's lane contact is ours (applyLaneFriction)
    cm(M.ball, M.pin, 0.05, 0.85);
    cm(M.pin, M.pin, TUNE.pinPinFriction, TUNE.pinPinRestitution);
    cm(M.pin, M.lane, TUNE.pinLaneFriction, TUNE.pinLaneRestitution);
    cm(M.pin, M.wall, 0.20, TUNE.wallRestitution);
    cm(M.ball, M.wall, 0.10, 0.30);

    const box = (hx, hy, hz, x, y, z, mat) => {
      const b = new CANNON.Body({ mass: 0, material: mat });
      b.addShape(new CANNON.Box(new CANNON.Vec3(hx, hy, hz)));
      b.position.set(laneX + x, y, z);
      world.addBody(b);
      return b;
    };
    const W = LANE.width, G = LANE.gutter;
    const deckEnd = -LANE.pitEdge;
    // the lane and pin deck, top at y = 0, from behind the foul line to the pit
    box(W / 2, 0.05, (LANE.pitEdge + 2) / 2, 0, -0.05, -(LANE.pitEdge - 2) / 2, M.lane);
    // the gutters, lower, all the way to the pit
    for (const side of [-1, 1]) {
      box(G / 2, 0.05, (LANE.pitEdge + 2) / 2, side * (W / 2 + G / 2), -0.05 - LANE.gutterDepth, -(LANE.pitEdge - 2) / 2, M.lane);
      // the outer edge of the gutter (low), and the kickback plates beside the pin deck
      box(0.02, 0.06, (LANE.pitEdge + 2) / 2, side * (W / 2 + G + 0.02), 0.0, -(LANE.pitEdge - 2) / 2, M.wall);
      box(0.02, 0.35, 1.3, side * (W / 2 + G + 0.02), 0.35, -LANE.headPin - 0.55, M.wall);
    }
    // the pit: a floor well below the deck, the cushion at the back
    box(W / 2 + G + 0.1, 0.05, 0.6, 0, -0.35, deckEnd - 0.6, M.wall);
    box(W / 2 + G + 0.1, 0.5, 0.05, 0, 0.2, deckEnd - 0.95, M.wall);
    // the bumpers: a padded rail over each gutter, its face just outside the lane edge, from a
    // little past the foul line to the end of the pin deck. Down (in the gutter, out of reach)
    // until setBumpers(true) raises them; a ball meeting one comes back onto the lane.
    M.bumper = new CANNON.Material('bumper');
    cm(M.ball, M.bumper, BUMPER.friction, BUMPER.restitution);
    cm(M.pin, M.bumper, 0.2, 0.4);
    this.bumperBodies = [-1, 1].map((side) => {
      const b = box(BUMPER.halfWidth, BUMPER.height / 2, (BUMPER.z0 - BUMPER.z1) / 2,
        side * (BUMPER.face + BUMPER.halfWidth), BUMPER.downY, (BUMPER.z0 + BUMPER.z1) / 2, M.bumper);
      b.addEventListener('collide', (e) => {
        if (e.body !== this.ball || !this.bumpersUp) return;
        const speed = Math.hypot(this.ball.velocity.x, this.ball.velocity.z);
        if (this.time - (this.lastBumperHit || -1) < 0.25) return;
        this.lastBumperHit = this.time;
        this.events.push({ type: 'bumper', t: this.time, speed, side });
        if (this.onBumper) this.onBumper(speed, side);
      });
      return b;
    });
    this.bumpersUp = false;

    // the ball
    this.ball = new CANNON.Body({ mass: LANE.ballMass, material: M.ball, shape: new CANNON.Sphere(LANE.ballRadius) });
    this.ball.allowSleep = false;
    this.ball.linearDamping = 0; this.ball.angularDamping = 0;
    this.ball.position.set(laneX, LANE.ballRadius, 1.5);
    this.ballGroup = 2; this.pinGroup = 4; this.ghostGroup = 8;
    this.ball.collisionFilterGroup = this.ballGroup;
    world.addBody(this.ball);

    // ten pins
    this.pins = [];
    for (let i = 0; i < 10; i++) {
      const b = new CANNON.Body({ mass: LANE.pinMass, material: M.pin });
      // Convex pieces of the outline. The belly (widest at 4.5 in) is a straight cylinder,
      // because that is where a ball meets a pin: a sloped piece there gives the contact an
      // upward normal and throws the ball into the air.
      for (const [y0, y1, r0, r1] of PIN_PIECES)
        b.addShape(new CANNON.Cylinder(r1, r0, y1 - y0, 12), new CANNON.Vec3(0, (y0 + y1) / 2 - PIN_COM, 0));
      b.addShape(new CANNON.Sphere(0.0315), new CANNON.Vec3(0, 0.343 - PIN_COM, 0));
      b.sleepSpeedLimit = 0.05;
      b.sleepTimeLimit = 0.4;
      b.linearDamping = TUNE.pinLinearDamping;
      b.angularDamping = TUNE.pinAngularDamping;
      b.collisionFilterGroup = this.pinGroup;
      b.collisionFilterMask = 1;          // lane, gutters, walls; pin against pin is pinPinContacts()
      world.addBody(b);
      this.pins.push({ body: b, n: i + 1, active: true, ghost: false });
    }
    this.resetPins(0x3FF);
    this.state = 'idle';
    this.time = 0;
    this.events = [];
  }

  // The bumpers up (true) or down; the rails are solid at once, the 3D model rises on its own time
  setBumpers(up) {
    up = !!up;
    if (up === this.bumpersUp) return;
    this.bumpersUp = up;
    for (const b of this.bumperBodies) {
      b.position.y = up ? BUMPER.height / 2 : BUMPER.downY;
      b.aabbNeedsUpdate = true;
    }
  }

  // Put the standing pins on their spots, the others away
  resetPins(standing) {
    this.pins.forEach((p, i) => {
      const b = p.body;
      p.active = (standing & (1 << i)) !== 0;
      p.ghost = false;
      b.collisionFilterGroup = this.pinGroup;
      b.collisionFilterMask = 1;
      b.type = CANNON.Body.DYNAMIC;
      b.mass = LANE.pinMass; b.updateMassProperties();
      b.velocity.setZero(); b.angularVelocity.setZero();
      b.quaternion.set(0, 0, 0, 1);
      b.updateInertiaWorld(true);
      if (p.active) {
        b.position.set(this.laneX + PIN_SPOTS[i][0], PIN_COM + 0.0005, PIN_SPOTS[i][1]);
        b.collisionResponse = true;
        b.wakeUp();
        b.sleep();                       // still until something hits it
      } else {
        b.position.set(this.laneX + 3 + i * 0.2, -5, PIN_SPOTS[i][1]);
        b.type = CANNON.Body.STATIC;
        b.collisionResponse = false;
      }
    });
    this.standingBefore = standing;
  }

  // Release the ball. x0: lateral release point (m from the lane's middle), speed (m/s),
  // angle (rad, + toward the right), side (rad/s side rotation; + hooks to the left as a
  // right-hander's ball does), roll (0..1, how much of a full forward roll the ball has).
  // forced: { leave: mask } - a machine player's ball: these pins stand whatever happens,
  // the others fall (late if the ball's pin action left them up).
  // z0: where the bowler stands, metres behind the foul line. The stance is only where the
  // bowler starts: the ball is carried straight up the approach on that board (state
  // 'approach', drawn rolling at the release speed, without touching the lane's physics) and
  // released at the foul line, as a bowler walks up to the line. So the lane, the line, the
  // hook, the speed and the aim line are the same wherever the bowler stands.
  release(params) {
    const z0 = params.z0 || 0;
    if (z0 > 0.1 && !params.forced) {
      const b = this.ball, R = LANE.ballRadius;
      this.carried = { ...params };
      b.type = CANNON.Body.KINEMATIC;
      b.collisionFilterMask = 0;
      b.position.set(this.laneX + params.x0, R, z0);
      b.velocity.set(0, 0, -params.speed);
      b.angularVelocity.set(-params.speed / R, 0, 0);        // rolling straight up the approach
      b.wakeUp();
      this.inGutter = false;
      this.forced = null;
      this.state = 'approach';
      this.time = 0;
      this.impactTime = null;
      this.entry = null;
      this.path = [];
      this.events = [];
      return;
    }
    this.launch(params);
  }

  // The release at the foul line
  launch({ x0, speed, angle, side, roll = 0.5, forced = null }) {
    const b = this.ball;
    b.type = CANNON.Body.DYNAMIC;
    this.carried = null;
    b.position.set(this.laneX + x0, LANE.ballRadius + 0.002, -0.05);
    b.velocity.set(Math.sin(angle) * speed, 0, -Math.cos(angle) * speed);
    // forward roll about the axis across the direction of travel, plus side rotation
    const omegaRoll = roll * speed / LANE.ballRadius;
    const dir = new CANNON.Vec3(Math.sin(angle), 0, -Math.cos(angle));
    const across = new CANNON.Vec3(dir.z, 0, -dir.x);       // horizontal, perpendicular to travel
    b.angularVelocity.set(across.x * omegaRoll, 0, across.z * omegaRoll);
    // side rotation about the travel direction: a positive value pushes the contact point
    // right (slip +x when travelling -z), so friction drives the ball left
    b.angularVelocity.x += -dir.x * side;
    b.angularVelocity.z += -dir.z * side;
    b.angularVelocity.y = side * 0.3;
    b.collisionFilterGroup = this.ballGroup;
    b.collisionFilterMask = 1;            // the lane and walls; pins are ballPinContacts()
    b.wakeUp();
    this.inGutter = false;
    this.forced = forced;
    this.nudged = false;                  // every machine player's ball gets its late-falling pins
    this.state = 'rolling';
    this.time = 0;
    this.lastBumperHit = -1;              // the clock starts again: the last ball's bumper hit must not mute this one's
    this.stillFor = 0;                    // how long the ball has not been moving forward (watch)
    this.impactTime = null;
    this.entry = null;
    this.releaseZ = b.position.z;
    this.path = [];
    this.maxSpeed = speed;
    this.events = [];
    if (forced) {
      // the leave pins are not touched by the ball and do not fall: other pins bounce off them
      this.pins.forEach((p, i) => {
        if (!p.active) return;
        if (forced.leave & (1 << i)) {
          p.ghost = true;
          p.body.type = CANNON.Body.STATIC;
          p.body.collisionFilterGroup = this.ghostGroup;
        }
      });
    }
  }

  // The ball's contact with the lane: friction against the slip of the contact point
  applyLaneFriction(dt) {
    const b = this.ball, R = LANE.ballRadius;
    const x = b.position.x - this.laneX, z = b.position.z;
    const onLane = Math.abs(x) <= LANE.width / 2 && z > -LANE.pitEdge && b.position.y < R + 0.01;
    // (at the lane's level: a ball that has gone over the pit's edge and fallen is not a gutter ball)
    if (!this.inGutter && b.position.y < R + 0.01 && b.position.y > -0.1 && Math.abs(x) > LANE.width / 2 - 0.004 && z > -LANE.pitEdge + 0.3) {
      this.inGutter = true;
      this.events.push({ type: 'gutter', t: this.time });
      // a gutter ball cannot reach the pins: it runs below the deck
      b.collisionFilterMask = 1;
    }
    if (this.inGutter) {
      // roll down the middle of the gutter
      const side = Math.sign(x) || 1;
      const target = side * (LANE.width / 2 + LANE.gutter / 2);
      b.velocity.x += (target - x) * 8 * dt - b.velocity.x * 4 * dt;
      return;
    }
    if (!onLane) return;
    const d = -z;
    const mu = d > LANE.headPin - 0.3 ? 0.2 : oilFriction(d);
    const w = b.angularVelocity, v = b.velocity;
    // slip = v + w x r, r = (0, -R, 0): w x r = (w.z * R, 0, -w.x * R)
    const sx = v.x + w.z * R, sz = v.z - w.x * R;
    const slip = Math.hypot(sx, sz);
    if (slip < 1e-6) return;
    const maxJ = mu * LANE.ballMass * 9.81 * dt;            // what friction can give in this step
    const stopJ = LANE.ballMass * slip / 3.5;               // what removes the slip entirely (solid sphere)
    const J = Math.min(maxJ, stopJ);
    const jx = -sx / slip * J, jz = -sz / slip * J;
    v.x += jx / LANE.ballMass; v.z += jz / LANE.ballMass;
    // angular impulse r x J, r = (0,-R,0): (-R*jz, 0, R*jx); I = 2/5 m R^2
    const I = 0.4 * LANE.ballMass * R * R;
    w.x += (-R * jz) / I;
    w.z += (R * jx) / I;
    // rolling resistance
    const sp = Math.hypot(v.x, v.z);
    if (sp > 0.01) { const k = Math.max(0, 1 - 0.012 * 9.81 * dt / sp); v.x *= k; v.z *= k; }
  }

  // Ball against pins, done here rather than by the contact solver. A 6.8 kg ball meets a
  // 1.55 kg pin in about a millisecond; the iterative solver spreads that over several
  // steps, lets the pin's base drag on the deck meanwhile and so takes far too much speed
  // off the ball and throws it into the air. Here each touch is one impulse along the
  // normal from the pin's axis to the ball's centre, with the pin's real rotational
  // inertia and a coefficient of restitution of 0.75, as a ball-pin impact measures.
  ballPinContacts() {
    const b = this.ball, R = LANE.ballRadius;
    if (this.inGutter) return;
    const C = b.position;
    for (const p of this.pins) {
      if (!p.active || p.ghost) continue;
      const pb = p.body;
      const q = pb.quaternion;
      // the pin's axis, base to top
      const ax = new CANNON.Vec3(), base = new CANNON.Vec3();
      q.vmult(new CANNON.Vec3(0, 1, 0), ax);
      q.vmult(new CANNON.Vec3(0, -PIN_COM, 0), base);
      base.vadd(pb.position, base);
      const rel = C.vsub(base);
      let t = rel.dot(ax);
      if (t < -R || t > LANE.pinHeight + R) continue;
      t = Math.max(0, Math.min(LANE.pinHeight, t));
      const onAxis = base.vadd(ax.scale(t));
      const nvec = C.vsub(onAxis);
      const dist = nvec.length();
      const rPin = pinRadiusAt(t);
      if (dist >= R + rPin || dist < 1e-6) continue;
      nvec.scale(1 / dist, nvec);
      const contact = onAxis.vadd(nvec.scale(rPin));
      const rp = contact.vsub(pb.position);
      // relative velocity of the ball against the pin at the contact point
      const vPin = pb.velocity.vadd(pb.angularVelocity.cross(rp));
      const vn = b.velocity.vsub(vPin).dot(nvec);
      const overlap = R + rPin - dist;
      if (vn < 0) {
        const rxn = rp.cross(nvec);
        const tmp = new CANNON.Vec3();
        pb.invInertiaWorld.vmult(rxn, tmp);
        const angTerm = tmp.cross(rp).dot(nvec);
        const e = TUNE.ballPinRestitution;
        const hold = this.pinHold(p, b.velocity.vsub(vPin).length());
        const j = -(1 + e) * vn / (1 / LANE.ballMass + (1 / LANE.pinMass + angTerm) / hold);
        const J = nvec.scale(j);
        // the ball stays on the deck: only the horizontal part of its impulse
        b.velocity.x += J.x / LANE.ballMass;
        b.velocity.z += J.z / LANE.ballMass;
        pb.wakeUp();
        // the pin leaves as a free pin would: the deck under it holds it back by the rest
        const Jp = hold > 1 ? nvec.scale(-(1 + e) * vn / (1 / LANE.ballMass + 1 / LANE.pinMass + angTerm)) : J;
        pb.velocity.vsub(Jp.scale(1 / LANE.pinMass), pb.velocity);
        const dw = new CANNON.Vec3();
        pb.invInertiaWorld.vmult(rp.cross(Jp.scale(-1)), dw);
        pb.angularVelocity.vadd(dw, pb.angularVelocity);
        if (!p.hitByBall) { p.hitByBall = true; this.events.push({ type: 'hit', pin: p.n, t: this.time, speed: -vn }); }
      }
      // push the pin out of the ball (the ball is heavier and stays on the deck)
      pb.position.vsub(nvec.scale(overlap * 0.8), pb.position);
    }
  }

  // The deck's hold on a pin the ball meets at `speed` (m/s, the ball's speed against the pin),
  // as a factor on the pin's mass (and rotational inertia) in the ball's impulse. A standing pin
  // is pressed onto the deck by its weight and held by the friction under its base; during the
  // contact the deck pushes back on the ball through the pin. A ball that comes in hard throws
  // the pin off its base at once and meets it as a free body (factor 1 from pinHoldSpeed up); a
  // slow one is resisted for the whole contact and pushed aside more: a slower ball deflects more
  // off the pins and so carries less, a faster one drives through. The pin itself leaves as a free
  // pin would (the deck holds it back by the difference), and a pin that is already moving or
  // tipping is a free body. A phenomenological model of the deck, sized so that a 5 m/s ball
  // (about 4 m/s at the pins) meets a standing pin about twice as heavy and a 7-8 m/s ball a free
  // one. Energy is only lost, never made: the ball loses more, the pin gets what a free pin gets.
  pinHold(p, speed) {
    const b = p.body;
    if (!this.isStanding(p) || b.velocity.length() > 0.4) return 1;
    return 1 + TUNE.pinHold * Math.max(0, TUNE.pinHoldSpeed / Math.max(speed, 1.0) - 1);
  }

  // Pin against pin, by the same impulse method: each pin is its axis with the radius of
  // the outline at every height; the nearest points of two axes give the normal. A leave
  // pin of a machine player's ball (ghost) stands like a wall.
  pinPinContacts() {
    const pins = this.pins;
    const axes = pins.map((p) => {
      if (!p.active) return null;
      const b = p.body, ax = new CANNON.Vec3(), base = new CANNON.Vec3();
      b.quaternion.vmult(new CANNON.Vec3(0, 1, 0), ax);
      b.quaternion.vmult(new CANNON.Vec3(0, -PIN_COM, 0), base);
      base.vadd(b.position, base);
      return { base, ax };
    });
    const H = LANE.pinHeight;
    for (let i = 0; i < 10; i++) {
      const A = axes[i];
      if (!A) continue;
      for (let k = i + 1; k < 10; k++) {
        const B = axes[k];
        if (!B) continue;
        const pa = pins[i], pb = pins[k];
        if ((pa.ghost || pa.body.sleepState === 2) && (pb.ghost || pb.body.sleepState === 2)) continue;
        const ca = pa.body.position, cb = pb.body.position;
        if (Math.abs(ca.x - cb.x) > 0.5 || Math.abs(ca.z - cb.z) > 0.5) continue;
        // The deepest touch: heights along one pin, each against the nearest point of the
        // other's axis, both ways round (two upright pins are parallel, so the plain
        // nearest-points-of-two-segments answer would be their bases, the thinnest part)
        let best = null;
        for (const [P, Q, sw] of [[A, B, false], [B, A, true]]) {
          for (const s of PIN_SAMPLES) {
            const pt = P.base.vadd(P.ax.scale(s));
            let t = pt.vsub(Q.base).dot(Q.ax);
            t = Math.max(0, Math.min(H, t));
            const qt = Q.base.vadd(Q.ax.scale(t));
            const d = pt.vsub(qt).length();
            const pen = pinRadiusAt(s) + pinRadiusAt(t) - d;
            if (pen > 0 && (!best || pen > best.pen)) {
              best = sw ? { pen, PA: qt, PB: pt, sa: t, sb: s, d } : { pen, PA: pt, PB: qt, sa: s, sb: t, d };
            }
          }
        }
        if (!best || best.d < 1e-7) continue;
        const PA = best.PA, PB = best.PB, dist = best.d;
        const nvec = PA.vsub(PB);
        const ra = pinRadiusAt(best.sa), rb = pinRadiusAt(best.sb);
        nvec.scale(1 / dist, nvec);
        const contact = PB.vadd(nvec.scale(rb + (dist - ra - rb) / 2));
        const bodyA = pa.body, bodyB = pb.body;
        const invMA = pa.ghost ? 0 : 1 / LANE.pinMass, invMB = pb.ghost ? 0 : 1 / LANE.pinMass;
        const rA = contact.vsub(bodyA.position), rB = contact.vsub(bodyB.position);
        const vA = bodyA.velocity.vadd(bodyA.angularVelocity.cross(rA));
        const vB = bodyB.velocity.vadd(bodyB.angularVelocity.cross(rB));
        const vrel = vA.vsub(vB);
        const vn = vrel.dot(nvec);
        const overlap = ra + rb - dist;
        if (vn < 0) {
          const tmpA = new CANNON.Vec3(), tmpB = new CANNON.Vec3();
          if (invMA) bodyA.invInertiaWorld.vmult(rA.cross(nvec), tmpA);
          if (invMB) bodyB.invInertiaWorld.vmult(rB.cross(nvec), tmpB);
          const ang = tmpA.cross(rA).dot(nvec) + tmpB.cross(rB).dot(nvec);
          const j = -(1 + TUNE.pinPinRestitution) * vn / (invMA + invMB + ang);
          // friction along the sliding direction, at most mu * j
          const vt = vrel.vsub(nvec.scale(vn));
          const vtLen = vt.length();
          const J = nvec.scale(j);
          if (vtLen > 1e-4) J.vadd(vt.scale(-Math.min(TUNE.pinPinFriction * j, vtLen / (invMA + invMB + 1e-9)) / vtLen), J);
          this.applyPinImpulse(pa, J, rA, invMA);
          this.applyPinImpulse(pb, J.scale(-1), rB, invMB);
        }
        const share = invMA + invMB;
        if (share > 0) {
          if (invMA) bodyA.position.vadd(nvec.scale(overlap * 0.8 * invMA / share), bodyA.position);
          if (invMB) bodyB.position.vsub(nvec.scale(overlap * 0.8 * invMB / share), bodyB.position);
        }
      }
    }
  }

  applyPinImpulse(p, J, r, invM) {
    if (!invM) return;
    const b = p.body;
    b.wakeUp();
    b.velocity.vadd(J.scale(invM), b.velocity);
    const dw = new CANNON.Vec3();
    b.invInertiaWorld.vmult(r.cross(J), dw);
    b.angularVelocity.vadd(dw, b.angularVelocity);
  }

  // Advance the simulation by dt (seconds). Returns the state.
  // budgetMs: stop after this much time and drop the rest of dt. The simulation then runs slower than
  // real time for that frame instead of holding the frame up - the pin crash on a phone's CPU (the low
  // detail level, main.js). The sub-steps themselves are unchanged: the physics is the same, the crash
  // only takes longer.
  step(dt, budgetMs = 0) {
    let left = dt;
    const t0 = budgetMs > 0 ? performance.now() : 0;
    while (left > 1e-9) {
      const h = Math.min(this.dt, left);
      const carried = this.state === 'approach';
      if (!carried && this.state !== "idle" && this.state !== "done") { this.applyLaneFriction(h); this.ballPinContacts(); this.pinPinContacts(); }
      this.world.step(h);
      left -= h;
      if (carried) {
        // up the approach to the foul line, then the release
        if (this.ball.position.z <= -0.05) this.launch(this.carried);
        continue;
      }
      this.time += h;
      this.watch(h);
      if (budgetMs > 0 && performance.now() - t0 > budgetMs) break;
    }
    return this.state;
  }

  // h: the sub-step just taken (s)
  watch(h = this.dt) {
    const b = this.ball;
    if (this.state === 'rolling') {
      if (this.path.length === 0 || this.time - this.path[this.path.length - 1].t > 0.03)
        this.path.push({ t: this.time, x: b.position.x - this.laneX, z: b.position.z });
      if (b.position.z < -LANE.headPin + 0.25) {
        this.state = 'deck';
        this.impactTime = this.time;
        this.entry = { x: b.position.x - this.laneX, z: b.position.z, vx: b.velocity.x, vz: b.velocity.z, speed: Math.hypot(b.velocity.x, b.velocity.z) };
        this.events.push({ type: 'pins', t: this.time });
      }
      // A slow ball - one going from rail to rail with the bumpers up can take well over 9 s - rolls
      // on until it reaches the pins. It ends short of them only once it has stopped moving forward
      // (stood still, or rocks across the lane) for half a second, or at a generous safety cap.
      this.stillFor = -b.velocity.z < 0.05 ? (this.stillFor || 0) + h : 0;
      if (this.state === 'rolling' && (this.stillFor > 0.5 || this.time > 45)) { this.state = 'deck'; this.impactTime = this.time; }
    } else if (this.state === 'deck') {
      const since = this.time - this.impactTime;
      if (this.forced && since > 1.2 && !this.nudged) this.nudgeForced();
      // done once every pin rests, or after the time a pinsetter waits
      const moving = this.pins.some((p) => p.active && !p.ghost && p.body.sleepState !== CANNON.Body.SLEEPING &&
        (p.body.velocity.length() > 0.06 || p.body.angularVelocity.length() > 0.25) && p.body.position.y > -1);
      if ((since > 2.2 && !moving) || since > 5.0) {
        this.state = 'done';
        this.events.push({ type: 'done', t: this.time });
      }
    }
  }

  // A machine player's ball: the pins it should have taken but left up fall now, away from the ball
  nudgeForced() {
    this.nudged = true;
    const leave = this.forced.leave;
    this.pins.forEach((p, i) => {
      if (!p.active || (leave & (1 << i))) return;
      if (!this.isStanding(p)) return;
      const b = p.body;
      b.wakeUp();
      const dx = (b.position.x - this.laneX) - (this.entry ? this.entry.x * 0.3 : 0);
      const dirx = Math.sign(dx || (i % 2 ? 1 : -1)) * (0.4 + Math.random() * 0.6);
      b.applyImpulse(new CANNON.Vec3(dirx * 1.6, 0.3, -1.4 - Math.random()), new CANNON.Vec3(b.position.x, b.position.y + 0.17, b.position.z));
    });
  }

  isStanding(p) {
    if (!p.active) return false;
    const b = p.body;
    // the pin's own up axis against the world's
    const q = b.quaternion;
    const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
    const x = b.position.x - this.laneX;
    return upY > 0.87 && b.position.y > PIN_COM - 0.03 && b.position.y < PIN_COM + 0.05 &&
      Math.abs(x) < LANE.width / 2 + 0.02 && b.position.z > -LANE.pitEdge;
  }

  // The ball's average speed (m/s) from the release at the foul line to the pins, as a
  // lane's ball-speed sensors measure it; null if the ball never reached them
  laneSpeed() {
    if (this.impactTime == null || !this.entry || !(this.impactTime > 0)) return null;
    return (this.releaseZ - this.entry.z) / this.impactTime;
  }

  // The pins standing after the ball (bit n-1 = pin n)
  standingMask() {
    let m = 0;
    this.pins.forEach((p, i) => { if (p.ghost || this.isStanding(p)) m |= 1 << i; });
    if (this.forced) m = this.forced.leave & this.standingBefore;
    return m;
  }

  // Simulate the ball alone from a release and return where it meets the pin deck (for
  // aiming a machine player's ball and for the aiming aid). Uses the same model.
  static predict(params, maxTime = 6) {
    const sim = LanePhysics._predictor || (LanePhysics._predictor = new LanePhysics({ laneX: 0 }));
    sim.setBumpers(!!params.bumpers);
    sim.resetPins(0);
    sim.release({ ...params, forced: null });
    const path = [];
    let t = 0;
    while (t < maxTime && sim.state === 'rolling') {
      sim.step(1 / 60);
      t += 1 / 60;
      path.push({ x: sim.ball.position.x, z: sim.ball.position.z, y: sim.ball.position.y });
    }
    sim.state = 'idle';
    return { entry: sim.entry || null, gutter: sim.inGutter, path };
  }

  // Find a release that brings the ball to `targetX` at the head pin, for a bowler with
  // this speed and side rotation, starting from x0. Returns the release parameters.
  static aim({ targetX, x0, speed, side, roll = 0.5 }) {
    let lo = -0.12, hi = 0.12, best = null;
    for (let it = 0; it < 18; it++) {
      const mid = (lo + hi) / 2;
      const r = LanePhysics.predict({ x0, speed, angle: mid, side, roll });
      const x = r.entry ? r.entry.x : (r.path.length ? r.path[r.path.length - 1].x : 0);
      best = { x0, speed, angle: mid, side, roll, entry: r.entry, gutter: r.gutter };
      if (Math.abs(x - targetX) < 0.003 && !r.gutter) break;
      if (x < targetX) lo = mid; else hi = mid;
    }
    return best;
  }
}
