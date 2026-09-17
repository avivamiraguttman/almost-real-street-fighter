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
  punchSpeed: 1.2, punchExt: 0.25, punchRearm: 0.15, wristVisMin: 0.5,
  kickSpeed: 1.2, kickLift: 0.25, kickRearm: 0.10,
  blockDist: 0.25, blockFront: 0.02, blockHoldMs: 100,
  punchDmg: 10, kickDmg: 15,
  hitCooldownMs: 400, hitstunMs: 500,
  // opponent
  startDist: 1.5, approachSpeed: 0.6, attackDist: 0.55,
  oppW: 0.30, oppH: 1.10, oppReach: 0.50, oppFist: 0.12, oppDmg: 15, armorInWindup: true, comboHits: 2,
  knockback: 0.60, hopback: 0.30,
  zoneFwd: 0.7, zoneDmgMul: 0.5, edgeMargin: 0.2, hipJumpMax: 0.5, hipJumpHoldMs: 700, // player may advance 0.35 H past the calibrated spot; Ryu stays 0.2 H inside the screen edge
  idleMs: 150, windupMs: 350, strikeMs: 150, recoverMs: 250, hopbackMs: 300, hurtMs: 350, noBodyResetMs: 1000,
  velWindowMs: 50, maxSpeed: 12, // velocity over ~3 frames; anything faster is a landmark teleport
  // calibration
  calibHoldMs: 1500, sizeMin: 0.30, sizeMax: 0.80, roomForOpp: 1.3, lumaMin: 50, lumaMax: 210, jitterMax: 0.03, fpsMin: 15,
  maxHp: 150,
  thumbHoldMs: 500, thumbUp: 0.03, fistTight: 0.22, handUpAbove: 0.10,
};

export function createGame(cfg = CONFIG) {
  return {
    cfg, phase: 'calibrate', t: null, lock: null,
    calib: { okSince: null, noseHist: [], hHist: [], floorHist: [], checks: [] },
    noBody: true,
    player: {
      hp: cfg.maxHp, hitstunUntil: 0, cooldownUntil: 0,
      armed: { [LM.L_WRIST]: true, [LM.R_WRIST]: true }, swung: {}, kickArmed: true, kickSwung: false,
      H: null, facing: 1, floorY: null, geom: null, prev: null, lastHip: null,
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
export function playerGeometry(lms, cfg, lock) {
  if (!lms || lms.length < 29) return null;
  const nose = lms[LM.NOSE];
  const hipMid = pick(lms, LM.L_HIP, LM.R_HIP, cfg);
  const shoulderMid = pick(lms, LM.L_SHOULDER, LM.R_SHOULDER, cfg);
  const ankles = [lms[LM.L_ANKLE], lms[LM.R_ANKLE]].filter((a) => vis(a, cfg));
  if (!vis(nose, cfg) || !hipMid || !shoulderMid || ankles.length === 0) return null;
  const floorMeasured = Math.max(...ankles.map((a) => a.y));
  const Hmeasured = floorMeasured - nose.y;
  if (Hmeasured < 40) return null;
  let H = Hmeasured, floorY = floorMeasured;
  if (lock) { // frozen scale: Ryu must not resize with tracking jitter
    lock.floorY = lock.floorY * 0.98 + floorMeasured * 0.02;
    H = lock.H; floorY = lock.floorY;
  }
  const facingRaw = Math.sign(nose.x - hipMid.x) || 1;
  const torsoCx = (hipMid.x + shoulderMid.x) / 2;
  const torsoW = Math.max(cfg.torsoMinW * H, Math.abs(hipMid.x - shoulderMid.x));
  return {
    nose, hipMid, shoulderMid, floorY, H, Hmeasured, floorMeasured, facingRaw,
    head: { x: nose.x, y: nose.y, r: cfg.headR * H },
    torso: { x: torsoCx - torsoW / 2, y: shoulderMid.y, w: torsoW, h: hipMid.y - shoulderMid.y },
    wrists: [LM.L_WRIST, LM.R_WRIST].filter((i) => lms[i] && lms[i].visibility >= (cfg.wristVisMin ?? cfg.visMin)).map((i) => ({ id: i, x: lms[i].x, y: lms[i].y, r: cfg.fistR * H })),
    ankle: ankles.length === 2 ? (lms[LM.L_ANKLE].visibility >= lms[LM.R_ANKLE].visibility ? lms[LM.L_ANKLE] : lms[LM.R_ANKLE]) : ankles[0],
  };
}

// Opponent boxes in pixels, derived from player geometry.
export function opponentBoxes(g, opp, facing, cfg, homeX) {
  const H = g.H;
  const cx = (homeX ?? g.hipMid.x) + facing * opp.dist * H;
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
// Pick the pose that belongs to the player when the detector returns several people:
// nearest hips to the last known hips (or to homeX), tie-break by size.
export function selectPose(poses, prevHip, homeX, cfg) {
  if (!poses || poses.length === 0) return null;
  if (poses.length === 1) return poses[0];
  const score = (lms) => {
    const hip = pick(lms, LM.L_HIP, LM.R_HIP, cfg); if (!hip) return Infinity;
    const ref = prevHip ? prevHip.x : homeX;
    return ref == null ? -bodyHeight(lms) : Math.abs(hip.x - ref) + (prevHip ? Math.abs(hip.y - prevHip.y) : 0);
  };
  return poses.reduce((best, p) => (score(p) < score(best) ? p : best), poses[0]);
}
const bodyHeight = (lms) => { const a = [lms[LM.L_ANKLE], lms[LM.R_ANKLE]].filter(Boolean); return a.length ? Math.max(...a.map((k) => k.y)) - lms[LM.NOSE].y : 0; };

export function step(state, lms, now, cfgOverride, frame) {
  const cfg = cfgOverride || state.cfg;
  const events = [];
  const dt = state.t == null ? 16 : Math.min(100, Math.max(1, now - state.t));
  state.t = now;
  const p = state.player, o = state.opp;

  let g = playerGeometry(lms, cfg, state.lock);
  // reject a sudden hip teleport (another person picked up by the tracker); hold for a while, then accept
  if (g && p.lastHip && state.lock) {
    const jump = Math.hypot(g.hipMid.x - p.lastHip.x, g.hipMid.y - p.lastHip.y) / state.lock.H;
    if (jump > cfg.hipJumpMax && now - p.lastHip.t < cfg.hipJumpHoldMs) { state.rejected = (state.rejected || 0) + 1; events.push({ type: 'poseJump', jump: +jump.toFixed(2) }); g = null; }
  }
  if (g) p.lastHip = { x: g.hipMid.x, y: g.hipMid.y, t: now };
  state.noBody = !g;
  if (!g) {
    p.prev = null; p.hist = [];
    if (state.phase === 'calibrate') { state.calib.okSince = null; state.calib.checks = [{ name: 'body', ok: false, msg: 'Step into frame: whole body visible' }]; }
    if (state.noBodySince == null) state.noBodySince = now;
    if (state.phase === 'fighting' && now - state.noBodySince >= cfg.noBodyResetMs && o.state !== 'KO' && o.state !== 'IDLE') { setOpp(o, 'IDLE'); events.push({ type: 'paused' }); }
    return events;
  }
  state.noBodySince = null;
  p.H = g.H; p.floorY = g.floorY; p.geom = g;

  if (state.phase === 'calibrate') {
    runCalibration(state, g, lms, now, frame || {}, cfg, events);
    p.prev = snapshot(g);
    return events;
  }
  if (state.phase !== 'fighting') {
    p.facing = state.lock ? state.lock.facing : g.facingRaw;
    state.boxes = opponentBoxes(g, o, p.facing, cfg, state.lock && state.lock.homeX);
    // thumbs-up held for thumbHoldMs starts the round (alternative to SPACE)
    if (state.phase === 'ready' || state.phase === 'ko') {
      if (detectThumbsUp(lms, g, cfg) || detectHandUp(lms, g, cfg)) { if (p.thumbSince == null) p.thumbSince = now; p.thumbProgress = Math.min(1, (now - p.thumbSince) / cfg.thumbHoldMs); if (now - p.thumbSince >= cfg.thumbHoldMs) { p.thumbSince = null; p.thumbProgress = 0; events.push({ type: 'thumbsUp' }); } }
      else { p.thumbSince = null; p.thumbProgress = 0; }
    }
    p.prev = snapshot(g); return events;
  }

  const f = p.facing, H = g.H;
  const homeX = state.lock ? state.lock.homeX : g.hipMid.x;
  const W = (frame && frame.W) || 1280;
  const maxDist = (f === 1 ? (W - homeX) / H : homeX / H) - cfg.edgeMargin;
  o.dist = Math.min(o.dist, maxDist);
  const boxes = opponentBoxes(g, o, f, cfg, homeX);
  state.boxes = boxes;
  // home zone: how far the player has advanced from the calibrated spot, in H
  p.offset = (f * (g.hipMid.x - homeX)) / H;
  const wasOut = p.outOfZone;
  p.outOfZone = p.offset > cfg.zoneFwd;
  if (p.outOfZone && !wasOut) events.push({ type: 'stepBack' });
  const gap = o.dist - p.offset; // actual distance between the two fighters

  // --- block ---
  const guardPose = g.wrists.some((w) => Math.hypot(w.x - g.nose.x, w.y - g.nose.y) <= cfg.blockDist * H
    && f * (w.x - g.nose.x) > cfg.blockFront * H      // fist between your face and Ryu, not beside your cheek
    && w.y < g.nose.y + 0.12 * H);                     // at face height, not at the chin/chest
  if (guardPose) { if (p.guardSince == null) p.guardSince = now; } else p.guardSince = null;
  p.blocking = p.guardSince != null && now - p.guardSince >= cfg.blockHoldMs;

  // --- player strikes ---
  let canStrike = now >= p.cooldownUntil && now >= p.hitstunUntil && o.state !== 'KO';
  const dmgMul = p.outOfZone ? cfg.zoneDmgMul : 1;
  // reference snapshot ~velWindowMs ago (falls back to the oldest we have)
  p.hist = p.hist || [];
  const ref = p.hist.find((h) => now - h.t >= cfg.velWindowMs) || p.hist[p.hist.length - 1] || null;
  const prev = ref;
  const speed = (x, px) => { if (!ref) return 0; const v = (f * (x - px)) / H / ((now - ref.t) / 1000); return v > cfg.maxSpeed ? 0 : v; };
  p.debug = { ext: {}, vx: {} };
  for (const w of g.wrists) {
    const ext = (f * (w.x - g.shoulderMid.x)) / H;
    const pw = prev && prev.wrists[w.id];
    const vx = pw ? speed(w.x, pw.x) : 0;
    p.debug.ext[w.id] = ext; p.debug.vx[w.id] = vx;
    if (ext < cfg.punchRearm) { p.armed[w.id] = true; p.swung[w.id] = false; }
    if (p.armed[w.id] && ext > cfg.punchExt && vx > cfg.punchSpeed) {
      const overlap = circleRect(w, boxes.hurt);
      if (canStrike && overlap) {
        p.armed[w.id] = false; canStrike = false; // one hit per frame: both fists in the box is still one punch
        hitOpponent(state, Math.round(cfg.punchDmg * dmgMul), now, w, events, cfg);
      } else if (!p.swung[w.id]) { // log the first failed swing of this punch and why
        p.swung[w.id] = true;
        events.push({ type: 'swing', kind: 'punch', wrist: w.id, ext: +ext.toFixed(2), vx: +vx.toFixed(2), gap: +gap.toFixed(2),
          reason: o.state === 'KO' ? 'ko' : now < p.hitstunUntil ? 'hitstun' : now < p.cooldownUntil ? 'cooldown' : !overlap ? 'range' : 'unknown' });
      }
    }
  }
  const a = g.ankle;
  if (a) {
    const lift = (g.floorY - a.y) / H;
    const pa = prev && prev.ankle;
    const vx = pa ? speed(a.x, pa.x) : 0;
    p.debug.lift = lift; p.debug.avx = vx;
    if (lift < cfg.kickRearm) { p.kickArmed = true; p.kickSwung = false; }
    const foot = { x: a.x, y: a.y, r: cfg.footR * H };
    if (p.kickArmed && lift > cfg.kickLift && vx > cfg.kickSpeed) {
      const overlap = circleRect(foot, boxes.hurt);
      if (canStrike && overlap) {
        p.kickArmed = false; canStrike = false;
        hitOpponent(state, Math.round(cfg.kickDmg * dmgMul), now, foot, events, cfg);
      } else if (!p.kickSwung) {
        p.kickSwung = true;
        events.push({ type: 'swing', kind: 'kick', lift: +lift.toFixed(2), vx: +vx.toFixed(2), gap: +gap.toFixed(2),
          reason: o.state === 'KO' ? 'ko' : now < p.hitstunUntil ? 'hitstun' : now < p.cooldownUntil ? 'cooldown' : !overlap ? 'range' : 'unknown' });
      }
    }
  }
  p.prev = snapshot(g);
  p.hist.unshift({ t: now, ...p.prev }); if (p.hist.length > 8) p.hist.pop();

  // --- opponent state machine ---
  if (o.state !== 'KO') {
    o.stateT += dt;
    switch (o.state) {
      case 'IDLE': if (o.stateT >= cfg.idleMs) setOpp(o, gap > cfg.attackDist ? 'APPROACH' : 'WINDUP'); break;
      case 'APPROACH':
        o.dist = Math.max(p.offset + cfg.attackDist, o.dist - cfg.approachSpeed * dt / 1000);
        if (o.dist - p.offset <= cfg.attackDist + 1e-9) setOpp(o, 'WINDUP');
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
      case 'RECOVER':
        if (o.stateT >= cfg.recoverMs) {
          if (o.landed && (o.chain = (o.chain || 0) + 1) < cfg.comboHits && gap <= cfg.attackDist + 0.15) setOpp(o, 'WINDUP'); // combo: punch again
          else { o.chain = 0; setOpp(o, o.landed ? 'HOPBACK' : 'APPROACH'); }
        }
        break;
      case 'HOPBACK':
        o.dist = Math.min(maxDist, o.dist + cfg.hopback * dt / cfg.hopbackMs);
        if (o.stateT >= cfg.hopbackMs) setOpp(o, 'IDLE');
        break;
      case 'HURT':
        o.dist = Math.min(maxDist, o.dist + cfg.knockback * dt / cfg.hurtMs);
        if (o.stateT >= cfg.hurtMs) setOpp(o, 'APPROACH');
        break;
    }
  }
  return events;
}

function hitOpponent(state, dmg, now, at, events, cfg) {
  const p = state.player, o = state.opp;
  o.hp = Math.max(0, o.hp - dmg);
  p.cooldownUntil = now + cfg.hitCooldownMs;
  const armored = cfg.armorInWindup && (o.state === 'WINDUP' || o.state === 'STRIKE');
  events.push({ type: 'oppHit', dmg, x: at.x, y: at.y, dir: p.facing, armored });
  if (o.hp === 0) { setOpp(o, 'KO'); state.phase = 'ko'; state.winner = 'YOU'; events.push({ type: 'ko', winner: 'YOU' }); }
  else if (!armored) setOpp(o, 'HURT'); // armored: Ryu takes the damage and keeps swinging (a trade)
  else o.armorFlashUntil = now + 200;
}

function setOpp(o, s) { o.state = s; o.stateT = 0; }

function snapshot(g) {
  const wrists = {};
  for (const w of g.wrists) wrists[w.id] = { x: w.x, y: w.y };
  return { wrists, ankle: g.ankle ? { x: g.ankle.x, y: g.ankle.y } : null };
}

const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : null; };

// Runs every frame while phase === 'calibrate'. Fills state.calib.checks; locks scale and
// moves to 'ready' once every check has been green for cfg.calibHoldMs.
export function runCalibration(state, g, lms, now, frame, cfg, events) {
  const c = state.calib, W = frame.W || 1280, Hc = frame.Hc || 720;
  c.noseHist.push({ x: g.nose.x, y: g.nose.y }); if (c.noseHist.length > 30) c.noseHist.shift();
  c.hHist.push(g.Hmeasured); if (c.hHist.length > 30) c.hHist.shift();
  c.floorHist.push(g.floorMeasured); if (c.floorHist.length > 30) c.floorHist.shift();
  const checks = calibrationChecks(g, lms, W, Hc, frame, c.noseHist, cfg);
  c.checks = checks;
  const allOk = checks.every((k) => k.ok);
  if (!allOk) { c.okSince = null; return; }
  if (c.okSince == null) c.okSince = now;
  c.progress = Math.min(1, (now - c.okSince) / cfg.calibHoldMs);
  if (now - c.okSince >= cfg.calibHoldMs) {
    state.lock = { H: median(c.hHist), floorY: median(c.floorHist), facing: g.facingRaw, homeX: g.hipMid.x };
    state.player.facing = g.facingRaw;
    state.phase = 'ready';
    events.push({ type: 'ready' });
  }
}

export function calibrationChecks(g, lms, W, Hc, frame, noseHist, cfg) {
  const H = g.Hmeasured, checks = [];
  const need = [LM.NOSE, LM.L_ANKLE, LM.R_ANKLE];
  const bodyOk = need.every((i) => vis(lms[i], cfg)) && (vis(lms[LM.L_SHOULDER], cfg) || vis(lms[LM.R_SHOULDER], cfg)) && (vis(lms[LM.L_WRIST], cfg) || vis(lms[LM.R_WRIST], cfg));
  checks.push({ name: 'body', ok: bodyOk, msg: bodyOk ? 'Whole body tracked' : 'Whole body must be visible: head, hands, both feet' });
  const size = H / Hc;
  checks.push({ name: 'distance', ok: size >= cfg.sizeMin && size <= cfg.sizeMax, msg: size < cfg.sizeMin ? `Come closer (body ${Math.round(size * 100)}% of frame)` : size > cfg.sizeMax ? `Step back (body ${Math.round(size * 100)}% of frame)` : `Distance ok (body ${Math.round(size * 100)}% of frame)` });
  const headIn = g.nose.y > 0.04 * Hc, feetIn = g.floorMeasured < 0.98 * Hc;
  checks.push({ name: 'framing', ok: headIn && feetIn, msg: !headIn ? 'Head cut off: tilt camera up or step back' : !feetIn ? 'Feet cut off: tilt camera down or step back' : 'Head and feet in frame' });
  const profile = Math.abs(g.nose.x - g.hipMid.x) / H;
  const facing = g.facingRaw, side = facing === 1 ? 'right' : 'left';
  checks.push({ name: 'profile', ok: profile > 0.04, msg: profile > 0.04 ? `Side profile ok, facing ${side}` : 'Turn side-on to the camera' });
  const room = (facing === 1 ? W - g.hipMid.x : g.hipMid.x) / H;
  checks.push({ name: 'room', ok: room >= cfg.roomForOpp, msg: room >= cfg.roomForOpp ? `Room for Ryu on your ${side}` : `Move ${facing === 1 ? 'left' : 'right'}: Ryu needs space on your ${side}` });
  if (frame.luma != null) checks.push({ name: 'light', ok: frame.luma >= cfg.lumaMin && frame.luma <= cfg.lumaMax, msg: frame.luma < cfg.lumaMin ? `Too dark (${Math.round(frame.luma)})` : frame.luma > cfg.lumaMax ? `Too bright (${Math.round(frame.luma)})` : `Lighting ok (${Math.round(frame.luma)})` });
  if (noseHist.length >= 20) {
    const mx = noseHist.reduce((s, p) => s + p.x, 0) / noseHist.length, my = noseHist.reduce((s, p) => s + p.y, 0) / noseHist.length;
    const jitter = Math.sqrt(noseHist.reduce((s, p) => s + (p.x - mx) ** 2 + (p.y - my) ** 2, 0) / noseHist.length) / H;
    checks.push({ name: 'steady', ok: jitter <= cfg.jitterMax, msg: jitter <= cfg.jitterMax ? `Tracking steady (${jitter.toFixed(3)})` : `Tracking jittery (${jitter.toFixed(3)}): stand still, more light, plainer background` });
  } else checks.push({ name: 'steady', ok: false, msg: 'Measuring steadiness...' });
  if (frame.fps != null) checks.push({ name: 'fps', ok: frame.fps >= cfg.fpsMin, msg: frame.fps >= cfg.fpsMin ? `${Math.round(frame.fps)} fps` : `Low frame rate (${Math.round(frame.fps)} fps): close other tabs` });
  return checks;
}

// New round using the existing lock. Requires phase 'ready' or 'ko'.
export function startFight(state) {
  if (!state.lock) return false;
  const cfg = state.cfg;
  state.player.hp = cfg.maxHp; state.player.hitstunUntil = 0; state.player.cooldownUntil = 0;
  state.opp = { hp: cfg.maxHp, dist: cfg.startDist, state: 'IDLE', stateT: 0, landed: false, struck: false, hitstunUntil: 0 };
  state.winner = null; state.phase = 'fighting';
  if (state.player.geom) state.lock.homeX = state.player.geom.hipMid.x; // home = where you stand when the round starts
  state.player.outOfZone = false;
  return true;
}

export function recalibrate(state) {
  state.lock = null; state.phase = 'calibrate';
  state.calib = { okSince: null, noseHist: [], hHist: [], floorHist: [], checks: [] };
}

// Thumbs up: thumb tip clearly above the wrist, index knuckle close to the wrist (closed fist),
// hand raised to at least shoulder height. Either hand.
export function detectThumbsUp(lms, g, cfg) {
  const H = g.H;
  for (const [wr, th, ix] of [[LM.L_WRIST, 21, 19], [LM.R_WRIST, 22, 20]]) {
    const w = lms[wr], t = lms[th], i = lms[ix];
    if (!vis(w, cfg) || !t || !i || t.visibility < 0.3) continue;
    const thumbUp = (w.y - t.y) / H > cfg.thumbUp;
    const fist = Math.hypot(i.x - w.x, i.y - w.y) / H < cfg.fistTight;
    const raised = w.y < g.hipMid.y; // anywhere above the hips
    if (thumbUp && fist && raised) return true;
  }
  return false;
}

// Hand raised clearly above the head: the fallback start gesture.
export function detectHandUp(lms, g, cfg) {
  return [LM.L_WRIST, LM.R_WRIST].some((i) => vis(lms[i], cfg) && (g.nose.y - lms[i].y) / g.H > cfg.handUpAbove);
}
