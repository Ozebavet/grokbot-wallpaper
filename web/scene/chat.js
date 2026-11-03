// Idle bots that end up near each other face one another and trade short speech bubbles.
// One speaker at a time per pair, so the bubbles do not stack on the same spot.

function pairKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function canChat(actor) {
  if (!actor || actor.retiring || actor.dead) return false;
  if (actor.status !== 'idle' || !actor.driveIdle) return false;
  if (actor.hostAlpha != null && actor.hostAlpha < 0.5) return false;
  const kind = actor.anim?.kind;
  return kind !== 'stroll' && kind !== 'travel' && kind !== 'drop';
}

function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

export function createChats(config) {
  const convos = new Map();
  const coolUntil = new Map();
  return {
    get enabled() { return !!config.chat?.enabled && (config.chat.lines || []).length > 0; },
    tick(actors, now) {
      const chat = config.chat || {};
      const show = new Map();
      const quiet = (actor) => actor.bossOn || actor.bossHold || actor.held;
      if (!this.enabled) {
        for (const actor of actors.values()) if (!quiet(actor)) actor.setChat?.(null, null, 0);
        convos.clear();
        return;
      }
      const range = chat.range ?? 2.7;
      const lineSec = chat.lineSec ?? 2.7;
      const maxEx = chat.exchanges ?? 4;
      const [coolMin, coolMax] = chat.cooldown || [10, 20];
      const lines = chat.lines;
      const idle = [...actors.values()].filter((a) => canChat(a) && !a.bossOn && !a.bossHold && !a.held);

      for (const [key, convo] of convos) {
        const a = actors.get(convo.ids[0]);
        const b = actors.get(convo.ids[1]);
        if (!canChat(a) || !canChat(b) || dist(a, b) > range * 1.25) {
          convos.delete(key);
          continue;
        }
        if (now >= convo.until) {
          convo.exchanges += 1;
          if (convo.exchanges >= maxEx) {
            convos.delete(key);
            const pause = coolMin + (hash(key + Math.floor(now)) % 1000) / 1000 * (coolMax - coolMin);
            coolUntil.set(a.id, now + pause);
            coolUntil.set(b.id, now + pause);
            continue;
          }
          convo.speaker = 1 - convo.speaker;
          convo.line = (convo.line + 1) % lines.length;
          convo.until = now + lineSec;
        }
        const speaker = convo.speaker === 0 ? a : b;
        const other = speaker === a ? b : a;
        show.set(speaker.id, { text: lines[convo.line], other, partner: other.id });
        show.set(other.id, { text: null, other: speaker, partner: speaker.id });
      }

      const free = idle.filter((a) => !show.has(a.id) && (coolUntil.get(a.id) || 0) <= now);
      const pairs = [];
      for (let i = 0; i < free.length; i++) {
        for (let j = i + 1; j < free.length; j++) {
          const d = dist(free[i], free[j]);
          if (d <= range) pairs.push([d, free[i], free[j]]);
        }
      }
      pairs.sort((a, b) => a[0] - b[0]);
      const used = new Set();
      for (const [, a, b] of pairs) {
        if (used.has(a.id) || used.has(b.id)) continue;
        used.add(a.id); used.add(b.id);
        const key = pairKey(a.id, b.id);
        const start = hash(key) % lines.length;
        const speaker = hash(key + ':s') % 2;
        convos.set(key, { ids: [a.id, b.id], speaker, line: start, until: now + lineSec, exchanges: 0 });
        const who = speaker === 0 ? a : b;
        const other = who === a ? b : a;
        show.set(who.id, { text: lines[start], other, partner: other.id });
        show.set(other.id, { text: null, other: who, partner: who.id });
      }

      for (const actor of actors.values()) {
        if (actor.bossOn || actor.bossHold || actor.held) continue;
        const turn = show.get(actor.id);
        if (!turn) { actor.setChat?.(null, null, 0); continue; }
        const face = Math.atan2(turn.other.root.position.x - actor.root.position.x, turn.other.root.position.z - actor.root.position.z);
        const side = turn.other.root.position.x >= actor.root.position.x ? -1 : 1;
        actor.setChat(turn.text, face, side);
      }
    },
  };
}

function dist(a, b) {
  const dx = a.root.position.x - b.root.position.x;
  const dz = a.root.position.z - b.root.position.z;
  return Math.hypot(dx, dz);
}
