'use strict';

// ---------------------------------------------------------------------------
// Garden Siege - a lane-defense game. Everything is drawn procedurally.
// ---------------------------------------------------------------------------

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const W = canvas.width;
const H = canvas.height;

const ROWS = 5;
const COLS = 9;
const CW = 80;              // cell width
const CH = 96;              // cell height
const LX = 60;              // lawn left edge
const LY = 112;             // lawn top edge
const LAWN_R = LX + COLS * CW;
const ZOMBIE_SCALE = 0.85;

const PLANTS = {
  lantern:  { name: 'Lantern Bloom', cost: 50, cd: 7.5, hp: 300,  startCd: 0,  desc: 'Glows out extra sun' },
  reed:     { name: 'Reed Cannon', cost: 100, cd: 7.5, hp: 300,  startCd: 0,  desc: 'Fires seeds down its lane' },
  briar:    { name: 'Briar Hedge', cost: 50,  cd: 30,  hp: 4000, startCd: 20, desc: 'Thorny wall, slow to chew' },
  frost:    { name: 'Frost Reed',  cost: 175, cd: 7.5, hp: 300,  startCd: 0,  desc: 'Icy seeds slow shamblers' },
  twin:     { name: 'Twin Reed',   cost: 200, cd: 7.5, hp: 300,  startCd: 0,  desc: 'Fires two seeds at once' },
  pinecone: { name: 'Pine Grenade', cost: 150, cd: 50,  hp: 9999, startCd: 35, desc: 'Blows up a 3x3 area' },
};
const CARD_ORDER = ['lantern', 'reed', 'briar', 'frost', 'twin', 'pinecone'];

const ZOMBIES = {
  basic:  { hp: 200, armor: 0,    speed: 18, cost: 1, weight: 6, minWave: 0 },
  pot:    { hp: 200, armor: 370,  speed: 18, cost: 2, weight: 4, minWave: 1 },
  runner: { hp: 180, armor: 0,    speed: 36, cost: 2, weight: 2, minWave: 3 },
  helm:   { hp: 200, armor: 1100, speed: 18, cost: 4, weight: 2, minWave: 4 },
  herald: { hp: 200, armor: 0,    speed: 24, cost: 1, weight: 0, minWave: 99 },
};

const TOTAL_WAVES = 12;
const FLAG_WAVES = new Set([5, 11]);   // 0-based: waves 6 and 12 are huge

const SHOT_DMG = 20;
const SHOT_SPEED = 320;
const FIRE_INTERVAL = 1.4;
const BITE_DPS = 100;

// Top bar layout
const SUN_BOX = { x: 10, y: 8, w: 80, h: 84 };
const CARD = { x: 100, y: 8, w: 64, h: 84, gap: 6 };
const PROGRESS = { x: 600, y: 22, w: 170, h: 16 };
const PAUSE_BTN = { x: 785, y: 12, w: 50, h: 34 };
const SPEED_BTN = { x: 840, y: 12, w: 50, h: 34 };

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const inRect = (x, y, r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const cellX = c => LX + c * CW + CW / 2;
const rowBase = r => LY + r * CH + CH - 14;

let S;

function newGame() {
  S = {
    mode: 'title',          // title | play | win | lose
    paused: false,
    speed: 1,
    time: 0,
    sun: 150,
    grid: Array.from({ length: ROWS }, () => Array(COLS).fill(null)),
    plants: [],
    zombies: [],
    shots: [],
    suns: [],
    fx: [],
    mowers: Array.from({ length: ROWS }, (_, r) => ({ row: r, x: LX - 38, state: 'ready' })),
    cards: CARD_ORDER.map(k => ({ key: k, cd: PLANTS[k].startCd, deny: 0 })),
    selected: null,         // plant key or 'shovel'
    waveIndex: 0,
    nextWaveAt: 15,
    spawnQueue: [],
    skySunAt: 5,
    banner: null,
    shake: 0,
    mouse: { x: -100, y: -100 },
    endT: 0,
  };
}

// ---------------------------------------------------------------------------
// Spawning
// ---------------------------------------------------------------------------

function spawnSkySun() {
  S.suns.push({
    x: rand(LX + 30, LAWN_R - 30), y: -30, vx: 0, vy: 55,
    targetY: rand(LY + 40, LY + ROWS * CH - 40),
    value: 25, life: 10, state: 'fall', t: 0,
  });
}

function spawnPlantSun(x, y) {
  S.suns.push({
    x, y, vx: rand(-40, 40), vy: -140, targetY: y + 30,
    value: 25, life: 10, state: 'pop', t: 0,
  });
}

function spawnZombie(type, row) {
  const d = ZOMBIES[type];
  S.zombies.push({
    type, row,
    x: W + rand(0, 15),
    hp: d.hp, armor: d.armor, maxArmor: d.armor,
    speed: d.speed * rand(0.9, 1.1),
    slow: 0, flash: 0, eating: false,
    dead: false, burnt: false, deathT: 0,
    phase: rand(0, 6),
  });
}

function buildWave(i, flag) {
  let budget = flag ? Math.round((2 + i * 0.9) * 2) : Math.max(1, Math.round(1 + i * 0.85));
  const types = Object.keys(ZOMBIES).filter(k => ZOMBIES[k].minWave <= i);
  const list = flag ? ['herald'] : [];
  while (budget > 0) {
    const pool = [];
    for (const k of types) {
      if (ZOMBIES[k].cost <= budget) for (let n = 0; n < ZOMBIES[k].weight; n++) pool.push(k);
    }
    const t = pool[Math.floor(Math.random() * pool.length)];
    list.push(t);
    budget -= ZOMBIES[t].cost;
  }
  return list;
}

function launchWave() {
  const i = S.waveIndex++;
  const flag = FLAG_WAVES.has(i);
  const final = i === TOTAL_WAVES - 1;
  let delay = 0;
  if (i === 0) showBanner('Here they come!', 2.5, '#c8f07a');
  if (flag) {
    showBanner(final ? 'FINAL WAVE!' : 'A huge wave is approaching!', 3, final ? '#ff5a40' : '#ffd84a');
    delay = 3;
  }
  for (const type of buildWave(i, flag)) {
    S.spawnQueue.push({
      type,
      row: Math.floor(Math.random() * ROWS),
      at: S.time + delay + (type === 'herald' || i === 0 ? 0 : rand(0, flag ? 5 : 8)),
    });
  }
  S.nextWaveAt = S.time + (flag ? 35 : 27);
}

function showBanner(text, dur, color) {
  S.banner = { text, t: 0, dur, color };
}

// ---------------------------------------------------------------------------
// Combat helpers
// ---------------------------------------------------------------------------

function damageZombie(z, dmg) {
  if (z.dead) return;
  z.flash = 0.1;
  if (z.armor > 0) {
    z.armor -= dmg;
    if (z.armor > 0) return;
    dmg = -z.armor;
    z.armor = 0;
    S.fx.push({
      kind: 'hat', hat: z.type, x: z.x - 4, y: rowBase(z.row) - 100 * ZOMBIE_SCALE,
      vx: rand(30, 70), vy: -150, rot: 0, t: 0, dur: 1.2, ground: rowBase(z.row),
    });
  }
  z.hp -= dmg;
  if (z.hp <= 0) {
    z.dead = true;
    z.deathT = 0;
  }
}

function killPlant(p) {
  p.hp = 0;
  p.dead = true;
  if (S.grid[p.row][p.col] === p) S.grid[p.row][p.col] = null;
}

function zombieAhead(p) {
  const px = cellX(p.col) - 20;
  return S.zombies.some(z => !z.dead && z.row === p.row && z.x > px && z.x < W - 15);
}

function fire(p) {
  S.shots.push({
    row: p.row, x: cellX(p.col) + 30, y: rowBase(p.row) - 46,
    frost: p.type === 'frost', dead: false,
  });
  p.recoil = 0.12;
}

function explode(p) {
  const cx = cellX(p.col);
  for (const z of S.zombies) {
    if (!z.dead && Math.abs(z.row - p.row) <= 1 && Math.abs(z.x - cx) < CW * 1.5) {
      z.burnt = true;
      damageZombie(z, 1800);
    }
  }
  S.fx.push({ kind: 'boom', x: cx, y: rowBase(p.row) - 30, t: 0, dur: 0.8 });
  for (let i = 0; i < 18; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(80, 240);
    S.fx.push({ kind: 'spark', x: cx, y: rowBase(p.row) - 30, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0, dur: rand(0.4, 0.8), color: Math.random() < 0.5 ? '#ffb030' : '#ff5a20' });
  }
  S.shake = 0.35;
  killPlant(p);
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

function update(dt) {
  S.time += dt;
  S.shake = Math.max(0, S.shake - dt);

  for (const c of S.cards) {
    c.cd = Math.max(0, c.cd - dt);
    c.deny = Math.max(0, c.deny - dt);
  }

  if (S.time >= S.skySunAt) {
    spawnSkySun();
    S.skySunAt = S.time + rand(9, 13);
  }

  updateWaves();
  for (const p of S.plants) updatePlant(p, dt);
  for (const z of S.zombies) updateZombie(z, dt);
  for (const s of S.shots) updateShot(s, dt);
  for (const m of S.mowers) updateMower(m, dt);
  for (const s of S.suns) updateSun(s, dt);
  for (const f of S.fx) updateFx(f, dt);

  if (S.banner) {
    S.banner.t += dt;
    if (S.banner.t > S.banner.dur) S.banner = null;
  }

  S.plants = S.plants.filter(p => !p.dead);
  S.zombies = S.zombies.filter(z => !(z.dead && z.deathT > 1.2));
  S.shots = S.shots.filter(s => !s.dead);
  S.suns = S.suns.filter(s => !s.dead);
  S.fx = S.fx.filter(f => f.t < f.dur);

  if (S.waveIndex >= TOTAL_WAVES && S.spawnQueue.length === 0 && S.zombies.length === 0) {
    S.mode = 'win';
    S.endT = 0;
  }
}

function updateWaves() {
  for (let i = S.spawnQueue.length - 1; i >= 0; i--) {
    const q = S.spawnQueue[i];
    if (S.time >= q.at) {
      spawnZombie(q.type, q.row);
      S.spawnQueue.splice(i, 1);
    }
  }
  if (S.waveIndex >= TOTAL_WAVES) return;
  // If the lawn is cleared, bring the next wave forward.
  const busy = S.spawnQueue.length > 0 || S.zombies.some(z => !z.dead);
  if (!busy && S.waveIndex > 0 && S.nextWaveAt - S.time > 6) S.nextWaveAt = S.time + 6;
  if (S.time >= S.nextWaveAt) launchWave();
}

function updatePlant(p, dt) {
  p.t += dt;
  p.flash = Math.max(0, p.flash - dt);
  p.recoil = Math.max(0, p.recoil - dt);
  switch (p.type) {
    case 'lantern':
      p.timer -= dt;
      if (p.timer <= 0) {
        p.timer = 24;
        spawnPlantSun(cellX(p.col), rowBase(p.row) - 50);
      }
      break;
    case 'reed':
    case 'frost':
    case 'twin':
      p.timer -= dt;
      if (p.burst > 0) {
        p.burstT -= dt;
        if (p.burstT <= 0) {
          fire(p);
          p.burst--;
        }
      }
      if (p.timer <= 0 && zombieAhead(p)) {
        p.timer = FIRE_INTERVAL;
        fire(p);
        if (p.type === 'twin') {
          p.burst = 1;
          p.burstT = 0.18;
        }
      }
      break;
    case 'pinecone':
      p.timer -= dt;
      if (p.timer <= 0) explode(p);
      break;
  }
}

function updateZombie(z, dt) {
  if (z.dead) {
    z.deathT += dt;
    return;
  }
  z.flash = Math.max(0, z.flash - dt);
  z.slow = Math.max(0, z.slow - dt);
  const f = z.slow > 0 ? 0.5 : 1;
  z.phase += dt * f * (z.type === 'runner' ? 9 : 5);

  const front = z.x - 26;
  const col = Math.floor((front - LX) / CW);
  const p = col >= 0 && col < COLS ? S.grid[z.row][col] : null;
  if (p && !p.dead && z.x < LAWN_R + 30) {
    z.eating = true;
    p.hp -= BITE_DPS * f * dt;
    p.flash = 0.1;
    if (p.hp <= 0) killPlant(p);
  } else {
    z.eating = false;
    z.x -= z.speed * f * dt;
  }

  if (z.x < LX - 5) {
    const m = S.mowers[z.row];
    if (m.state === 'ready') m.state = 'go';
    else if (z.x < 5 && S.mode === 'play') {
      S.mode = 'lose';
      S.endT = 0;
    }
  }
}

function updateShot(s, dt) {
  s.x += SHOT_SPEED * dt;
  let target = null;
  for (const z of S.zombies) {
    if (z.dead || z.row !== s.row || z.x > W - 5) continue;
    if (s.x >= z.x - 18 && s.x <= z.x + 26 && (!target || z.x < target.x)) target = z;
  }
  if (target) {
    damageZombie(target, SHOT_DMG);
    if (s.frost) target.slow = 10;
    s.dead = true;
    for (let i = 0; i < 5; i++) {
      S.fx.push({ kind: 'spark', x: s.x, y: s.y, vx: rand(-90, 20), vy: rand(-80, 80), t: 0, dur: 0.3, color: s.frost ? '#c8f4ff' : '#e0b050' });
    }
  }
  if (s.x > W + 20) s.dead = true;
}

function updateMower(m, dt) {
  if (m.state !== 'go') return;
  m.x += 380 * dt;
  for (const z of S.zombies) {
    if (!z.dead && z.row === m.row && z.x < m.x + 40) damageZombie(z, 99999);
  }
  if (m.x > W + 60) m.state = 'gone';
}

function updateSun(s, dt) {
  s.t += dt;
  if (s.state === 'fall') {
    s.y += s.vy * dt;
    if (s.y >= s.targetY) { s.y = s.targetY; s.state = 'ground'; }
  } else if (s.state === 'pop') {
    s.vy += 320 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    if (s.vy > 0 && s.y >= s.targetY) { s.y = s.targetY; s.state = 'ground'; }
  } else if (s.state === 'ground') {
    s.life -= dt;
    if (s.life <= 0) s.dead = true;
  } else if (s.state === 'collect') {
    const tx = SUN_BOX.x + 40, ty = SUN_BOX.y + 32;
    const k = Math.min(1, dt * 9);
    s.x += (tx - s.x) * k;
    s.y += (ty - s.y) * k;
    if (Math.hypot(tx - s.x, ty - s.y) < 8) {
      S.sun += s.value;
      s.dead = true;
    }
  }
}

function updateFx(f, dt) {
  f.t += dt;
  if (f.kind === 'spark') {
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.vy += 300 * dt;
  } else if (f.kind === 'hat') {
    f.vy += 600 * dt;
    f.x += f.vx * dt;
    f.y += f.vy * dt;
    f.rot += 6 * dt;
    if (f.y > f.ground) { f.y = f.ground; f.vy = 0; f.vx = 0; f.rot = 1.6; }
  } else if (f.kind === 'poof') {
    f.y -= 20 * dt;
  }
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

function canvasPos(e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) * (W / r.width), y: (e.clientY - r.top) * (H / r.height) };
}

function cardAt(x, y) {
  for (let i = 0; i <= CARD_ORDER.length; i++) {
    if (inRect(x, y, { x: CARD.x + i * (CARD.w + CARD.gap), y: CARD.y, w: CARD.w, h: CARD.h })) return i;
  }
  return -1;
}

function cellAt(x, y) {
  const c = Math.floor((x - LX) / CW), r = Math.floor((y - LY) / CH);
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return null;
  return { r, c };
}

function selectCard(i) {
  if (i === CARD_ORDER.length) {
    S.selected = S.selected === 'shovel' ? null : 'shovel';
    return;
  }
  const card = S.cards[i];
  const def = PLANTS[card.key];
  if (card.cd > 0 || S.sun < def.cost) {
    card.deny = 0.3;
    return;
  }
  S.selected = S.selected === card.key ? null : card.key;
}

function tryPlant(key, r, c) {
  const card = S.cards[CARD_ORDER.indexOf(key)];
  const def = PLANTS[key];
  if (S.grid[r][c] || card.cd > 0 || S.sun < def.cost) return false;
  const p = {
    type: key, row: r, col: c, hp: def.hp, t: 0, flash: 0, recoil: 0, dead: false,
    timer: key === 'lantern' ? 7 : key === 'pinecone' ? 1.0 : 0.6, burst: 0, burstT: 0,
  };
  S.grid[r][c] = p;
  S.plants.push(p);
  S.sun -= def.cost;
  card.cd = def.cd;
  S.selected = null;
  S.fx.push({ kind: 'poof', x: cellX(c), y: rowBase(r) - 6, t: 0, dur: 0.4 });
  return true;
}

canvas.addEventListener('contextmenu', e => e.preventDefault());

canvas.addEventListener('mousemove', e => {
  S.mouse = canvasPos(e);
});

canvas.addEventListener('mousedown', e => {
  const { x, y } = canvasPos(e);
  S.mouse = { x, y };
  if (S.mode === 'title') { S.mode = 'play'; return; }
  if (S.mode === 'win' || S.mode === 'lose') {
    if (S.endT > 0.8) { newGame(); S.mode = 'play'; }
    return;
  }
  if (e.button === 2) { S.selected = null; return; }
  if (inRect(x, y, PAUSE_BTN)) { S.paused = !S.paused; return; }
  if (inRect(x, y, SPEED_BTN)) { S.speed = S.speed === 1 ? 2 : 1; return; }
  if (S.paused) { S.paused = false; return; }

  for (let i = S.suns.length - 1; i >= 0; i--) {
    const s = S.suns[i];
    if (s.state !== 'collect' && Math.hypot(s.x - x, s.y - y) < 34) {
      s.state = 'collect';
      return;
    }
  }

  const ci = cardAt(x, y);
  if (ci >= 0) { selectCard(ci); return; }

  const cell = cellAt(x, y);
  if (cell && S.selected === 'shovel') {
    const p = S.grid[cell.r][cell.c];
    if (p) {
      killPlant(p);
      S.fx.push({ kind: 'poof', x: cellX(cell.c), y: rowBase(cell.r) - 20, t: 0, dur: 0.5 });
    }
    S.selected = null;
  } else if (cell && S.selected) {
    tryPlant(S.selected, cell.r, cell.c);
  } else if (!cell) {
    S.selected = null;
  }
});

window.addEventListener('keydown', e => {
  if (S.mode === 'title' && (e.key === 'Enter' || e.key === ' ')) { S.mode = 'play'; return; }
  if (S.mode !== 'play') return;
  const n = parseInt(e.key, 10);
  if (n >= 1 && n <= CARD_ORDER.length + 1) selectCard(n - 1);
  else if (e.key === 's' || e.key === 'S') selectCard(CARD_ORDER.length);
  else if (e.key === 'Escape') S.selected = null;
  else if (e.key === 'p' || e.key === 'P' || e.key === ' ') { S.paused = !S.paused; e.preventDefault(); }
  else if (e.key === 'f' || e.key === 'F') S.speed = S.speed === 1 ? 2 : 1;
});

// ---------------------------------------------------------------------------
// Drawing helpers
// ---------------------------------------------------------------------------

function rr(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function circle(x, y, r, fill, stroke, lw) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
}

function ellipse(x, y, rx, ry, rot, fill, stroke, lw) {
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw || 2; ctx.stroke(); }
}

function line(x1, y1, x2, y2, color, lw) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function text(str, x, y, size, color, align, outline) {
  ctx.font = `bold ${size}px "Trebuchet MS", "Segoe UI", sans-serif`;
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  if (outline) {
    ctx.lineWidth = Math.max(3, size / 6);
    ctx.strokeStyle = outline;
    ctx.lineJoin = 'round';
    ctx.strokeText(str, x, y);
  }
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}

function eye(x, y, r, lookX) {
  circle(x, y, r, '#fff', '#1a1a1a', 1.2);
  circle(x + (lookX || 0) * r * 0.35, y, r * 0.5, '#1a1a1a');
}

// ---------------------------------------------------------------------------
// Plants (x, y = ground point, s = scale)
// ---------------------------------------------------------------------------

function soilMound(leaf) {
  ellipse(0, -2, 20, 7, 0, '#6a4a2a', '#432c16', 1.5);
  ellipse(-15, -6, 11, 4, -0.6, leaf, '#1f5a1b', 1.5);
  ellipse(15, -6, 11, 4, 0.6, leaf, '#1f5a1b', 1.5);
}

function drawLantern(x, y, s, t, p) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  soilMound('#3fa236');
  const sway = Math.sin(t * 1.6) * 3;
  // arching stem
  ctx.beginPath();
  ctx.moveTo(-4, -4);
  ctx.bezierCurveTo(-10, -40, -4, -74, 12 + sway, -70);
  ctx.strokeStyle = '#2f7d2a';
  ctx.lineWidth = 4.5;
  ctx.lineCap = 'round';
  ctx.stroke();
  ellipse(-12, -34, 10, 4, -0.9, '#4fb03a', '#1f5a1b', 1.5);
  ellipse(-2, -52, 9, 3.5, 0.7, '#4fb03a', '#1f5a1b', 1.5);
  // hanging lantern flower
  const lx = 14 + sway, ly = -50;
  const charge = p ? clamp(1 - p.timer / 24, 0, 1) : 0.6;
  const pulse = 0.6 + 0.4 * Math.sin(t * 3) * 0.5 + charge * 0.4;
  const glow = ctx.createRadialGradient(lx, ly, 2, lx, ly, 30);
  glow.addColorStop(0, `rgba(255,220,120,${0.55 * pulse})`);
  glow.addColorStop(1, 'rgba(255,200,80,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(lx - 30, ly - 30, 60, 60);
  line(12 + sway, -70, lx, ly - 14, '#2f7d2a', 2.5);
  ctx.beginPath();
  ctx.moveTo(lx - 12, ly - 10);
  ctx.quadraticCurveTo(lx, ly - 20, lx + 12, ly - 10);
  ctx.lineTo(lx + 10, ly + 8);
  ctx.lineTo(lx + 5, ly + 4);
  ctx.lineTo(lx, ly + 10);
  ctx.lineTo(lx - 5, ly + 4);
  ctx.lineTo(lx - 10, ly + 8);
  ctx.closePath();
  ctx.fillStyle = '#e8604a';
  ctx.fill();
  ctx.strokeStyle = '#9a2e1e';
  ctx.lineWidth = 1.5;
  ctx.stroke();
  line(lx, ly - 15, lx, ly + 8, 'rgba(120,30,20,0.5)', 1.2);
  circle(lx, ly - 1, 6 + charge * 2, `rgba(255,236,140,${0.75 + 0.25 * pulse})`);
  circle(lx, ly - 1, 3, '#fff8d8');
  ctx.restore();
}

function drawReed(x, y, s, t, p, type) {
  const pal = type === 'frost'
    ? { tube: '#b8e6f4', dark: '#4a9cbc', node: '#7cc4dc', leaf: '#6cc8e0' }
    : { tube: '#c8c25a', dark: '#7a7424', node: '#9a9234', leaf: '#3fa236' };
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  soilMound(pal.leaf);
  const recoil = p ? p.recoil * 30 : 0;
  const bob = Math.sin(t * 2.5) * 1;
  // support stalk
  line(-4, -4, -6, -34 + bob, pal.dark, 6);
  line(-4, -4, -6, -34 + bob, pal.tube, 3);
  const tubes = type === 'twin' ? [-48, -30] : [-42];
  for (const ty of tubes) {
    ctx.save();
    ctx.translate(-8 - recoil * 0.3, ty + bob);
    ctx.rotate(-0.08);
    rr(-8, -8, 44, 16, 6);
    ctx.fillStyle = pal.tube;
    ctx.fill();
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth = 2;
    ctx.stroke();
    for (const nx of [6, 22]) line(nx, -8, nx, 8, pal.node, 3);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(-4, -5, 36, 3);
    ellipse(36, 0, 4, 8, 0, pal.node, pal.dark, 2);
    ellipse(36.5, 0, 2, 5, 0, '#2a2410');
    if (type === 'frost') {
      ctx.fillStyle = '#f0fcff';
      for (const fx of [6, 22]) {
        ctx.beginPath();
        ctx.moveTo(fx - 4, -8); ctx.lineTo(fx, -16); ctx.lineTo(fx + 4, -8);
        ctx.fill();
      }
    }
    ctx.restore();
  }
  // leaf sprouting from the top tube
  ellipse(-14, -56 + bob - (type === 'twin' ? 6 : 0), 10, 4, -0.8, pal.leaf, '#1f5a1b', 1.5);
  ctx.restore();
}

function drawBriar(x, y, s, t, p) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const frac = p ? p.hp / PLANTS.briar.hp : 1;
  const leaf = frac > 0.5 ? '#2f7a2a' : frac > 0.25 ? '#5a7a2a' : '#7a6a2a';
  const leafHi = frac > 0.5 ? '#46a03a' : frac > 0.25 ? '#7a9a3a' : '#9a8a3a';
  const sway = Math.sin(t * 1.5) * 1.5;
  const blobs = [[-18, -18, 16], [16, -18, 16], [0, -24, 18], [-12, -44, 15], [12, -44, 15], [0, -60, 12]];
  const n = frac > 0.33 ? blobs.length : blobs.length - 1;
  for (let i = 0; i < n; i++) {
    const [bx, by, br] = blobs[i];
    circle(bx + sway * (by / -60), by, br, leaf, '#173a14', 2);
  }
  for (let i = 0; i < n; i++) {
    const [bx, by, br] = blobs[i];
    circle(bx + sway * (by / -60) - br * 0.3, by - br * 0.3, br * 0.45, leafHi);
  }
  // thorny vines
  ctx.strokeStyle = '#5a3418';
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-26, -10); ctx.quadraticCurveTo(-4, -36, 22, -30);
  ctx.moveTo(-20, -50); ctx.quadraticCurveTo(4, -30, 24, -52);
  ctx.stroke();
  ctx.fillStyle = '#e8dcc0';
  for (const [tx, ty, a] of [[-18, -18, -2.2], [-4, -27, -1.4], [12, -30, -1.8], [-12, -44, -1.2], [6, -40, -2.0], [18, -48, -0.9]]) {
    ctx.beginPath();
    ctx.moveTo(tx - 2.5, ty);
    ctx.lineTo(tx + Math.cos(a) * 7, ty + Math.sin(a) * 7);
    ctx.lineTo(tx + 2.5, ty);
    ctx.fill();
  }
  if (frac > 0.5) for (const [bx, by] of [[-6, -54], [14, -24], [-20, -32]]) circle(bx, by, 3, '#c8304a');
  ctx.restore();
}

function drawPinecone(x, y, s, t, p) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  const fuse = p ? 1 - clamp(p.timer, 0, 1) : 0;
  const pulse = 1 + fuse * 0.3 + (p ? Math.sin(t * 30) * fuse * 0.05 : 0);
  ctx.translate(0, -28);
  ctx.scale(pulse, pulse);
  ellipse(0, 0, 18, 26, 0, '#7a4a22', '#3a200c', 2);
  const hot = fuse > 0.5 && Math.floor(t * 12) % 2;
  for (let row = -3; row <= 3; row++) {
    const ry = row * 7;
    const half = Math.sqrt(Math.max(0, 1 - (ry / 26) ** 2)) * 16;
    for (let sx = -half + 4; sx <= half - 2; sx += 8) {
      const ox = row % 2 ? 4 : 0;
      ctx.beginPath();
      ctx.moveTo(sx + ox - 4, ry - 2);
      ctx.quadraticCurveTo(sx + ox, ry + 6, sx + ox + 4, ry - 2);
      ctx.fillStyle = hot ? '#e85a2a' : '#a86a32';
      ctx.fill();
      ctx.strokeStyle = '#4a2a10';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
  // fuse
  ctx.beginPath();
  ctx.moveTo(0, -25);
  ctx.quadraticCurveTo(8, -34, 4, -40);
  ctx.strokeStyle = '#d8c8a0';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  const sp = 3 + Math.abs(Math.sin(t * 20)) * 3;
  circle(4, -41, sp + 2, 'rgba(255,180,40,0.5)');
  circle(4, -41, sp * 0.6, '#fff4a0');
  ctx.restore();
}

const PLANT_DRAW = {
  lantern: drawLantern, reed: drawReed, frost: drawReed,
  twin: drawReed, briar: drawBriar, pinecone: drawPinecone,
};

function drawPlant(type, x, y, s, t, p) {
  PLANT_DRAW[type](x, y, s, t, p, type);
}

// ---------------------------------------------------------------------------
// Shamblers (zombies)
// ---------------------------------------------------------------------------

function drawHat(type, armorFrac) {
  if (type === 'pot') {
    // dented saucepan worn upside down, handle sticking out the back
    line(8, -104, 30, -110, '#3a3a40', 5);
    ctx.beginPath();
    ctx.moveTo(-21, -96);
    ctx.lineTo(-19, -116);
    ctx.quadraticCurveTo(-4, -122, 11, -116);
    ctx.lineTo(13, -96);
    ctx.closePath();
    ctx.fillStyle = armorFrac < 0.4 ? '#7a6a5a' : '#9a8a7a';
    ctx.fill();
    ctx.strokeStyle = '#3a3028';
    ctx.lineWidth = 2;
    ctx.stroke();
    ellipse(-4, -96, 19, 4, 0, '#6a5a4a', '#3a3028', 1.5);
    ellipse(-12, -110, 3, 4, 0, 'rgba(255,255,255,0.3)');
    if (armorFrac < 0.6) circle(2, -108, 3, '#5a4a3a');
  } else if (type === 'helm') {
    // riveted iron helmet with a visor slit
    ctx.beginPath();
    ctx.moveTo(-22, -84);
    ctx.lineTo(-22, -104);
    ctx.quadraticCurveTo(-4, -128, 14, -104);
    ctx.lineTo(14, -84);
    ctx.closePath();
    ctx.fillStyle = armorFrac < 0.4 ? '#6a7078' : '#8a929c';
    ctx.fill();
    ctx.strokeStyle = '#2e3238';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#1a1c20';
    ctx.fillRect(-21, -100, 22, 4);
    line(-4, -122, -4, -102, '#5a6068', 3);
    for (const [rx, ry] of [[-18, -90], [10, -90], [-18, -106], [10, -106]]) circle(rx, ry, 1.8, '#c8ccd0');
    if (armorFrac < 0.66) line(4, -116, 10, -106, '#2e3238', 1.5);
    if (armorFrac < 0.33) line(-16, -94, -10, -86, '#2e3238', 1.5);
  }
}

function drawZombie(z) {
  const x = z.x, y = rowBase(z.row) + 6;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(ZOMBIE_SCALE, ZOMBIE_SCALE);

  if (z.dead) {
    const k = clamp(z.deathT / 1.2, 0, 1);
    ctx.globalAlpha = 1 - k * k;
    if (!z.burnt) ctx.rotate(Math.min(1, z.deathT * 2.5) * 1.4);
  }

  if (z.burnt) {
    ctx.fillStyle = '#1a1410';
    ellipse(0, -52, 16, 50, 0, '#1a1410');
    circle(-4, -96, 14, '#1a1410');
    circle(-8, -98, 2.5, '#ff7a30');
    circle(0, -98, 2.5, '#ff7a30');
    ctx.restore();
    return;
  }

  const frozen = z.slow > 0;
  const skin = z.flash > 0 ? '#eef4e4' : frozen ? '#a4cce0' : '#a8b894';
  const skinDark = frozen ? '#6a98b0' : '#6a7a5a';
  const cloak = { basic: '#5a4a6a', pot: '#4a5a4a', helm: '#5a4438', runner: '#7a3a2e', herald: '#3a4a6a' }[z.type];
  const cloakDark = 'rgba(0,0,0,0.35)';
  const walk = z.eating || z.dead ? 0 : Math.sin(z.phase);
  const chew = z.eating ? Math.sin(S.time * 14) : 0;
  const lean = z.type === 'runner' ? -0.28 : -0.16;

  // bony legs with wrapped shins
  line(-4, -38, -4 + walk * 9, -2, skinDark, 5);
  line(4, -38, 4 - walk * 9, -2, skinDark, 5);
  line(-4 + walk * 4.5, -20, -4 + walk * 8, -6, '#c8b890', 6);
  line(4 - walk * 4.5, -20, 4 - walk * 8, -6, '#b8a880', 6);
  ellipse(-7 + walk * 9, 0, 6, 3, 0, skinDark);
  ellipse(1 - walk * 9, 0, 6, 3, 0, skinDark);

  ctx.save();
  ctx.translate(0, -38);
  ctx.rotate(lean + walk * 0.03);
  ctx.translate(0, 38);

  // back arm
  line(4, -74, -22, -66 + chew * 5, skinDark, 5);

  // herald carries a hand bell on a crooked stick
  if (z.type === 'herald') {
    const ring = Math.sin(S.time * 10) * 0.35;
    line(10, -70, 18, -130, '#5a3a1a', 3);
    ctx.save();
    ctx.translate(18, -130);
    ctx.rotate(ring);
    ctx.beginPath();
    ctx.moveTo(-9, 16);
    ctx.quadraticCurveTo(-8, 0, 0, 0);
    ctx.quadraticCurveTo(8, 0, 9, 16);
    ctx.closePath();
    ctx.fillStyle = '#d8a83a';
    ctx.fill();
    ctx.strokeStyle = '#7a5a10';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    circle(0, 18, 3, '#7a5a10');
    ctx.restore();
  }

  // hooded, tattered cloak
  ctx.beginPath();
  ctx.moveTo(-12, -92);
  ctx.quadraticCurveTo(2, -100, 16, -88);
  ctx.lineTo(20, -40);
  ctx.lineTo(13, -34);
  ctx.lineTo(9, -42);
  ctx.lineTo(3, -32);
  ctx.lineTo(-3, -42);
  ctx.lineTo(-9, -34);
  ctx.lineTo(-16, -44);
  ctx.closePath();
  ctx.fillStyle = cloak;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  line(6, -86, 10, -46, cloakDark, 2);
  line(-4, -80, -6, -48, cloakDark, 2);
  rr(-10, -62, 26, 5, 2);
  ctx.fillStyle = '#3a2a1a';
  ctx.fill();

  // front arm reaching forward, long fingers
  const hx = -34, hyHand = -70 + chew * 6;
  line(-6, -78, hx, hyHand, skin, 6);
  line(hx, hyHand, hx - 7, hyHand - 3, skin, 2.5);
  line(hx, hyHand, hx - 8, hyHand + 1, skin, 2.5);
  line(hx, hyHand, hx - 6, hyHand + 5, skin, 2.5);

  // head: long gaunt skull with glowing eyes
  const hy = -100 + (z.eating ? chew * 1.5 : walk * 1.5);
  ellipse(-4, hy, 12, 15, -0.15, skin, skinDark, 2);
  ellipse(-10, hy - 2, 4, 3.5, 0, '#2a2a30');
  ellipse(-1, hy - 3, 3.5, 3, 0, '#2a2a30');
  circle(-10, hy - 2, 1.8, frozen ? '#e8fcff' : '#f0e05a');
  circle(-1, hy - 3, 1.5, frozen ? '#e8fcff' : '#f0e05a');
  line(-7, hy + 2, -9, hy + 5, skinDark, 1.5);
  const jaw = z.eating ? (chew + 1) * 2.5 : 1;
  ctx.fillStyle = '#2a1e1e';
  rr(-14, hy + 7, 11, 2 + jaw, 1.5);
  ctx.fill();
  ctx.strokeStyle = '#d8d0b0';
  ctx.lineWidth = 1;
  for (let tx = -13; tx < -4; tx += 3) {
    ctx.beginPath();
    ctx.moveTo(tx, hy + 7);
    ctx.lineTo(tx, hy + 9 + jaw);
    ctx.stroke();
  }

  // hood draped behind the head (hidden when wearing armor)
  if (z.armor <= 0) {
    ctx.beginPath();
    ctx.moveTo(-2, hy - 16);
    ctx.quadraticCurveTo(14, hy - 18, 14, hy + 4);
    ctx.lineTo(16, -86);
    ctx.lineTo(4, -90);
    ctx.quadraticCurveTo(8, hy, -2, hy - 16);
    ctx.fillStyle = cloak;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  if (z.type === 'runner') {
    line(-16, hy - 8, 8, hy - 10, '#e8c040', 4);
    line(8, hy - 10, 18, hy - 4 + walk * 3, '#e8c040', 3);
  }

  if (z.armor > 0) {
    ctx.save();
    ctx.translate(0, hy + 98);
    drawHat(z.type, z.armor / z.maxArmor);
    ctx.restore();
  }

  ctx.restore();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Scene
// ---------------------------------------------------------------------------

function drawBackground() {
  // house porch
  const g = ctx.createLinearGradient(0, 0, LX, 0);
  g.addColorStop(0, '#6a4a32');
  g.addColorStop(1, '#8a6444');
  ctx.fillStyle = g;
  ctx.fillRect(0, 100, LX, H - 100);
  for (let yy = 100; yy < H; yy += 24) line(0, yy, LX - 6, yy, 'rgba(0,0,0,0.2)', 1.5);
  ctx.fillStyle = '#4e3622';
  ctx.fillRect(LX - 8, 100, 8, H - 100);

  // lawn
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      ctx.fillStyle = (r + c) % 2 ? '#5aa83d' : '#67b847';
      ctx.fillRect(LX + c * CW, LY + r * CH, CW, CH);
    }
  }
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  for (let r = 0; r < ROWS; r += 2) ctx.fillRect(LX, LY + r * CH, COLS * CW, CH);

  // street
  ctx.fillStyle = '#b0a890';
  ctx.fillRect(LAWN_R, 100, 20, H - 100);
  ctx.fillStyle = '#5c5c62';
  ctx.fillRect(LAWN_R + 20, 100, W - LAWN_R - 20, H - 100);
  for (let yy = 110; yy < H; yy += 50) {
    ctx.fillStyle = '#d8d0a0';
    ctx.fillRect(W - 50, yy, 6, 26);
  }

  // hedges
  ctx.fillStyle = '#2f6a26';
  ctx.fillRect(LX, 100, COLS * CW, LY - 100);
  ctx.fillRect(LX, LY + ROWS * CH, COLS * CW, H - LY - ROWS * CH);
  for (let xx = LX + 10; xx < LAWN_R; xx += 22) {
    circle(xx, 104, 8, '#3a7d2e');
    circle(xx + 8, H - 2, 8, '#3a7d2e');
  }
}

function drawMower(m) {
  if (m.state === 'gone') return;
  const y = rowBase(m.row) - 6;
  ctx.save();
  ctx.translate(m.x, y);
  if (m.state === 'go') ctx.rotate(-0.08 + Math.sin(S.time * 40) * 0.03);
  // wheelbarrow: handles trail left, wheel leads right
  line(-26, -20, -8, -14, '#7a4a22', 3);
  line(-26, -14, -8, -10, '#7a4a22', 3);
  line(-6, -8, -10, 2, '#4a4a4a', 2.5);
  ctx.beginPath();
  ctx.moveTo(-12, -24);
  ctx.lineTo(18, -24);
  ctx.lineTo(10, -6);
  ctx.lineTo(-6, -6);
  ctx.closePath();
  ctx.fillStyle = '#2e7a8a';
  ctx.fill();
  ctx.strokeStyle = '#123a44';
  ctx.lineWidth = 2;
  ctx.stroke();
  line(-10, -21, 15, -21, 'rgba(255,255,255,0.3)', 2);
  const spin = m.state === 'go' ? S.time * 20 : 0;
  circle(12, -2, 7, '#2a2a2a', '#9a9a9a', 2);
  line(12 + Math.cos(spin) * 5, -2 + Math.sin(spin) * 5, 12 - Math.cos(spin) * 5, -2 - Math.sin(spin) * 5, '#9a9a9a', 1.5);
  ctx.restore();
}

function drawSun(s) {
  let alpha = 1;
  if (s.state === 'ground' && s.life < 2) alpha = 0.4 + 0.6 * Math.abs(Math.sin(s.life * 8));
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(s.x, s.y);
  ctx.rotate(s.t * 0.8);
  const r = 22;
  const glow = ctx.createRadialGradient(0, 0, 4, 0, 0, r + 12);
  glow.addColorStop(0, 'rgba(255,240,140,0.9)');
  glow.addColorStop(1, 'rgba(255,200,40,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(-r - 12, -r - 12, (r + 12) * 2, (r + 12) * 2);
  ctx.fillStyle = '#ffd83a';
  for (let i = 0; i < 8; i++) {
    ctx.save();
    ctx.rotate(i * Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(-5, -14);
    ctx.lineTo(0, -r - 4);
    ctx.lineTo(5, -14);
    ctx.fill();
    ctx.restore();
  }
  circle(0, 0, 15, '#ffe25a', '#f0a818', 2);
  ctx.restore();
}

function drawShot(s) {
  if (s.frost) {
    circle(s.x, s.y, 8, 'rgba(200,240,255,0.4)');
    circle(s.x, s.y, 6, '#c8f2ff', '#5ab0d0', 1.5);
  } else {
    ellipse(s.x, s.y, 8, 5.5, 0, '#d8a040', '#7a4a10', 1.5);
  }
  circle(s.x - 2, s.y - 2, 2, 'rgba(255,255,255,0.7)');
}

function drawFx(f) {
  const k = f.t / f.dur;
  ctx.save();
  if (f.kind === 'spark') {
    ctx.globalAlpha = 1 - k;
    circle(f.x, f.y, 3, f.color);
  } else if (f.kind === 'boom') {
    ctx.globalAlpha = 1 - k;
    circle(f.x, f.y, 30 + k * 110, '#ffcf40');
    circle(f.x, f.y, 20 + k * 80, '#ff7a20');
    circle(f.x, f.y, 10 + k * 40, '#fff3c0');
    if (k < 0.6) text('KABLAM!', f.x, f.y - 10 - k * 30, 30, '#fff', 'center', '#a02010');
  } else if (f.kind === 'poof') {
    ctx.globalAlpha = 0.7 * (1 - k);
    for (let i = 0; i < 5; i++) {
      const a = i * Math.PI * 0.4;
      circle(f.x + Math.cos(a) * k * 26, f.y + Math.sin(a) * k * 10, 8 + k * 6, '#d8d0b8');
    }
  } else if (f.kind === 'hat') {
    ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
    ctx.translate(f.x, f.y);
    ctx.rotate(f.rot);
    ctx.scale(ZOMBIE_SCALE, ZOMBIE_SCALE);
    ctx.translate(6, 110);
    drawHat(f.hat, 0.3);
  }
  ctx.restore();
}

function drawWorld() {
  drawBackground();

  // placement preview
  const cell = cellAt(S.mouse.x, S.mouse.y);
  if (S.mode === 'play' && cell && S.selected) {
    const free = !S.grid[cell.r][cell.c];
    if (S.selected === 'shovel') {
      if (!free) {
        ctx.fillStyle = 'rgba(255,80,60,0.25)';
        ctx.fillRect(LX + cell.c * CW, LY + cell.r * CH, CW, CH);
      }
    } else {
      ctx.fillStyle = free ? 'rgba(255,255,255,0.18)' : 'rgba(255,60,60,0.2)';
      ctx.fillRect(LX + cell.c * CW, LY + cell.r * CH, CW, CH);
      if (free) {
        ctx.save();
        ctx.globalAlpha = 0.45;
        drawPlant(S.selected, cellX(cell.c), rowBase(cell.r), 1, S.time, null);
        ctx.restore();
      }
    }
  }

  for (let r = 0; r < ROWS; r++) {
    drawMower(S.mowers[r]);
    for (const p of S.plants) {
      if (p.row !== r) continue;
      const jitter = p.flash > 0 ? Math.sin(S.time * 60) * 1.5 : 0;
      drawPlant(p.type, cellX(p.col) + jitter, rowBase(r), 1, p.t, p);
    }
    const row = S.zombies.filter(z => z.row === r).sort((a, b) => b.x - a.x);
    for (const z of row) drawZombie(z);
  }
  for (const s of S.shots) drawShot(s);
  for (const f of S.fx) drawFx(f);
}

function drawShovel(x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.rotate(0.6);
  line(0, -40, 0, 6, '#8a5a2a', 6);
  line(-8, -42, 8, -42, '#8a5a2a', 6);
  ctx.beginPath();
  ctx.moveTo(-11, 4);
  ctx.lineTo(11, 4);
  ctx.lineTo(9, 22);
  ctx.quadraticCurveTo(0, 34, -9, 22);
  ctx.closePath();
  ctx.fillStyle = '#b8c0c8';
  ctx.fill();
  ctx.strokeStyle = '#5a6068';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function drawButton(b, label, active) {
  rr(b.x, b.y, b.w, b.h, 8);
  ctx.fillStyle = active ? '#e8b84a' : '#c89a5a';
  ctx.fill();
  ctx.strokeStyle = '#4a2e14';
  ctx.lineWidth = 2;
  ctx.stroke();
  text(label, b.x + b.w / 2, b.y + b.h / 2 + 1, 16, '#3a2210');
}

function drawTopBar() {
  const g = ctx.createLinearGradient(0, 0, 0, 100);
  g.addColorStop(0, '#7a5232');
  g.addColorStop(1, '#5a3a20');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, 100);
  line(0, 99, W, 99, '#3a2410', 3);

  // sun counter
  rr(SUN_BOX.x, SUN_BOX.y, SUN_BOX.w, SUN_BOX.h, 10);
  ctx.fillStyle = '#4a2e18';
  ctx.fill();
  drawSun({ x: SUN_BOX.x + 40, y: SUN_BOX.y + 32, t: S.time, state: 'ui' });
  rr(SUN_BOX.x + 8, SUN_BOX.y + 58, SUN_BOX.w - 16, 22, 6);
  ctx.fillStyle = '#f4ecd0';
  ctx.fill();
  text(String(S.sun), SUN_BOX.x + 40, SUN_BOX.y + 70, 17, '#3a2210');

  // seed cards
  let hovered = -1;
  for (let i = 0; i <= CARD_ORDER.length; i++) {
    const card = S.cards[i];
    const shake = card && card.deny > 0 ? Math.sin(card.deny * 60) * 3 : 0;
    const x = CARD.x + i * (CARD.w + CARD.gap) + shake, y = CARD.y;
    const selected = card ? S.selected === card.key : S.selected === 'shovel';
    if (inRect(S.mouse.x, S.mouse.y, { x, y, w: CARD.w, h: CARD.h })) hovered = i;

    rr(x, y + (selected ? -2 : 0), CARD.w, CARD.h, 8);
    ctx.fillStyle = card ? '#e8dcae' : '#8aa0b0';
    ctx.fill();
    ctx.strokeStyle = selected ? '#fff36a' : '#4a3018';
    ctx.lineWidth = selected ? 4 : 2;
    ctx.stroke();

    if (!card) {
      drawShovel(x + CARD.w / 2, y + 40, 0.9);
      text('S', x + CARD.w - 10, y + 12, 11, '#2a3a44');
      continue;
    }
    const def = PLANTS[card.key];
    ctx.save();
    rr(x + 4, y + 4, CARD.w - 8, 56, 6);
    ctx.fillStyle = '#8fc86a';
    ctx.fill();
    ctx.clip();
    const iconY = card.key === 'briar' ? y + 60 : y + 58;
    drawPlant(card.key, x + CARD.w / 2 - (false ? 4 : 0), iconY, card.key === 'briar' ? 0.62 : 0.68, S.time, null);
    ctx.restore();
    text(String(def.cost), x + CARD.w / 2, y + 72, 15, '#3a2210');
    text(String(i + 1), x + 10, y + 12, 11, '#2a3a1a');

    const unaffordable = S.sun < def.cost;
    if (unaffordable || card.cd > 0) {
      rr(x, y, CARD.w, CARD.h, 8);
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fill();
    }
    if (card.cd > 0) {
      const frac = card.cd / def.cd;
      ctx.fillStyle = 'rgba(0,0,0,0.4)';
      ctx.fillRect(x, y, CARD.w, CARD.h * frac);
    }
  }

  // progress
  const waveLabel = S.waveIndex >= TOTAL_WAVES ? 'Final wave'
    : S.waveIndex === 0 ? `Shamblers in ${Math.ceil(S.nextWaveAt - S.time)}s`
    : `Wave ${S.waveIndex} / ${TOTAL_WAVES}`;
  text(waveLabel,
    PROGRESS.x + PROGRESS.w / 2, PROGRESS.y - 10, 13, '#f4ecd0');
  rr(PROGRESS.x, PROGRESS.y, PROGRESS.w, PROGRESS.h, 8);
  ctx.fillStyle = '#2a1a0c';
  ctx.fill();
  const frac = S.waveIndex / TOTAL_WAVES;
  if (frac > 0) {
    rr(PROGRESS.x + PROGRESS.w * (1 - frac), PROGRESS.y, PROGRESS.w * frac, PROGRESS.h, 8);
    ctx.fillStyle = '#7ad04a';
    ctx.fill();
  }
  for (const fw of FLAG_WAVES) {
    const fx = PROGRESS.x + PROGRESS.w * (1 - (fw + 1) / TOTAL_WAVES) + 4;
    line(fx, PROGRESS.y - 2, fx, PROGRESS.y + PROGRESS.h + 2, '#3a2a1a', 2);
    ctx.fillStyle = S.waveIndex > fw ? '#7a7a7a' : '#d83a2a';
    ctx.fillRect(fx, PROGRESS.y - 2, 9, 7);
  }
  const hx = PROGRESS.x + PROGRESS.w * (1 - frac);
  circle(hx, PROGRESS.y + PROGRESS.h / 2, 9, '#9fb488', '#4a5a3a', 2);
  circle(hx - 3, PROGRESS.y + PROGRESS.h / 2 - 1, 2, '#fff');
  text(S.speed === 2 ? 'Speed: 2x (F)' : 'Speed: 1x (F)', PROGRESS.x + PROGRESS.w / 2, PROGRESS.y + 34, 11, '#d8c8a0');
  text('Pause: P   Cancel: Esc', PROGRESS.x + PROGRESS.w / 2, PROGRESS.y + 52, 11, '#d8c8a0');

  drawButton(PAUSE_BTN, S.paused ? '▶' : 'II', S.paused);
  drawButton(SPEED_BTN, S.speed === 2 ? '2x' : '1x', S.speed === 2);

  // tooltip
  if (hovered >= 0 && S.mode === 'play') {
    const label = hovered < CARD_ORDER.length
      ? `${PLANTS[CARD_ORDER[hovered]].name} - ${PLANTS[CARD_ORDER[hovered]].desc}`
      : 'Shovel - dig up a plant';
    ctx.font = 'bold 13px "Trebuchet MS", sans-serif';
    const w = ctx.measureText(label).width + 16;
    const tx = clamp(CARD.x + hovered * (CARD.w + CARD.gap) + CARD.w / 2 - w / 2, 4, W - w - 4);
    rr(tx, 104, w, 24, 6);
    ctx.fillStyle = 'rgba(30,20,10,0.85)';
    ctx.fill();
    text(label, tx + w / 2, 116, 13, '#fff4d0');
  }
}

function drawOverlay(title, sub, color) {
  ctx.fillStyle = 'rgba(10,14,8,0.6)';
  ctx.fillRect(0, 0, W, H);
  text(title, W / 2, H / 2 - 30, 52, color, 'center', '#1a1008');
  if (sub) text(sub, W / 2, H / 2 + 30, 20, '#f4ecd0', 'center', '#1a1008');
}

function drawTitle() {
  ctx.fillStyle = 'rgba(10,14,8,0.65)';
  ctx.fillRect(0, 0, W, H);
  text('GARDEN SIEGE', W / 2, 150, 68, '#9be45a', 'center', '#1a3010');
  text('Plant a defense. Hold the lawn. Save the house.', W / 2, 205, 20, '#f4ecd0', 'center', '#1a1008');
  const t = performance.now() / 1000;
  const names = CARD_ORDER;
  names.forEach((k, i) => {
    const x = W / 2 - 250 + i * 100;
    drawPlant(k, x, 330, 1, t + i, null);
    text(PLANTS[k].name, x, 350, 13, '#f4ecd0', 'center', '#1a1008');
  });
  const lines = [
    'Click falling sun to collect it. Pick a seed card (or press 1-6), then click the lawn to plant.',
    'Shovel (S) digs up plants. Each lane has one wheelbarrow as a last line of defense.',
    'Survive 12 waves of shamblers to win.',
  ];
  lines.forEach((l, i) => text(l, W / 2, 410 + i * 26, 15, '#e8dcb8', 'center', '#1a1008'));
  if (Math.floor(t * 2) % 2) text('Click to start', W / 2, 520, 28, '#ffd84a', 'center', '#3a2008');
}

function render() {
  ctx.save();
  if (S.shake > 0) ctx.translate(rand(-6, 6) * S.shake * 3, rand(-6, 6) * S.shake * 3);
  drawWorld();
  for (const s of S.suns) drawSun(s);
  ctx.restore();
  drawTopBar();

  if (S.banner) {
    const b = S.banner;
    const a = Math.min(1, b.t * 4, (b.dur - b.t) * 3);
    ctx.save();
    ctx.globalAlpha = clamp(a, 0, 1);
    text(b.text, W / 2, LY + ROWS * CH / 2, 44, b.color, 'center', '#3a0a04');
    ctx.restore();
  }

  if (S.mode === 'title') drawTitle();
  else if (S.mode === 'lose') drawOverlay('THE HORDE GOT IN!', S.endT > 0.8 ? 'Click to try again' : '', '#ff6a4a');
  else if (S.mode === 'win') drawOverlay('GARDEN SAVED!', S.endT > 0.8 ? 'Click to play again' : '', '#9be45a');
  else if (S.paused) drawOverlay('PAUSED', 'Click or press P to resume', '#ffd84a');
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (S.mode === 'play' && !S.paused) {
    for (let i = 0; i < S.speed; i++) update(dt);
  } else if (S.mode === 'win' || S.mode === 'lose') {
    S.endT += dt;
    for (const f of S.fx) updateFx(f, dt);
  }
  render();
  requestAnimationFrame(frame);
}

newGame();
requestAnimationFrame(frame);
