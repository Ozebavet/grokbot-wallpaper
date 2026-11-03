// Picks what an idle bot does next. Seeded by the caller (bot name) so the same bot keeps a
// stable favourite and tempo; claims keep two bots off the same spot.
import { idleActivitiesEnabled } from './idle-config.js';

export const IDLE_KINDS = ['pace', 'window', 'stretch', 'coffee', 'lean', 'sofa', 'wander'];

const LIST = {
  pace: 'path', window: 'window', stretch: 'stretch', coffee: 'coffee', lean: 'wall', sofa: 'sofas', wander: 'corridor',
};

export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SOCIAL = new Set(['sofa', 'coffee', 'window', 'lean']);

export function createIdleDirector(idleSpots, config) {
  const claims = new Map();
  const byBot = new Map();
  const places = new Map();
  return {
    config,
    spots: idleSpots || emptySpots(),
    enabled: idleActivitiesEnabled(config),
    blocked: () => false,
    heldBy(key) { return claims.get(key) || null; },
    claim(botId, key, pos) {
      if (!key) return false;
      const owner = claims.get(key);
      if (owner && owner !== botId) return false;
      const prev = byBot.get(botId);
      if (prev && prev !== key && claims.get(prev) === botId) claims.delete(prev);
      claims.set(key, botId);
      byBot.set(botId, key);
      if (pos) places.set(botId, { x: pos.x, z: pos.z });
      else places.delete(botId);
      return true;
    },
    release(botId) {
      const prev = byBot.get(botId);
      if (prev && claims.get(prev) === botId) claims.delete(prev);
      byBot.delete(botId);
      places.delete(botId);
    },
    // 2 when another idle bot is already settled within chat range, -1 when this spot is too close, else 0.
    hasCompany() { return places.size > 0; },
    nearCompany(pos, selfId) {
      const sep = config.separation || 0.9;
      const range = config.chat?.range ?? 2.7;
      let best = Infinity;
      for (const [id, p] of places) {
        if (id === selfId || !p) continue;
        const d = Math.hypot(pos.x - p.x, pos.z - p.z);
        if (d < best) best = d;
      }
      if (!Number.isFinite(best)) return 0;
      if (best < sep) return -1;
      return best <= range ? 2 : 0;
    },
    count(prefix) {
      const p = `${prefix}:`;
      let n = 0;
      for (const k of claims.keys()) if (k.startsWith(p)) n++;
      return n;
    },
  };
}

export function emptySpots() {
  return { path: [], window: [], wall: [], coffee: [], corridor: [], stretch: [], sofas: [] };
}

function listFor(director, kind) {
  return director.spots[LIST[kind]] || [];
}

function routeOk(director, kind) {
  return listFor(director, kind).length >= 2;
}

function usableKinds(director) {
  const cfg = director.config;
  return IDLE_KINDS.filter((k) => {
    const spec = cfg.activities[k];
    if (!spec?.enabled || spec.weight <= 0) return false;
    if (k === 'pace' || k === 'wander') return routeOk(director, k);
    return listFor(director, k).length > 0;
  });
}

function weightOf(kind, actor, director) {
  const cfg = director.config;
  const spec = cfg.activities[kind];
  let w = spec.weight;
  if (kind === actor.favorite) w *= cfg.favoriteBoost || 1;
  if (cfg.chat?.enabled && SOCIAL.has(kind)) w *= cfg.chat.gather || 1;
  const text = `${actor.name || ''} ${actor.group || ''} ${actor.id || ''}`;
  for (const b of cfg.roleBias || []) {
    if (b.activity === kind && b.match.test(text)) w *= b.mul;
  }
  return w / (1 + director.count(kind) * 0.9);
}

function pickWeighted(items, weights, rng) {
  let sum = 0;
  for (const w of weights) sum += Math.max(0, w);
  if (sum <= 0) return null;
  let r = rng() * sum;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

function shuffle(n, rng) {
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

function reserveRoute(kind, actor, director, rng) {
  const path = listFor(director, kind);
  if (path.length < 2) return null;
  const lanes = Math.min(2, Math.max(1, Math.floor(path.length / 4)));
  const free = [];
  for (let i = 0; i < lanes; i++) {
    const owner = director.heldBy(`${kind}:${i}`);
    if (!owner || owner === actor.id) free.push(i);
  }
  if (!free.length) return null;
  const lane = free[Math.floor(rng() * free.length)];
  const key = `${kind}:${lane}`;
  const index = (Math.floor((path.length * lane) / lanes) + Math.floor(rng() * 2)) % path.length;
  if (!director.claim(actor.id, key)) return null;
  return { kind, key, path, index, spot: path[index], speed: kind === 'wander' ? 0.62 : 1.02 };
}

function reservePoint(kind, actor, director, rng) {
  const list = listFor(director, kind);
  const sep = director.config.separation || 0.9;
  const social = !!(director.config.chat?.enabled && SOCIAL.has(kind));
  const candidates = [];
  for (const i of shuffle(list.length, rng)) {
    const spot = list[i];
    const key = spot.id || `${kind}:${i}`;
    const owner = director.heldBy(key);
    if (owner && owner !== actor.id) continue;
    if (director.blocked(spot.pos, sep, actor.id)) continue;
    const company = social ? director.nearCompany(spot.pos, actor.id) : 0;
    if (company < 0) continue;
    candidates.push({ spot, key, company });
  }
  if (!candidates.length) return null;
  const best = candidates.reduce((m, c) => Math.max(m, c.company), 0);
  const top = candidates.filter((c) => c.company === best);
  const pick = top[Math.floor(rng() * top.length)];
  if (!director.claim(actor.id, pick.key, social ? pick.spot.pos : null)) return null;
  return { kind, key: pick.key, spot: pick.spot, speed: 0.85 };
}

function openSocial(kind, actor, director) {
  const list = listFor(director, kind);
  const sep = director.config.separation || 0.9;
  const out = [];
  for (let i = 0; i < list.length; i++) {
    const spot = list[i];
    const key = spot.id || `${kind}:${i}`;
    const owner = director.heldBy(key);
    if (owner && owner !== actor.id) continue;
    if (director.blocked(spot.pos, sep, actor.id)) continue;
    out.push({ kind, key, spot, company: director.nearCompany(spot.pos, actor.id) });
  }
  return out.filter((s) => s.company >= 0);
}

// Sit or stand next to an idle bot who is already at a sofa, the coffee bar, or a window.
function tryJoin(actor, director, rng) {
  const pool = [];
  for (const kind of ['sofa', 'coffee', 'window', 'lean']) {
    if (!usableKinds(director).includes(kind)) continue;
    for (const spot of openSocial(kind, actor, director)) if (spot.company > 0) pool.push(spot);
  }
  if (!pool.length) return null;
  const pick = pool[Math.floor(rng() * pool.length)];
  if (!director.claim(actor.id, pick.key, pick.spot.pos)) return null;
  return { kind: pick.kind, key: pick.key, spot: pick.spot, speed: 0.85 };
}

// The first idle bot picks a place other people can walk up to.
function hostGathering(actor, director, rng) {
  const order = rng() < 0.6 ? ['sofa', 'coffee', 'window', 'lean'] : ['coffee', 'window', 'sofa', 'lean'];
  for (const kind of order) {
    if (!usableKinds(director).includes(kind)) continue;
    const choice = reservePoint(kind, actor, director, rng);
    if (choice) return choice;
  }
  return null;
}

// actor: { id, name, group, favorite }. previous: last activity kind, or null.
// Returns { kind, key, spot, path?, index?, speed } or null when nothing is free.
export function chooseIdleActivity(actor, director, rng, previous) {
  if (director.config.chat?.enabled && rng() < (director.hasCompany() ? 0.84 : 0.72)) {
    const grouped = director.hasCompany() ? tryJoin(actor, director, rng) : hostGathering(actor, director, rng);
    if (grouped) return grouped;
  }
  const kinds = usableKinds(director);
  if (!kinds.length) return null;
  const weights = kinds.map((k) => weightOf(k, actor, director));
  for (let attempt = 0; attempt < 8; attempt++) {
    const kind = pickWeighted(kinds, weights, rng);
    if (!kind) return null;
    const idx = kinds.indexOf(kind);
    if (attempt === 0 && kind === previous && kinds.length > 1 && rng() < 0.7) {
      weights[idx] *= 0.15;
      continue;
    }
    const choice = (kind === 'pace' || kind === 'wander')
      ? reserveRoute(kind, actor, director, rng)
      : reservePoint(kind, actor, director, rng);
    if (choice) return choice;
    weights[idx] = 0;
  }
  return null;
}

export function enabledActivityList(cfg) {
  return IDLE_KINDS.filter((k) => cfg.activities[k]?.enabled && cfg.activities[k].weight > 0);
}

// A point beside `around` that is not inside a desk or the lounge, preferring behind them.
export function openStandPoint(x, z, yaw = 0, dist = 1.05) {
  const angles = [yaw + Math.PI, yaw + Math.PI / 2, yaw - Math.PI / 2, yaw + 2.3, yaw - 2.3, yaw];
  for (const ang of angles) {
    const px = x + Math.sin(ang) * dist;
    const pz = z + Math.cos(ang) * dist;
    if (px < -7.6 || px > 7.9 || pz < -5.45 || pz > 5.5) continue;
    if (insideBlock(px, pz)) continue;
    return { x: px, z: pz };
  }
  return { x: x + Math.sin(yaw + Math.PI) * dist, z: z + Math.cos(yaw + Math.PI) * dist };
}

export function bossNag(boss, name, rng) {
  if (!boss) return '';
  const n = String(name || '').trim();
  const lines = boss.lines || {};
  let list = lines[n];
  if (!list && (n === '新Bot' || n === '新  Bot')) list = lines['新 Bot'];
  if (!list?.length) list = boss.generic;
  if (!list?.length) return '';
  return list[Math.floor(rng() * list.length)];
}

// Furniture footprints (floor metres), padded so a blob does not walk through them.
// A straight line that crosses one of these is sent around the open floor instead.
const BLOCKS = [
  { x0: -7.05, x1: 2.28, z0: -4.28, z1: -1.18 },  // far table and its poufs
  { x0: -7.05, x1: 2.28, z0: 0.02, z1: 3.15 },    // near table and its poufs
  { x0: 3.5, x1: 7.1, z0: 0.0, z1: 1.22 },        // sofa
  { x0: 2.72, x1: 4.4, z0: 1.9, z1: 3.58 },       // left armchair
  { x0: 6.2, x1: 7.9, z0: 1.95, z1: 3.55 },       // right armchair
  { x0: 4.6, x1: 6.0, z0: 1.7, z1: 3.1 },         // coffee table
  { x0: 2.7, x1: 6.5, z0: -5.7, z1: -4.55 },      // coffee bar
  { x0: 3.1, x1: 6.15, z0: -4.5, z1: -3.85 },     // bar stools
  { x0: 6.1, x1: 7.9, z0: -2.65, z1: -0.75 },     // tree by the lounge
  { x0: -7.75, x1: -6.4, z0: 4.25, z1: 5.75 },    // tree, front left
  { x0: 2.2, x1: 3.65, z0: -5.85, z1: -4.8 },     // tree by the glass
  { x0: 6.5, x1: 7.8, z0: 4.95, z1: 5.45 },       // bookshelf
];

// Open-floor gates a walk can turn through. Kept off the furniture.
const GATES = [
  [-6.4, 4.6], [-2.2, 4.65], [1.5, 4.7], [4.2, 4.75], [6.05, 4.7],
  [2.52, 4.05], [2.52, 1.45], [2.52, -0.55], [2.52, -2.55],
  [7.55, 4.2],
  [-1.2, -0.58], [-6.2, -0.58],
  [-7.5, 3.35], [-7.5, -1.4], [-7.55, -5.15],
  [-6.5, -5.2], [-4.2, -5.2], [-1.4, -5.2], [1.5, -5.15],
  [1.85, -4.15], [2.9, -3.32], [5.2, -3.32], [6.8, -3.32],
  [4.4, 1.7], [5.9, 1.75], [3.15, 0.45],
];

function insideBlock(x, z) {
  for (const b of BLOCKS) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return true;
  return false;
}

function segmentClear(a, b) {
  const dist = Math.hypot(b.x - a.x, b.z - a.z);
  const steps = Math.max(2, Math.ceil(dist / 0.22));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = a.x + (b.x - a.x) * t;
    const z = a.z + (b.z - a.z) * t;
    if (Math.hypot(x - a.x, z - a.z) < 0.6) continue;   // stepping off a seat that sits in a footprint
    if (Math.hypot(x - b.x, z - b.z) < 0.85) continue;  // the spot itself may sit on a seat
    if (insideBlock(x, z)) return false;
  }
  return true;
}

// Waypoints from `from` to `to` (not including `from`, including `to`), avoiding the furniture.
export function planIdleRoute(from, to) {
  if (!from || !to) return to ? [to] : [];
  const clear = segmentClear(from, to);
  if (clear) return [{ x: to.x, z: to.z }];
  const nodes = GATES.filter(([x, z]) => !insideBlock(x, z)).map(([x, z]) => ({ x, z }));
  const goal = { x: to.x, z: to.z };
  nodes.push(goal);
  const key = (p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`;
  const prev = new Map();
  const dist = new Map([[key(from), 0]]);
  const q = [from];
  let found = null;
  while (q.length) {
    q.sort((a, b) => dist.get(key(a)) - dist.get(key(b)));
    const cur = q.shift();
    if (cur === goal) { found = cur; break; }
    const base = dist.get(key(cur));
    for (const n of nodes) {
      if (n === cur || !segmentClear(cur, n)) continue;
      const nd = base + Math.hypot(n.x - cur.x, n.z - cur.z);
      const k = key(n);
      if (nd + 1e-3 >= (dist.get(k) ?? Infinity)) continue;
      dist.set(k, nd);
      prev.set(k, cur);
      q.push(n);
    }
  }
  if (!found) return [{ x: to.x, z: to.z }];
  const out = [];
  let cur = found;
  while (cur && key(cur) !== key(from)) { out.push({ x: cur.x, z: cur.z }); cur = prev.get(key(cur)); }
  out.reverse();
  return out;
}
