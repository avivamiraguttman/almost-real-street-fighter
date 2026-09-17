// Drawing only. Knows nothing about landmarks beyond what combat.js hands over.
export const SPRITE_REF_H = 80; // px of sprite height that corresponds to one H (nose to ankle)
export const SHEET_FACES_RIGHT = true;

export async function loadSprites(base = 'assets/') {
  const frames = await (await fetch(base + 'ryu.json')).json();
  const sheet = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = base + 'ryu.png'; });
  return { sheet, frames };
}

const cycle = (names, ms, t) => names[Math.floor(t / ms) % names.length];
const seq = (names, ms, t) => names[Math.min(names.length - 1, Math.floor(t / ms))];
export function frameFor(opp, wallT, winner) {
  const t = opp.stateT;
  switch (opp.state) {
    case 'IDLE': return cycle(['idle-1', 'idle-2', 'idle-3', 'idle-4', 'idle-3', 'idle-2'], 110, wallT);
    case 'APPROACH': return cycle(['forwards-1', 'forwards-2', 'forwards-3', 'forwards-4', 'forwards-5', 'forwards-6'], 80, wallT);
    case 'WINDUP': return seq(['med-punch-1', 'med-punch-1', 'med-punch-2'], 170, t);
    case 'STRIKE': return 'heavy-punch-1';
    case 'RECOVER': return seq(['med-punch-2', 'med-punch-1'], 200, t);
    case 'HOPBACK': return 'jump-roll-7';
    case 'HURT': return seq(['hit-face-1', 'hit-face-2', 'hit-face-3'], 100, t);
    case 'KO': return winner === 'RYU'
      ? seq(['victory-1', 'victory-2', 'victory-3', 'victory-4'], 150, t) // Ryu won: victory pose
      : seq(['fall-1', 'fall-2', 'fall-3', 'fall-4', 'fall-5'], 120, t);
    default: return 'idle-1';
  }
}

export function drawOpponent(ctx, sprites, opp, boxes, facing, H, wallT, winner) {
  const s = H / SPRITE_REF_H;
  const name = frameFor(opp, wallT, winner);
  const fr = sprites && sprites.frames[name];
  ctx.save();
  ctx.translate(boxes.cx, boxes.feetY);
  // opponent must face the player: if it stands on the right (facing=+1) it looks left.
  const flip = (facing === 1) === SHEET_FACES_RIGHT;
  ctx.scale(flip ? -s : s, s);
  ctx.imageSmoothingEnabled = false;
  if (opp.armorFlashUntil && wallT < opp.armorFlashUntil) ctx.filter = 'brightness(1.8) saturate(0.2)'; // armored hit: white flash, no stagger
  if (fr) ctx.drawImage(sprites.sheet, fr.x, fr.y, fr.w, fr.h, -fr.ax, -fr.ay, fr.w, fr.h);
  else { ctx.fillStyle = '#c33'; ctx.fillRect(-15, -90, 30, 90); ctx.fillStyle = '#fff'; ctx.font = '10px sans-serif'; ctx.fillText(name, -15, -95); }
  ctx.restore();
}

export function drawHUD(ctx, W, state, cfg) {
  const p = state.player, o = state.opp;
  const barW = W * 0.38, barH = 22, y = 24;
  const leftIsYou = p.facing === 1;
  bar(ctx, 20, y, barW, barH, (leftIsYou ? p.hp : o.hp) / cfg.maxHp, leftIsYou ? 'YOU' : 'RYU', 'left');
  bar(ctx, W - 20 - barW, y, barW, barH, (leftIsYou ? o.hp : p.hp) / cfg.maxHp, leftIsYou ? 'RYU' : 'YOU', 'right');
  ctx.textAlign = 'center'; ctx.fillStyle = '#ffd400'; ctx.font = 'bold 26px "Courier New", monospace';
  ctx.strokeStyle = '#000'; ctx.lineWidth = 4;
  const centerMsg = state.phase === 'calibrate' ? 'CALIBRATION' : state.noBody ? 'STEP INTO FRAME' : state.phase === 'ready' ? 'READY' : state.phase === 'ko' ? '' : 'FIGHT';
  if (centerMsg) { ctx.strokeText(centerMsg, W / 2, y + 18); ctx.fillText(centerMsg, W / 2, y + 18); }
  if (state.phase === 'ko') drawEndScreen(ctx, W, Hc, state);
  if (p.outOfZone && state.phase === 'fighting') {
    ctx.font = 'bold 56px "Courier New", monospace'; ctx.lineWidth = 6; ctx.strokeStyle = '#000'; ctx.fillStyle = '#ff5a5a';
    ctx.strokeText('STEP BACK', W / 2, 160); ctx.fillText('STEP BACK', W / 2, 160);
  }
  if (p.blocking && state.phase === 'fighting') { ctx.font = 'bold 20px monospace'; ctx.fillStyle = '#7cf'; ctx.fillText('GUARD', W / 2, y + 48); }
}
function bar(ctx, x, y, w, h, frac, label, align) {
  ctx.fillStyle = '#111'; ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
  ctx.fillStyle = '#b00'; ctx.fillRect(x, y, w, h);
  const fw = Math.max(0, frac) * w;
  ctx.fillStyle = frac > 0.3 ? '#ffd400' : '#ff5a00';
  if (align === 'left') ctx.fillRect(x + (w - fw), y, fw, h); else ctx.fillRect(x, y, fw, h);
  ctx.fillStyle = '#fff'; ctx.font = 'bold 18px "Courier New", monospace'; ctx.textAlign = align;
  ctx.fillText(label, align === 'left' ? x : x + w, y + h + 20);
}

// effects: [{type:'spark'|'popup'|'flash', t0, x, y, text}]
export function drawEffects(ctx, W, Hc, effects, now) {
  for (const e of effects) {
    const age = now - e.t0;
    if (e.type === 'spark' && age < 200) {
      const r = 10 + age * 0.35; ctx.save(); ctx.translate(e.x, e.y); ctx.strokeStyle = age < 100 ? '#fff' : '#ffd400'; ctx.lineWidth = 4;
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2 + 0.3; ctx.beginPath(); ctx.moveTo(Math.cos(a) * r * 0.4, Math.sin(a) * r * 0.4); ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r); ctx.stroke(); }
      ctx.restore();
    } else if (e.type === 'popup' && age < 700) {
      ctx.save(); ctx.globalAlpha = 1 - age / 700; ctx.font = 'bold 34px "Courier New", monospace'; ctx.textAlign = 'center';
      ctx.lineWidth = 5; ctx.strokeStyle = '#000'; ctx.fillStyle = e.color || '#fff';
      ctx.strokeText(e.text, e.x, e.y - age * 0.08); ctx.fillText(e.text, e.x, e.y - age * 0.08); ctx.restore();
    } else if (e.type === 'flash' && age < 150) {
      ctx.save(); ctx.globalAlpha = 0.35 * (1 - age / 150); ctx.fillStyle = '#f00'; ctx.fillRect(0, 0, W, Hc); ctx.restore();
    }
  }
}
export const pruneEffects = (effects, now) => effects.filter((e) => now - e.t0 < 800);

export function drawDebug(ctx, lmsPx, state) {
  const g = state.player.geom; if (!g) return;
  ctx.save(); ctx.lineWidth = 2;
  const pairs = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28]];
  ctx.strokeStyle = '#0f0';
  for (const [a, b] of pairs) if (lmsPx[a] && lmsPx[b]) { ctx.beginPath(); ctx.moveTo(lmsPx[a].x, lmsPx[a].y); ctx.lineTo(lmsPx[b].x, lmsPx[b].y); ctx.stroke(); }
  ctx.strokeStyle = '#0ff'; ctx.beginPath(); ctx.arc(g.head.x, g.head.y, g.head.r, 0, 7); ctx.stroke(); ctx.strokeRect(g.torso.x, g.torso.y, g.torso.w, g.torso.h);
  ctx.strokeStyle = '#ff0'; for (const w of g.wrists) { ctx.beginPath(); ctx.arc(w.x, w.y, w.r, 0, 7); ctx.stroke(); }
  if (state.boxes) { ctx.strokeStyle = '#f0f'; ctx.strokeRect(state.boxes.hurt.x, state.boxes.hurt.y, state.boxes.hurt.w, state.boxes.hurt.h); if (state.opp.state === 'STRIKE' || state.opp.state === 'WINDUP') { ctx.strokeStyle = '#f00'; ctx.strokeRect(state.boxes.fist.x, state.boxes.fist.y, state.boxes.fist.w, state.boxes.fist.h); } }
  ctx.fillStyle = '#0f0'; ctx.font = '14px monospace'; ctx.textAlign = 'left';
  const d = state.player.debug || { ext: {}, vx: {} };
  const lines = [
    `phase ${state.phase}  opp ${state.opp.state} dist ${state.opp.dist.toFixed(2)}H  H ${Math.round(g.H)}px facing ${state.player.facing}`,
    ...Object.keys(d.ext).map((k) => `wrist ${k}: ext ${d.ext[k].toFixed(2)}  vx ${d.vx[k].toFixed(2)} H/s`),
    `ankle lift ${(d.lift ?? 0).toFixed(2)}  vx ${(d.avx ?? 0).toFixed(2)}  blocking ${!!state.player.blocking}`,
  ];
  lines.forEach((l, i) => ctx.fillText(l, 12, 90 + i * 18));
  ctx.restore();
}

// Calibration screen: checklist with pass/fail, hold progress, framing guide.
export function drawCalibration(ctx, W, Hc, state, lmsPx) {
  const c = state.calib;
  ctx.save();
  if (lmsPx && state.player.geom) drawSkeleton(ctx, lmsPx, '#0f0');
  const x = 30, y0 = 110, lh = 34;
  const checks = c.checks && c.checks.length ? c.checks : [{ ok: false, msg: 'Step into frame: whole body visible' }];
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(x - 14, y0 - 40, 620, checks.length * lh + 110);
  ctx.font = 'bold 22px "Courier New", monospace'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffd400';
  ctx.fillText('Stand side-on in fighting stance. Hold still.', x, y0 - 12);
  drawTitle(ctx, W);
  ctx.font = '20px "Courier New", monospace';
  checks.forEach((k, i) => {
    ctx.fillStyle = k.ok ? '#3ddc5a' : '#ff5a5a';
    ctx.fillText((k.ok ? '\u2714 ' : '\u2716 ') + k.msg, x, y0 + 20 + i * lh);
  });
  const allOk = checks.every((k) => k.ok);
  const py = y0 + 30 + checks.length * lh;
  ctx.fillStyle = '#333'; ctx.fillRect(x, py, 560, 18);
  ctx.fillStyle = allOk ? '#3ddc5a' : '#666'; ctx.fillRect(x, py, 560 * (allOk ? (c.progress || 0) : 0), 18);
  ctx.fillStyle = '#ccc'; ctx.font = '16px "Courier New", monospace';
  ctx.fillText(allOk ? 'Locking scale...' : 'Fix the red items above', x, py + 38);
  ctx.restore();
}

export function drawTitle(ctx, W) {
  ctx.save(); ctx.textAlign = 'right'; ctx.font = 'bold 30px "Courier New", monospace'; ctx.lineWidth = 6; ctx.strokeStyle = '#000';
  ctx.strokeText('ALMOST REAL', W - 30, 100); ctx.fillStyle = '#ffd400'; ctx.fillText('ALMOST REAL', W - 30, 100);
  ctx.font = 'bold 44px "Courier New", monospace'; ctx.lineWidth = 7;
  ctx.strokeText('STREET FIGHTER', W - 30, 145); ctx.fillStyle = '#ff3b3b'; ctx.fillText('STREET FIGHTER', W - 30, 145);
  ctx.restore();
}

export function drawReady(ctx, W, Hc, state) {
  drawTitle(ctx, W);
  ctx.save(); ctx.textAlign = 'center'; ctx.lineWidth = 6; ctx.strokeStyle = '#000';
  ctx.font = 'bold 40px "Courier New", monospace'; ctx.fillStyle = '#fff';
  ctx.strokeText('THUMBS UP, HAND UP, or SPACE to FIGHT', W / 2, Hc / 2); ctx.fillText('THUMBS UP, HAND UP, or SPACE to FIGHT', W / 2, Hc / 2);
  const tp = state.player.thumbProgress || 0;
  if (tp > 0) { ctx.fillStyle = '#333'; ctx.fillRect(W / 2 - 150, Hc / 2 + 60, 300, 14); ctx.fillStyle = '#3ddc5a'; ctx.fillRect(W / 2 - 150, Hc / 2 + 60, 300 * tp, 14); }
  ctx.font = '20px "Courier New", monospace'; ctx.fillStyle = '#ccc'; ctx.lineWidth = 4;
  const msg = `scale locked: body ${Math.round(state.lock.H)} px, facing ${state.lock.facing === 1 ? 'right' : 'left'}   |   C = recalibrate`;
  ctx.strokeText(msg, W / 2, Hc / 2 + 40); ctx.fillText(msg, W / 2, Hc / 2 + 40);
  ctx.restore();
}

export function drawSkeleton(ctx, lmsPx, color) {
  const pairs = [[11, 13], [13, 15], [12, 14], [14, 16], [11, 12], [11, 23], [12, 24], [23, 24], [23, 25], [25, 27], [24, 26], [26, 28], [0, 11], [0, 12]];
  ctx.save(); ctx.strokeStyle = color; ctx.lineWidth = 3;
  for (const [a, b] of pairs) if (lmsPx[a] && lmsPx[b] && lmsPx[a].visibility > 0.5 && lmsPx[b].visibility > 0.5) { ctx.beginPath(); ctx.moveTo(lmsPx[a].x, lmsPx[a].y); ctx.lineTo(lmsPx[b].x, lmsPx[b].y); ctx.stroke(); }
  ctx.restore();
}

// End screen: gold confetti and a big YOU WIN, or a grey rain and a quiet YOU LOSE.
let _seed = null;
function particles(n) {
  if (_seed && _seed.length === n) return _seed;
  let x = 12345; const rnd = () => ((x = (x * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  _seed = Array.from({ length: n }, () => ({ x: rnd(), y: rnd(), v: 0.4 + rnd() * 0.8, w: 6 + rnd() * 10, h: 4 + rnd() * 8, hue: rnd() * 360, spin: rnd() * 6 }));
  return _seed;
}
export function drawEndScreen(ctx, W, Hc, state) {
  const now = performance.now();
  const age = state.koAt != null && state.t != null ? Math.max(0, state.t - state.koAt) : 2000; // game clock ms since KO
  const won = state.winner === 'YOU';
  ctx.save();
  if (won) {
    for (const p of particles(140)) {
      const y = ((p.y + (age / 1000) * p.v * 0.35) % 1.1) * Hc - 40;
      ctx.save(); ctx.translate(p.x * W, y); ctx.rotate(age / 300 * p.spin * 0.2);
      ctx.fillStyle = `hsl(${(p.hue + age / 20) % 360} 90% 60%)`; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
    }
  } else {
    ctx.fillStyle = 'rgba(20,20,40,0.45)'; ctx.fillRect(0, 0, W, Hc);
    ctx.strokeStyle = 'rgba(180,190,220,0.5)'; ctx.lineWidth = 2;
    for (const p of particles(90)) {
      const y = ((p.y + (age / 1000) * p.v * 0.9) % 1.1) * Hc - 40, x = p.x * W;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 4, y + 22); ctx.stroke();
    }
  }
  ctx.textAlign = 'center'; ctx.lineWidth = 8; ctx.strokeStyle = '#000';
  const pop = 1 + 0.06 * Math.sin(age / 180);
  ctx.save(); ctx.translate(W / 2, Hc * 0.36); ctx.scale(pop, pop);
  ctx.font = 'bold 96px "Courier New", monospace';
  ctx.strokeText('K.O.', 0, 0); ctx.fillStyle = won ? '#ffd400' : '#8a94b8'; ctx.fillText('K.O.', 0, 0);
  ctx.restore();
  ctx.font = 'bold 64px "Courier New", monospace'; ctx.lineWidth = 7;
  const title = won ? (state.perfect ? 'PERFECT!  YOU WIN!' : 'YOU WIN!') : 'YOU LOSE...';
  ctx.strokeText(title, W / 2, Hc * 0.36 + 80);
  if (won) { const g = ctx.createLinearGradient(0, Hc * 0.36 + 20, 0, Hc * 0.36 + 90); g.addColorStop(0, '#fff3a0'); g.addColorStop(1, '#ff9d00'); ctx.fillStyle = g; }
  else ctx.fillStyle = '#b9c1dc';
  ctx.fillText(title, W / 2, Hc * 0.36 + 80);
  ctx.font = '26px "Courier New", monospace'; ctx.lineWidth = 5; ctx.fillStyle = won ? '#fff' : '#9aa3c0';
  const sub = won ? `Ryu is down. ${state.player.hp} HP left.` : 'Ryu stands over you. Shake it off.';
  ctx.strokeText(sub, W / 2, Hc * 0.36 + 125); ctx.fillText(sub, W / 2, Hc * 0.36 + 125);
  ctx.font = '20px "Courier New", monospace'; ctx.lineWidth = 4; ctx.fillStyle = '#ddd';
  const hint = 'thumbs up / hand up / SPACE: rematch     R: ready screen     L: save log';
  ctx.strokeText(hint, W / 2, Hc * 0.36 + 165); ctx.fillText(hint, W / 2, Hc * 0.36 + 165);
  const tp = state.player.thumbProgress || 0;
  if (tp > 0) { ctx.fillStyle = '#333'; ctx.fillRect(W / 2 - 150, Hc * 0.36 + 180, 300, 14); ctx.fillStyle = '#3ddc5a'; ctx.fillRect(W / 2 - 150, Hc * 0.36 + 180, 300 * tp, 14); }
  ctx.restore();
}
