// One bot in the office: jelly blob model + quiet in-scene tag + animations.
// v2.5 behaviour: blobs turn toward the cursor (ground point within ~3.5 m, seated bots with a limited turn),
// their eyes follow it, they hop when the cursor is within ~0.9 m. Everything moves on springs.
import * as THREE from 'three';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { Spring, REDUCED, clamp, smoothstep } from './spring.js';
import { chooseIdleActivity, mulberry32, enabledActivityList, planIdleRoute, openStandPoint, bossNag } from './idle.js';

export const STATUS_COLOR = {
  working: '#34C759', idle: '#A1A1A6', waiting_user: '#FF9F0A', error: '#FF3B30', stuck: '#FF9500', done: '#0A84FF',
};
const STATUS_LABEL = { waiting_user: 'Waiting for you', error: 'Error', stuck: 'Stuck?', done: 'Done', working: 'Working', idle: 'Resting' };
const CAMERA_YAW = Math.PI / 4;     // isometric camera sits on +X +Z
const RESTING_TURN = 0.42;          // blobs lean toward the camera a bit
const MODEL_HEIGHT = 1.0;
const LOOK_RANGE = 3.5;             // m: cursor ground point that makes a bot look
const HOP_RANGE = 0.9;              // m: cursor this close makes it hop
const HOP_COOLDOWN = 1.2;
const EYE_SHIFT = 0.034;            // m, at full sideways glance

const ringTexture = makeRadialTexture([[0, 'rgba(255,255,255,0.95)'], [0.45, 'rgba(255,255,255,0.55)'], [1, 'rgba(255,255,255,0)']]);
const shadowTexture = makeRadialTexture([[0, 'rgba(0,0,0,0.38)'], [0.6, 'rgba(0,0,0,0.12)'], [1, 'rgba(0,0,0,0)']]);
// "done": a short soft flash around the bot and one ripple across the floor, in the done colour (no confetti)
const haloTexture = makeRadialTexture([[0, 'rgba(255,255,255,0.9)'], [0.32, 'rgba(255,255,255,0.42)'], [1, 'rgba(255,255,255,0)']]);
const rippleTexture = makeRadialTexture([[0, 'rgba(255,255,255,0)'], [0.6, 'rgba(255,255,255,0)'], [0.8, 'rgba(255,255,255,0.95)'],
  [0.9, 'rgba(255,255,255,0.3)'], [1, 'rgba(255,255,255,0)']]);
const RIPPLE_GEO = new THREE.PlaneGeometry(2, 2);
const CELEBRATE_S = 0.95;

export class Actor {
  // ctx: { parent: Object3D (the open-floor instance root), inst, pickables: Set, confetti(fn), cursor: {active,x,z}, dropDelay }
  constructor(bot, ctx) {
    this.id = bot.id;
    this.ctx = ctx;
    this.phase = hash(bot.id) % 1000 / 1000 * Math.PI * 2;
    this.status = null;
    this.hovered = false;
    this.selected = false;
    this.anim = null;                // one-shot animation (hop / land / travel / drop)
    this.nextBlink = 1 + Math.random() * 3;
    this.blinkT = -1;
    this.nextAction = 1 + Math.random() * 2;
    this.hopCooldown = 0.6;
    this.retiring = false;
    this.dead = false;
    this.hostAlpha = 1;
    this.tagKey = '';

    this.yawS = new Spring(RESTING_TURN, 0.3);
    this.scaleS = new Spring(1, 0.28);
    this.eyeX = new Spring(0, 0.16);
    this.eyeY = new Spring(0, 0.16);
    this.modelScale = 1;

    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.modelWrap = new THREE.Group();
    this.pivot.add(this.modelWrap);
    this.root.add(this.pivot);

    const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.006;
    shadow.renderOrder = 1;
    this.pivot.add(shadow);
    this.shadow = shadow;

    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 1.5), new THREE.MeshBasicMaterial({ map: ringTexture, transparent: true, depthWrite: false, color: STATUS_COLOR.idle, opacity: 0 }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 1;
    this.root.add(this.ring);

    this.tagEl = document.createElement('div');
    this.tagEl.className = 'hqt';
    this.tagEl.dataset.mode = 'off';
    this.tagEl.innerHTML = '<div class="hqt-pill"><i class="hqt-dot"></i><span class="hqt-text"></span></div><div class="hqt-stem"></div>';
    this.tagText = this.tagEl.querySelector('.hqt-text');
    this.tag = new CSS2DObject(this.tagEl);
    this.tag.center.set(0.5, 0);
    this.tag.position.y = MODEL_HEIGHT + 0.24;
    this.tag.visible = false;
    this.pivot.add(this.tag);

    this.chatEl = document.createElement('div');
    this.chatEl.className = 'hq-chat';
    this.chatEl.innerHTML = '<div class="hq-chat-bubble"><span class="hq-chat-text"></span></div>';
    this.chatBubble = this.chatEl.querySelector('.hq-chat-bubble');
    this.chatSpan = this.chatEl.querySelector('.hq-chat-text');
    this.chat = new CSS2DObject(this.chatEl);
    this.chat.center.set(0.5, 1);
    this.chat.position.y = MODEL_HEIGHT + 0.62;
    this.chat.visible = false;
    this.root.add(this.chat);
    this.chatFace = null;
    this.chatSide = 0;
    this.chatShown = '';

    this.setPlaceholderModel(bot.color);
    ctx.parent.add(this.root);
  }

  // ---------- model ----------

  setPlaceholderModel(color) {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.46, 40, 28), jelly(color));
    body.scale.set(1, 0.95, 0.82);
    body.position.y = 0.44;
    const eyeGeo = new THREE.CapsuleGeometry(0.042, 0.085, 6, 12);
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, emissive: 0xffffff, emissiveIntensity: 0.15 });
    const eyeL = new THREE.Mesh(eyeGeo, eyeMat); eyeL.position.set(-0.12, 0.52, 0.36);
    const eyeR = new THREE.Mesh(eyeGeo, eyeMat); eyeR.position.set(0.12, 0.52, 0.36);
    const g = new THREE.Group();
    g.add(body, eyeL, eyeR);
    this.modelScale = 1;
    this.useModel(g, [eyeL, eyeR], true);
  }

  // model: Object3D from a blob GLB (already cloned); tint: hex color for the default blob
  setModel(model, tint) {
    let eyes = [];
    model.traverse((o) => {
      if (/^eye_[LR]/.test(o.name)) eyes.push(o);
      if (o.isMesh && tint && /body/.test(o.name + (o.parent?.name || ''))) {
        o.material = o.material.clone();
        o.material.color.set(tint);
      }
    });
    eyes = eyes.filter((e) => !eyes.some((p) => p !== e && isAncestor(p, e)));
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const s = MODEL_HEIGHT / Math.max(size.x, size.y, size.z, 0.01);
    model.scale.multiplyScalar(s);
    box.setFromObject(model);
    const c = box.getCenter(new THREE.Vector3());
    model.position.x -= c.x; model.position.z -= c.z; model.position.y -= box.min.y;
    this.modelScale = model.scale.x || 1;
    box.setFromObject(model);
    this.tag.position.y = box.max.y + 0.24;                       // pill floats just above this blob's head
    this.useModel(model, eyes, false);
  }

  useModel(model, eyes, placeholder) {
    for (const o of this.pickMeshes || []) this.ctx.pickables.delete(o);
    this.modelWrap.clear();
    this.modelWrap.add(model);
    this.eyes = eyes;
    this.eyeBase = eyes.map((e) => e.scale.y);
    this.eyePos = eyes.map((e) => e.position.clone());
    this.pickMeshes = [];
    model.traverse((o) => { if (o.isMesh) { o.userData.actorId = this.id; this.pickMeshes.push(o); if (!this.retiring) this.ctx.pickables.add(o); } });
    this.placeholder = placeholder;
  }

  // ---------- state ----------

  update(bot, spot, view) {
    const status = bot.effective_status || bot.status;
    const statusChanged = status !== this.status;
    const prev = this.status;
    this.status = status;
    this.bot = bot;

    const color = STATUS_COLOR[status] || STATUS_COLOR.idle;
    this.ring.material.color.set(color);
    this.tagEl.dataset.status = status;
    this.tagEl.style.setProperty('--c', color);
    this.selected = view.selectedBot === bot.id;
    this.renderTag();

    if (status === 'idle' && isBossBot(bot, this.ctx.boss)) {
      this.idleGaveUp = false;
      if (this.driveIdle && !this.bossPatrol) this.endIdle();
      if (!this.bossPatrol) this.startBoss(spot);
    } else {
      if (this.bossPatrol) this.endBoss();
      const idleOn = status === 'idle' && !!view?.idle?.enabled;
      if (idleOn) {
        this.idleCtrl = view.idle;
        if (!this.driveIdle && !this.idleGaveUp) this.beginIdle(spot);
      } else {
        this.idleGaveUp = false;
        if (this.driveIdle) this.endIdle();
        if (spot && (!this.spot || this.spot.pos.distanceToSquared(spot.pos) > 1e-4)) {
          if (!this.spot) this.dropIn(spot); else this.travelTo(spot);
          this.spot = spot;
        }
      }
    }
    this.ring.position.y = 0.012 - (this.spot ? this.spot.pos.y : 0);

    if (statusChanged && prev) {
      if (status === 'done') { this.celebrate(); this.hop(0.45); }
      else if (status === 'waiting_user' || status === 'error') this.hop(0.3);
    }
  }

  // Quiet by default: selected (dark pill, name), needs-the-user (compact pill, short reason), hovered (pill, name).
  renderTag() {
    const s = this.status, bot = this.bot;
    if (!bot) return;
    const attn = s === 'waiting_user' || s === 'error' || s === 'stuck';
    const mode = this.selected ? 'sel' : attn ? 'attn' : this.hovered ? 'hover' : 'off';
    let text = bot.name || '';
    if (mode === 'attn') {
      const reason = reasonText(s, bot.step);
      text = this.hovered ? `${bot.name} · ${reason}` : reason;
    }
    const key = `${mode}|${s}|${text}`;
    if (key === this.tagKey) return;
    this.tagKey = key;
    this.tagEl.dataset.mode = mode;
    this.tagText.textContent = text;
    this.tagEl.title = '';
  }

  spotIsLounge() { return !!this.spot && this.spot.lounge; }

  setHovered(on) {
    if (this.hovered === on) return;
    this.hovered = on;
    if (on && !this.anim) this.hop(0.2);
    this.renderTag();
  }

  retire() {
    if (this.retiring) return;
    this.retiring = true;
    this.hovered = false;
    this.carried = false;
    this.carry = null;
    this.bossPatrol = false;
    this.endIdle();
    this.scaleS.to(0);
    for (const o of this.pickMeshes || []) this.ctx.pickables.delete(o);
    this.tagEl.dataset.mode = 'off';
    this.tag.visible = false;
    this.setChat(null, null, 0);
  }

  // text null fades the bubble out. faceYaw is an absolute heading toward the partner; side is -1 or 1
  // so the two bubbles sit on opposite sides and do not cover each other.
  setChat(text, faceYaw, side) {
    this.chatFace = faceYaw == null ? null : faceYaw;
    this.chatSide = side || 0;
    const next = text || '';
    const on = !!next;
    if (next === this.chatShown && this.chatBubble.classList.contains('is-on') === on) return;
    this.chatShown = next;
    if (next) this.chatSpan.textContent = next;
    this.chatBubble.classList.toggle('is-on', on);
  }

  // ---------- motion ----------

  dropIn(spot) {
    this.root.position.copy(spot.pos);
    this.baseYaw = spot.yaw;
    this.yawS.snap(spot.yaw + RESTING_TURN);
    this.anim = { kind: 'drop', t: -(this.ctx.dropDelay || 0), dur: 0.75, from: 2.4 };
    this.scaleS.snap(this.ctx.dropDelay > 0 ? 0.001 : 1);
    if (this.ctx.dropDelay > 0) this.scaleS.to(1, this.ctx.dropDelay);
  }

  travelTo(spot, opts = {}) {
    const from = this.root.position.clone();
    const dist = from.distanceTo(spot.pos);
    const stroll = !!opts.stroll;
    if (REDUCED || dist < 0.05) { this.root.position.copy(spot.pos); this.baseYaw = spot.yaw; return; }
    const dir = new THREE.Vector3().subVectors(spot.pos, from);
    const speed = stroll ? (opts.speed || 0.85) : 2.6;
    this.anim = {
      kind: stroll ? 'stroll' : 'travel', t: 0,
      dur: Math.max(stroll ? 0.9 : 0.8, dist / speed),
      from, to: spot.pos.clone(), toYaw: spot.yaw, travelYaw: Math.atan2(dir.x, dir.z),
      hop: stroll ? 0.1 : 0.55,
    };
  }

  strollTo(spot, speed, pause = 0.4) {
    this.travelTo(spot, { stroll: true, speed });
    if (this.idle) this.idle.pause = pause;
  }

  // Walk to a spot, detouring around the tables and the lounge when the straight line crosses them.
  beginMove(spot, speed) {
    const from = { x: this.root.position.x, z: this.root.position.z };
    const pts = planIdleRoute(from, { x: spot.pos.x, z: spot.pos.z });
    this.idle.detour = pts.slice(0, -1).map((p, i) => {
      const n = pts[i + 1];
      return { pos: new THREE.Vector3(p.x, 0, p.z), yaw: Math.atan2(n.x - p.x, n.z - p.z) };
    });
    this.idle.detourFinal = spot;
    this.idle.speed = speed || this.idle.speed || 0.85;
    this.stepDetour();
  }

  stepDetour() {
    if (this.idle.detour?.length) {
      this.strollTo(this.idle.detour.shift(), this.idle.speed, 0.08);
      return;
    }
    if (this.idle.detourFinal) {
      const spot = this.idle.detourFinal;
      this.idle.detourFinal = null;
      this.spot = spot;
      this.strollTo(spot, this.idle.speed, 0.35);
    }
  }

  hop(height) {
    if (REDUCED || this.anim || this.retiring) return;
    this.anim = { kind: 'hop', t: 0, dur: 0.62, h: height };
  }

  /** a task is done: a soft flash around the bot, one ripple on the floor, happy squinting eyes */
  celebrate() {
    if (REDUCED || this.retiring) return;
    this.endCelebration();
    const color = new THREE.Color(STATUS_COLOR.done);
    const ripple = new THREE.Mesh(RIPPLE_GEO, new THREE.MeshBasicMaterial({ map: rippleTexture, color, transparent: true, depthWrite: false, opacity: 0 }));
    ripple.rotation.x = -Math.PI / 2;
    ripple.position.y = this.ring.position.y + 0.003;
    ripple.renderOrder = 2;
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture, color, transparent: true, depthWrite: false, opacity: 0 }));
    halo.position.y = Math.max(0.3, this.tag.position.y - 0.24) * 0.55;          // the middle of the body
    halo.renderOrder = 2;
    this.root.add(ripple, halo);
    this.fx = { t: 0, ripple, halo };
    this.joy = 0.75;
  }

  endCelebration() {
    if (!this.fx) return;
    for (const o of [this.fx.ripple, this.fx.halo]) { o.removeFromParent(); o.material.dispose(); }
    this.fx = null;
  }

  tickCelebration(dt) {
    const f = this.fx;
    f.t += dt;
    const k = f.t / CELEBRATE_S;
    if (k >= 1) { this.endCelebration(); return; }
    const out = 1 - (1 - k) ** 3;                                   // the ripple runs out fast and slows down
    f.ripple.scale.setScalar(0.4 + 1.6 * out);
    f.ripple.material.opacity = 0.8 * (1 - k) ** 1.3;
    const fk = Math.min(1, f.t / 0.55);                             // the flash: up and gone in about half a second
    f.halo.scale.setScalar(0.8 + 1.3 * (1 - (1 - fk) ** 2));
    f.halo.material.opacity = 0.6 * Math.sin(Math.PI * fk);
  }

  // ---------- idle activities (status === 'idle', unless sofaOnly) ----------

  ensureIdleRng() {
    if (this.idleRng) return;
    const name = this.bot?.name || this.id;
    const seed = hash(`${name}:idle`);
    this.idleRng = mulberry32(seed);
    this.idleTempo = 0.82 + (hash(`${name}:tempo`) % 1000) / 1000 * 0.4;
    const kinds = enabledActivityList(this.idleCtrl.config);
    this.idleFavorite = kinds.length ? kinds[seed % kinds.length] : null;
  }

  beginIdle(desk) {
    this.ensureIdleRng();
    const choice = chooseIdleActivity(this.idleActor(), this.idleCtrl, this.idleRng, null);
    if (!choice) {
      this.driveIdle = false;
      this.idleGaveUp = true;
      if (!this.spot && desk) { this.dropIn(desk); this.spot = desk; }
      return;
    }
    this.driveIdle = true;
    this.idle = { kind: null, left: 0, poseT: this.idleRng() * 4, pause: 0.3, path: null, pathI: 0, speed: 0.85 };
    this.applyChoice(choice, !this.spot);
  }

  endIdle() {
    if (!this.driveIdle && !this.idle) return;
    this.driveIdle = false;
    this.idle = null;
    this.idleGaze = null;
    this.idleBody = null;
    this.idleCtrl?.release(this.id);
  }

  startBoss(desk) {
    this.bossPatrol = true;
    this.driveIdle = true;
    if (!this.idleRng) this.idleRng = mulberry32(hash(`${this.bot?.name || this.id}:boss`));
    const speed = this.ctx.boss?.speed || 0.92;
    this.idle = { kind: 'boss', left: 1e9, poseT: this.idleRng() * 2, pause: 0.3, path: null, pathI: 0, speed, detour: [], detourFinal: null };
    this.boss = { targetId: null, left: 0.4, watching: false, line: '' };
    if (!this.spot && desk) { this.dropIn(desk); this.spot = desk; }
  }

  endBoss() {
    if (!this.bossPatrol && !this.boss) return;
    this.bossPatrol = false;
    this.boss = null;
    this.setChat(null, null, 0);
    this.endIdle();
  }

  pickEmployee() {
    const list = [];
    for (const a of this.ctx.actors?.values() || []) {
      if (a !== this && !a.retiring && !a.dead) list.push(a);
    }
    if (!list.length) return null;
    const pool = list.length > 1 ? list.filter((a) => a.id !== this.boss.targetId) : list;
    return pool[Math.floor(this.idleRng() * pool.length)];
  }

  advanceBoss() {
    this.setChat(null, null, 0);
    const emp = this.pickEmployee();
    if (!emp) {
      this.boss.targetId = null;
      this.boss.watching = true;
      this.boss.left = 1.2;
      this.boss.line = '';
      return;
    }
    const p = openStandPoint(emp.root.position.x, emp.root.position.z, emp.baseYaw || 0, this.ctx.boss?.stand || 1.05);
    const spot = {
      pos: new THREE.Vector3(p.x, 0, p.z),
      yaw: Math.atan2(emp.root.position.x - p.x, emp.root.position.z - p.z),
    };
    this.boss.targetId = emp.id;
    this.boss.watching = false;
    this.boss.line = bossNag(this.ctx.boss, emp.bot?.name, this.idleRng);
    this.spot = spot;
    this.beginMove(spot, this.idle.speed);
  }

  tickBoss(dt, moving) {
    if (moving) {
      if (this.chatShown) this.setChat(null, null, 0);
      return;
    }
    if (!this.boss.watching) {
      if (!this.boss.targetId) { this.advanceBoss(); return; }
      this.boss.watching = true;
      const [a, b] = this.ctx.boss?.pause || [2.8, 4.6];
      this.boss.left = a + this.idleRng() * Math.max(0, b - a);
    }
    const emp = this.boss.targetId && this.ctx.actors?.get(this.boss.targetId);
    if (emp && !emp.retiring && this.boss.line) {
      const face = Math.atan2(emp.root.position.x - this.root.position.x, emp.root.position.z - this.root.position.z);
      const side = emp.root.position.x >= this.root.position.x ? -1 : 1;
      this.setChat(this.boss.line, face, side);
      this.baseYaw = face;
    }
    this.boss.left -= dt;
    if (this.boss.left <= 0) this.advanceBoss();
  }

  grab(x, z) {
    this.carried = true;
    this.carry = { x, z, y: 0.2, sway: 0, vx: 0, vz: 0 };
    if (this.idle) { this.idle.detour = []; this.idle.detourFinal = null; }
    this.anim = null;
    this.setChat(null, null, 0);
  }

  setCarry(x, z) {
    const c = this.carry;
    if (!c) return;
    const now = performance.now();
    const dt = Math.max(0.016, ((now - (c.t || now)) / 1000));
    c.vx = (x - c.x) / dt;
    c.vz = (z - c.z) / dt;
    c.x = x;
    c.z = z;
    c.t = now;
  }

  dropCarry() {
    if (!this.carried) return;
    const from = Math.max(0.35, this.carry?.y || 0.8);
    this.carried = false;
    this.carry = null;
    this.anim = { kind: 'carryDrop', t: 0, dur: 0.5, from };
  }

  resumeAfterDrop() {
    if (this.shadow) { this.shadow.position.y = 0.006; this.shadow.scale.setScalar(1); }
    if (!this.spot || this.retiring) return;
    if (this.bossPatrol && this.boss && !this.boss.watching) { this.advanceBoss(); return; }
    if (this.driveIdle && this.idle) {
      this.idle.detour = [];
      this.idle.detourFinal = null;
      this.beginMove(this.spot, this.idle.speed || 0.85);
    } else this.travelTo(this.spot);
  }

  idleActor() {
    const b = this.bot || {};
    return { id: this.id, name: b.name, group: b.group, favorite: this.idleFavorite };
  }

  applyChoice(choice, drop) {
    const first = !this.idle.kind;
    this.idle.kind = choice.kind;
    this.idle.path = choice.path || null;
    this.idle.pathI = choice.index || 0;
    this.idle.speed = choice.speed || 0.85;
    this.idle.poseT = first ? this.idle.poseT : this.idleRng() * 2;
    const { min, max } = this.idleCtrl.config.duration;
    let dur = (min + this.idleRng() * (max - min)) / this.idleTempo;
    dur = clamp(dur, min, max);
    this.idle.left = first ? Math.max(6, dur * (0.45 + this.idleRng() * 0.55)) : dur;
    this.spot = choice.spot;
    if (drop) {
      this.dropIn(choice.spot);
      this.idle.detour = [];
      this.idle.detourFinal = null;
      this.idle.pause = 0.35;
    } else this.beginMove(choice.spot, this.idle.speed);
  }

  advanceIdle() {
    const prev = this.idle?.kind || null;
    const choice = chooseIdleActivity(this.idleActor(), this.idleCtrl, this.idleRng, prev);
    if (!choice) { this.idle.left = 4; return; }
    this.applyChoice(choice, false);
  }

  stepPath() {
    const path = this.idle.path;
    if (!path || path.length < 2) return;
    const sep = this.idleCtrl.config.separation || 0.9;
    let i = (this.idle.pathI + 1) % path.length;
    if (this.idleCtrl.blocked(path[i].pos, sep, this.id)) { this.idle.pause = 0.7; return; }
    this.idle.pathI = i;
    this.spot = path[i];
    this.beginMove(path[i], this.idle.speed);
  }

  tickIdle(dt) {
    if (this.carried) return;
    if (!this.driveIdle || !this.idle || this.retiring) return;
    if (this.anim?.kind === 'drop' || this.anim?.kind === 'carryDrop') return;
    const moving = this.anim?.kind === 'stroll' || this.anim?.kind === 'travel';
    const routing = !!(this.idle.detourFinal || this.idle.detour?.length);
    if (routing) {
      if (!moving) {
        this.idle.pause -= dt;
        if (this.idle.pause <= 0) this.stepDetour();
      }
      return;
    }
    if (this.bossPatrol) return this.tickBoss(dt, moving);
    this.idle.left -= dt;
    if (moving) return;
    this.idle.poseT += dt;
    if (this.idle.path) {
      this.idle.pause -= dt;
      if (this.idle.pause <= 0 && this.idle.left > 1.2) { this.stepPath(); return; }
    }
    if (this.idle.left <= 0) this.advanceIdle();
  }

  applyIdlePose() {
    this.idleGaze = null;
    this.idleBody = null;
    if (this.carried) return;
    if (!this.driveIdle || !this.idle || this.anim) return;
    const pt = this.idle.poseT, ph = this.phase;
    if (this.idle.kind === 'sofa') {
      const period = 3.2, u = pt / period;
      const slots = [
        { yaw: 0, eyeX: 0, eyeY: 0, rx: 0.02 },
        { yaw: -0.48, eyeX: -0.03, eyeY: 0, rx: 0.02 },
        { yaw: 0.48, eyeX: 0.03, eyeY: 0, rx: 0.03 },
        { yaw: 0.06, eyeX: 0, eyeY: 0.032, rx: -0.1 },
      ];
      const i0 = Math.floor(u) % slots.length, i1 = (i0 + 1) % slots.length;
      const f = u - Math.floor(u);
      const e = f < 0.55 ? 0 : (f - 0.55) / 0.45;
      const k = e * e * (3 - 2 * e);
      const a = slots[i0], b = slots[i1];
      const mix = (p, q) => p + (q - p) * k;
      this.idleGaze = { yaw: mix(a.yaw, b.yaw), eyeX: mix(a.eyeX, b.eyeX), eyeY: mix(a.eyeY, b.eyeY) };
      this.idleBody = { rx: mix(a.rx, b.rx), sy: this.idleGaze.eyeY > 0.01 ? 1.03 : 1 };
    } else if (this.idle.kind === 'window') {
      const look = 0.5 + 0.5 * Math.sin(pt * 0.45 + ph);
      this.idleBody = { rx: 0.08 + 0.07 * look, rz: 0.03 * Math.sin(pt * 0.55 + 1) };
      this.idleGaze = { yaw: 0.14 * Math.sin(pt * 0.25 + ph), eyeX: 0.02 * Math.sin(pt * 0.22 + ph), eyeY: 0.01 + 0.022 * look };
    } else if (this.idle.kind === 'stretch') {
      const up = Math.max(0, Math.sin(pt * 1.15 + ph));
      this.idleBody = { sy: 1 + 0.22 * up, sx: 1 - 0.1 * up, y: 0.055 * up, rz: 0.2 * Math.sin(pt * 0.75 + ph), rx: -0.07 * up };
    } else if (this.idle.kind === 'coffee') {
      const sip = Math.max(0, Math.sin(pt * 1.55 + ph));
      this.idleBody = { rx: (this.spot?.seat ? 0.12 : 0.22) * sip, sy: 1 - 0.045 * sip };
      this.idleGaze = { yaw: 0.08 * Math.sin(pt * 0.4 + ph), eyeX: 0, eyeY: -0.014 * sip };
    } else if (this.idle.kind === 'lean') {
      const sway = Math.sin(pt * 0.4 + ph);
      this.idleBody = { rx: -0.14, rz: 0.18 + 0.04 * sway, sy: 0.94, sx: 1.04 };
      this.idleGaze = { yaw: 0.28 * sway, eyeX: 0.02 * sway, eyeY: 0.006 };
    } else {
      const sway = Math.sin(pt * 0.5 + ph);
      this.idleGaze = { yaw: 0.4 * sway, eyeX: 0.02 * sway, eyeY: 0 };
    }
  }

  tick(dt, t) {
    this.tickIdle(dt);
    this.applyIdlePose();
    const p = this.pivot;
    const s = this.status;
    let y = 0, sx = 1, sy = 1, rx = 0, rz = 0, ox = 0;

    if (!REDUCED) {
      const breathe = Math.sin(t * 2.1 + this.phase);
      sy = 1 + 0.018 * breathe; sx = 1 - 0.012 * breathe;
      if (s === 'working') { y = 0.012 * Math.abs(Math.sin(t * 9 + this.phase)); rx = 0.06; }
      if (s === 'stuck') rz = 0.09 * Math.sin(t * 1.3 + this.phase);
      if (s === 'error') {
        const k = (t + this.phase) % 1.6;
        if (k < 0.45) ox = 0.03 * Math.sin(k * 70);
      }
      if (s === 'waiting_user' && !this.anim) {
        this.nextAction -= dt;
        if (this.nextAction <= 0) { this.hop(0.32); this.nextAction = 1.7 + Math.random() * 0.6; }
      }
    }

    // one-shot animation
    if (this.anim) {
      const a = this.anim;
      a.t += dt;
      const k = clamp(a.t / a.dur, 0, 1);
      if (a.kind === 'hop') ({ y, sx, sy } = hopCurve(k, a.h));
      else if (a.kind === 'drop') {
        if (a.t < 0) y = a.from;
        const fall = Math.min(1, k / 0.55);
        if (a.t >= 0) y = a.from * (1 - fall * fall);
        if (k > 0.55) ({ sx, sy } = squash((k - 0.55) / 0.45));
      } else if (a.kind === 'travel' || a.kind === 'stroll') {
        const e = easeInOut(k);
        this.root.position.lerpVectors(a.from, a.to, e);
        const hop = a.hop ?? 0.55;
        const step = a.kind === 'stroll' ? 0.55 : 0.42;
        const hops = Math.max(1, Math.round(a.dur / step));
        const local = (k * hops) % 1;
        const lift = Math.sin(local * Math.PI);
        y = hop * lift;
        sy = 1 + (a.kind === 'stroll' ? 0.05 : 0.12) * lift;
        sx = 1 - (a.kind === 'stroll' ? 0.03 : 0.07) * lift;
        this.baseYaw = k < 0.92 ? a.travelYaw : a.toYaw;
      } else if (a.kind === 'carryDrop') {
        const fall = Math.min(1, k / 0.62);
        y = a.from * (1 - fall * fall);
        if (k > 0.62) {
          const q = (k - 0.62) / 0.38;
          y = Math.sin(q * Math.PI) * (1 - q) * Math.min(0.2, a.from * 0.22);
          ({ sx, sy } = squash(q));
        }
      }
      if (a.t >= a.dur) {
        if (a.kind === 'travel' || a.kind === 'stroll') { this.root.position.copy(a.to); this.baseYaw = a.toYaw; }
        const dropped = a.kind === 'carryDrop';
        this.anim = null;
        if (dropped) this.resumeAfterDrop();
      }
    }

    if (this.carried && this.carry) {
      const c = this.carry;
      c.sway += dt * (6.5 + Math.min(5, Math.hypot(c.vx, c.vz) * 0.35));
      c.vx *= Math.exp(-dt * 6);
      c.vz *= Math.exp(-dt * 6);
      c.y += (1.12 - c.y) * Math.min(1, dt * 8);
      const amp = (REDUCED ? 0.08 : 0.22) + Math.min(0.35, Math.hypot(c.vx, c.vz) * 0.03);
      const swing = Math.sin(c.sway);
      rz += swing * amp;
      rx += Math.cos(c.sway * 0.7) * amp * 0.35;
      y += c.y;
      sy *= 1.06;
      sx *= 0.93;
      this.root.position.x = c.x + swing * (REDUCED ? 0.04 : 0.11);
      this.root.position.z = c.z + Math.cos(c.sway * 0.85) * (REDUCED ? 0.02 : 0.05);
    }

    if (!this.anim && this.idleBody) {
      y += this.idleBody.y || 0;
      sx *= this.idleBody.sx || 1;
      sy *= this.idleBody.sy || 1;
      rx += this.idleBody.rx || 0;
      rz += this.idleBody.rz || 0;
    }

    // ---- cursor: look toward it, glance with the eyes, hop when it is close ----
    const cur = this.ctx.cursor;
    let w = 0, lookYaw = 0, dist = 99;
    if (cur?.active && !this.retiring && !this.carried && this.hostAlpha > 0.6) {
      const dx = cur.x - this.root.position.x, dz = cur.z - this.root.position.z;
      dist = Math.hypot(dx, dz);
      if (dist < LOOK_RANGE) { w = smoothstep(LOOK_RANGE, LOOK_RANGE - 1.3, dist); lookYaw = Math.atan2(dx, dz); }
    }
    this.hopCooldown -= dt;
    if (dist < HOP_RANGE && this.hopCooldown <= 0 && !this.anim && !this.carried && !REDUCED) { this.hop(0.26); this.hopCooldown = HOP_COOLDOWN; }

    const moving = this.anim?.kind === 'travel' || this.anim?.kind === 'stroll';
    const base = (this.baseYaw || 0) + (moving ? 0 : RESTING_TURN);
    let target = base;
    if (this.hovered || this.selected) target = CAMERA_YAW;
    else if (w > 0) {
      const seated = (!this.spotIsLounge() && s !== 'idle') || (this.driveIdle && !!this.spot?.seat);
      const lim = seated ? 0.8 : 1.9;                               // seated bots never leave the desk
      target = base + clamp(angleDiff(lookYaw, base), -lim, lim) * w;
    } else if (this.chatFace != null) target = this.chatFace;
    else if (this.idleGaze) target = base + this.idleGaze.yaw;
    this.yawS.target = this.yawS.x + angleDiff(target, this.yawS.x);
    this.yawS.step(dt);

    const sel = this.selected ? 1.06 : 1;
    const sc = this.scaleS.step(dt);
    p.position.set(ox, y, 0);
    const lift = this.carried ? this.carry.y : (this.anim?.kind === 'carryDrop' ? y : 0);
    if (this.shadow && lift > 0.001) {
      this.shadow.position.y = 0.006 - lift;
      this.shadow.scale.setScalar(Math.max(0.45, 1 - lift * 0.32));
    } else if (this.shadow) {
      this.shadow.position.y = 0.006;
      this.shadow.scale.setScalar(1);
    }
    p.scale.set(sx * sel * sc, sy * sel * sc, sx * sel * sc);
    p.rotation.set(rx, this.yawS.x, rz, 'YXZ');

    // eyes
    if (w > 0 && !this.hovered && !this.selected) {
      const ang = angleDiff(lookYaw, this.yawS.x);
      this.eyeX.to(Math.sin(clamp(ang, -1.2, 1.2)) * EYE_SHIFT * w);
      this.eyeY.to(-0.012 * w);
    } else if (this.idleGaze && !this.hovered && !this.selected) {
      this.eyeX.to(this.idleGaze.eyeX || 0);
      this.eyeY.to(this.idleGaze.eyeY || 0);
    } else { this.eyeX.to(0); this.eyeY.to(0); }
    this.eyeX.step(dt); this.eyeY.step(dt);

    // status ring: quiet unless it matters
    const pulse = s === 'working' ? 0.14 + 0.05 * Math.sin(t * 3 + this.phase)
      : s === 'waiting_user' || s === 'error' ? 0.4 + 0.25 * (0.5 + 0.5 * Math.sin(t * 5))
      : s === 'stuck' ? 0.3 + 0.15 * Math.sin(t * 2) : 0;
    const wantRing = this.selected ? 0.8 : this.hovered ? Math.max(0.4, pulse) : pulse;
    this.ring.material.opacity = wantRing * clamp(sc, 0, 1);
    this.ring.scale.setScalar(this.selected ? 1.12 : 1);
    if (this.fx) this.tickCelebration(dt);

    // tag follows the host floor: hidden while that floor is faded / lifted
    this.tag.visible = this.tagEl.dataset.mode !== 'off' && this.hostAlpha > 0.5 && !this.retiring && this.scaleS.x > 0.6;     // no tag before the blob has dropped in
    const chatting = this.chatBubble.classList.contains('is-on') || !!this.chatSpan.textContent;
    this.chat.visible = chatting && this.hostAlpha > 0.5 && !this.retiring && this.scaleS.x > 0.6 && this.status === 'idle';
    this.chat.position.set(this.chatSide * 0.46, this.tag.position.y + (this.tag.visible ? 0.46 : 0.08), 0);

    this.tickEyes(dt);
    if (this.retiring && this.scaleS.x < 0.03) { this.dead = true; this.dispose(); }
  }

  tickEyes(dt) {
    if (!this.eyes.length) return;
    const s = this.status;
    let open = 1;
    if (s === 'idle' && !this.driveIdle && !this.spotIsLounge()) open = 0.12;   // sofa-only overflow: sleeping at the desk
    else if (this.driveIdle && this.idle?.kind === 'sofa') open = 0.86;
    else if (s === 'error') open = 0.55;
    else if (s === 'stuck') open = 0.7;
    if (open > 0.5 && !REDUCED) {
      this.nextBlink -= dt;
      if (this.nextBlink <= 0) { this.blinkT = 0; this.nextBlink = 2.2 + Math.random() * 3.5; }
      if (this.blinkT >= 0) {
        this.blinkT += dt;
        const b = this.blinkT / 0.16;
        if (b >= 1) this.blinkT = -1; else open *= Math.max(0.1, Math.abs(1 - 2 * b));
      }
    }
    if (this.joy > 0) { this.joy -= dt; open = Math.min(open, 0.32); }   // just finished a task: happy, squinting
    const k = 1 / this.modelScale;
    this.eyes.forEach((e, i) => {
      e.scale.y = this.eyeBase[i] * open;
      e.position.x = this.eyePos[i].x + this.eyeX.x * k;
      e.position.y = this.eyePos[i].y + this.eyeY.x * k;
    });
  }

  dispose() {
    this.endCelebration();
    for (const o of this.pickMeshes || []) this.ctx.pickables.delete(o);
    this.tagEl.remove();
    this.chatEl?.remove();
    this.root.removeFromParent();
  }
}

// ---------- helpers ----------

export function jelly(color) {
  return new THREE.MeshPhysicalMaterial({ color, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.18, sheen: 0.3 });
}

function isBossBot(bot, boss) {
  return !!(boss?.enabled && (bot?.name || '').trim() === String(boss.name || 'BIG Boss').trim());
}

function reasonText(status, step) {
  let t = (step || '').trim();
  if (status === 'stuck' || !t) return STATUS_LABEL[status] || '';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  return t.length > 34 ? `${t.slice(0, 33).trimEnd()}…` : t;
}

function hopCurve(k, h) {
  if (k < 0.15) { const q = k / 0.15; return { y: 0, sx: 1 + 0.12 * q, sy: 1 - 0.18 * q }; }
  if (k < 0.7) { const q = (k - 0.15) / 0.55; return { y: h * Math.sin(q * Math.PI), sx: 0.93, sy: 1.12 }; }
  return { y: 0, ...squash((k - 0.7) / 0.3) };
}

function squash(q) {
  const a = Math.sin(q * Math.PI) * (1 - q);
  return { sx: 1 + 0.16 * a, sy: 1 - 0.2 * a };
}

const easeInOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

function angleDiff(a, b) {
  return ((a - b + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

function isAncestor(p, c) {
  for (let n = c.parent; n; n = n.parent) if (n === p) return true;
  return false;
}

export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function makeRadialTexture(stops) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [o, col] of stops) grad.addColorStop(o, col);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
