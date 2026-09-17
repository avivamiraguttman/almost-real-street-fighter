// Pure game logic. No DOM. All lengths in H (player body height, nose to ankle) unless
// suffixed Px. Times in ms. Landmarks arrive in pixels: [{x, y, visibility}] x 33.

export const LM = {
  NOSE: 0, L_SHOULDER: 11, R_SHOULDER: 12, L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24, L_ANKLE: 27, R_ANKLE: 28,
};

export const CONFIG = {
  visMin: 0.6,
  calibMs: 2000,
  // player
  headR: 0.09, fistR: 0.06, footR: 0.07, torsoMinW: 0.25,
  punchSpeed: 1.2, punchExt: 0.35, punchRearm: 0.25,
  kickSpeed: 1.2, kickLift: 0.25, kickRearm: 0.10,
  blockDist: 0.20,
  punchDmg: 10, kickDmg: 15,
  hitCooldownMs: 400, hitstunMs: 500,
  // opponent
  startDist: 1.5, approachSpeed: 0.6, attackDist: 0.55,
  oppW: 0.30, oppH: 1.10, oppReach: 0.50, oppFist: 0.12, oppDmg: 10,
  knockback: 0.25, hopback: 0.30,
  idleMs: 400, windupMs: 500, strikeMs: 150, recoverMs: 400, hopbackMs: 300, hurtMs: 300,
  maxHp: 100,
};

export function createGame(cfg = CONFIG) {
  return {
    cfg, phase: 'calibrating', t: null, calib: { t0: null, facingVotes: 0, frames: 0 },
    noBody: true,
    player: {
      hp: cfg.maxHp, hitstunUntil: 0, cooldownUntil: 0,
      armed: { [LM.L_WRIST]: true, [LM.R_WRIST]: true }, kickArmed: true,
      H: null, facing: 1, floorY: null, geom: null, prev: null,
    },
    opp: { hp: cfg.maxHp, dist: cfg.startDist, state: 'IDLE', stateT: 0, landed: false, struck: false, hitstunUntil: 0 },
    winner: null,
  };
}

const vis = (lm, cfg) => lm && lm.visibility >= cfg.visMin;
const avg = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
const pick = (lms, i, j, cfg) => {
  const a = vis(lms[i], cfg) ? lms[i] : null, b = vis(lms[j], cfg) ? lms[j] : null;
  return a && b ? avg(a, b) : a || b;
};

// Geometry of the player in pixels, plus H. Returns null when the body is not usable.
export function playerGeometry(lms, cfg, prevH) {
  if (!lms || lms.length < 29) return null;
  const nose = lms[LM.NOSE];
  const hipMid = pick(lms, LM.L_HIP, LM.R_HIP, cfg);
  const shoulderMid = pick(lms, LM.L_SHOULDER, LM.R_SHOULDER, cfg);
  const ankles = [lms[LM.L_ANKLE], lms[LM.R_ANKLE]].filter((a) => vis(a, cfg));
  if (!vis(nose, cfg) || !hipMid || !shoulderMid || ankles.length === 0) return null;
  const floorY = Math.max(...ankles.map((a) => a.y));
  let H = floorY - nose.y;
  if (H < 40) return null;
  if (prevH) H = prevH * 0.8 + H * 0.2; // smooth
  const facingRaw = Math.sign(nose.x - hipMid.x) || 1;
  const torsoCx = (hipMid.x + shoulderMid.x) / 2;
  const torsoW = Math.max(cfg.torsoMinW * H, Math.abs(hipMid.x - shoulderMid.x));
  return {
    nose, hipMid, shoulderMid, floorY, H, facingRaw,
    head: { x: nose.x, y: nose.y, r: cfg.headR * H },
    torso: { x: torsoCx - torsoW / 2, y: shoulderMid.y, w: torsoW, h: hipMid.y - shoulderMid.y },
    wrists: [LM.L_WRIST, LM.R_WRIST].filter((i) => vis(lms[i], cfg)).map((i) => ({ id: i, x: lms[i].x, y: lms[i].y, r: cfg.fistR * H })),
    ankle: ankles.length === 2 ? (lms[LM.L_ANKLE].visibility >= lms[LM.R_ANKLE].visibility ? lms[LM.L_ANKLE] : lms[LM.R_ANKLE]) : ankles[0],
  };
}

// Opponent boxes in pixels, derived from player geometry.
export function opponentBoxes(g, opp, facing, cfg) {
  const H = g.H;
  const cx = g.hipMid.x + facing * opp.dist * H;
  const hurt = { x: cx - cfg.oppW * H / 2, y: g.floorY - cfg.oppH * H, w: cfg.oppW * H, h: cfg.oppH * H };
  const fx = cx - facing * cfg.oppReach * H;
  const fist = { x: fx - cfg.oppFist * H / 2, y: g.nose.y - cfg.oppFist * H / 2, w: cfg.oppFist * H, h: cfg.oppFist * H };
  return { cx, feetY: g.floorY, hurt, fist };
}

const circleRect = (c, r) => {
  const nx = Math.max(r.x, Math.min(c.x, r.x + r.w)), ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
  const dx = c.x - nx, dy = c.y - ny;
  return dx * dx + dy * dy <= c.r * c.r;
};
const rectRect = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

// Advance the game by one frame. Returns a list of events for rendering/sound.
export function step(state, lms, now, cfgOverride) {
  const cfg = cfgOverride || state.cfg;
  const events = [];
  const dt = state.t == null ? 16 : Math.min(100, Math.max(1, now - state.t));
  state.t = now;
  const p = state.player, o = state.opp;

  const g = playerGeometry(lms, cfg, p.H);
  state.noBody = !g;
  if (!g) { p.prev = null; return events; }
  p.H = g.H; p.floorY = g.floorY; p.geom = g;

  if (state.phase === 'calibrating') {
    if (state.calib.t0 == null) state.calib.t0 = now;
    state.calib.facingVotes += g.facingRaw; state.calib.frames++;
    p.facing = Math.sign(state.calib.facingVotes) || 1;
    if (now - state.calib.t0 >= cfg.calibMs) { state.phase = 'fighting'; events.push({ type: 'fight' }); }
    p.prev = snapshot(g);
    return events;
  }
  if (state.phase !== 'fighting') { p.prev = snapshot(g); return events; }

  const f = p.facing, H = g.H;
  const boxes = opponentBoxes(g, o, f, cfg);
  state.boxes = boxes;

  // --- block ---
  p.blocking = g.wrists.some((w) => Math.hypot(w.x - g.nose.x, w.y - g.nose.y) <= cfg.blockDist * H);

  // --- player strikes ---
  const canStrike = now >= p.cooldownUntil && now >= p.hitstunUntil && o.state !== 'KO';
  const prev = p.prev;
  p.debug = { ext: {}, vx: {} };
  for (const w of g.wrists) {
    const ext = (f * (w.x - g.shoulderMid.x)) / H;
    const pw = prev && prev.wrists[w.id];
    const vx = pw ? (f * (w.x - pw.x)) / H / (dt / 1000) : 0;
    p.debug.ext[w.id] = ext; p.debug.vx[w.id] = vx;
    if (ext < cfg.punchRearm) p.armed[w.id] = true;
    if (canStrike && p.armed[w.id] && ext > cfg.punchExt && vx > cfg.punchSpeed && circleRect(w, boxes.hurt)) {
      p.armed[w.id] = false;
      hitOpponent(state, cfg.punchDmg, now, w, events, cfg);
    }
  }
  const a = g.ankle;
  if (a) {
    const lift = (g.floorY - a.y) / H;
    const pa = prev && prev.ankle;
    const vx = pa ? (f * (a.x - pa.x)) / H / (dt / 1000) : 0;
    p.debug.lift = lift; p.debug.avx = vx;
    if (lift < cfg.kickRearm) p.kickArmed = true;
    const foot = { x: a.x, y: a.y, r: cfg.footR * H };
    if (canStrike && p.kickArmed && lift > cfg.kickLift && vx > cfg.kickSpeed && circleRect(foot, boxes.hurt) && now >= p.cooldownUntil) {
      p.kickArmed = false;
      hitOpponent(state, cfg.kickDmg, now, foot, events, cfg);
    }
  }
  p.prev = snapshot(g);

  // --- opponent state machine ---
  if (o.state !== 'KO') {
    o.stateT += dt;
    switch (o.state) {
      case 'IDLE': if (o.stateT >= cfg.idleMs) setOpp(o, o.dist > cfg.attackDist ? 'APPROACH' : 'WINDUP'); break;
      case 'APPROACH':
        o.dist = Math.max(cfg.attackDist, o.dist - cfg.approachSpeed * dt / 1000);
        if (o.dist <= cfg.attackDist) setOpp(o, 'WINDUP');
        break;
      case 'WINDUP': if (o.stateT >= cfg.windupMs) { setOpp(o, 'STRIKE'); o.struck = false; o.landed = false; } break;
      case 'STRIKE':
        if (!o.struck) {
          const hitHead = circleRect(g.head, boxes.fist), hitTorso = rectRect(g.torso, boxes.fist);
          if (hitHead || hitTorso) {
            o.struck = true;
            const cx = boxes.fist.x + boxes.fist.w / 2, cy = boxes.fist.y + boxes.fist.h / 2;
            if (p.blocking) events.push({ type: 'block', x: cx, y: cy });
            else {
              o.landed = true;
              p.hp = Math.max(0, p.hp - cfg.oppDmg); p.hitstunUntil = now + cfg.hitstunMs;
              events.push({ type: 'playerHit', dmg: cfg.oppDmg, x: cx, y: cy, dir: -f });
              if (p.hp === 0) { state.phase = 'ko'; state.winner = 'RYU'; events.push({ type: 'ko', winner: 'RYU' }); }
            }
          }
        }
        if (o.stateT >= cfg.strikeMs) setOpp(o, 'RECOVER');
        break;
      case 'RECOVER': if (o.stateT >= cfg.recoverMs) setOpp(o, o.landed ? 'HOPBACK' : 'IDLE'); break;
      case 'HOPBACK':
        o.dist += cfg.hopback * dt / cfg.hopbackMs;
        if (o.stateT >= cfg.hopbackMs) setOpp(o, 'IDLE');
        break;
      case 'HURT':
        o.dist += cfg.knockback * dt / cfg.hurtMs;
        if (o.stateT >= cfg.hurtMs) setOpp(o, 'IDLE');
        break;
    }
  }
  return events;
}

function hitOpponent(state, dmg, now, at, events, cfg) {
  const p = state.player, o = state.opp;
  o.hp = Math.max(0, o.hp - dmg);
  p.cooldownUntil = now + cfg.hitCooldownMs;
  events.push({ type: 'oppHit', dmg, x: at.x, y: at.y, dir: p.facing });
  if (o.hp === 0) { setOpp(o, 'KO'); state.phase = 'ko'; state.winner = 'YOU'; events.push({ type: 'ko', winner: 'YOU' }); }
  else setOpp(o, 'HURT');
}

function setOpp(o, s) { o.state = s; o.stateT = 0; }

function snapshot(g) {
  const wrists = {};
  for (const w of g.wrists) wrists[w.id] = { x: w.x, y: w.y };
  return { wrists, ankle: g.ankle ? { x: g.ankle.x, y: g.ankle.y } : null };
}
