// Idle-time behaviour for bots whose status is `idle`.
//
// sofaOnly: true restores the original behaviour (idle bots sit on the lounge seats, and the
// overflow naps at its desk). false lets each bot pick from the activities below.
//
// Activities change every duration.min–duration.max seconds. Weights are relative; set enabled
// to false to take an activity out of the mix. roleBias is a light nudge from the bot's name
// and team (a designer leans toward the windows) — it never locks a bot to one activity.
//
// URL overrides, for a quick comparison: ?idle=sofa (lounge seats only), ?idle=live (activities
// even if sofaOnly is true in this file).

export const IDLE_CONFIG = {
  sofaOnly: false,
  // Future layout, off while every bot shares one floor. When true, working bots stay on an
  // office floor and idle bots move to a lounge floor to hang out. ?layout=split turns it on
  // for one visit; ?layout=one forces the single floor.
  splitRecFloor: false,
  duration: { min: 10, max: 30 },
  separation: 0.82,          // m: two bots will not claim spots closer than this (sofa cushions are 0.9 apart)
  favoriteBoost: 1.8,        // each bot, seeded by name, slightly prefers one activity
  // Idle bots standing near each other face one another and trade short bubbles.
  // ?chat=0 hides them, ?chat=1 shows them even if enabled is false here.
  chat: {
    enabled: true,
    range: 2.7,              // m: close enough to count as a conversation (sofa, coffee, a window pair)
    lineSec: 2.7,
    exchanges: 4,            // back and forth, then a pause
    cooldown: [10, 20],      // seconds before the same bot chats again
    gather: 1.85,            // extra weight on sofa / coffee / window / wall so they actually meet
    lines: [
      'coffee?',
      'five more minutes',
      'this view though',
      'you seeing this?',
      'nice one',
      'back in a bit',
      '☕?',
      'same, same',
      'one more minute',
      '👀',
      '咖啡嗎',
      '再坐一下',
      '今天還好嗎',
      '這窗景可以',
      '等一下就回去',
      '你先講',
      '哈哈好啊',
      '摸個魚 🐟',
    ],
  },
  // The manager. ?boss=0 turns the patrol off and he behaves like everyone else.
  // On error he stops walking; every other status he keeps patrolling.
  boss: {
    enabled: true,
    name: 'BIG Boss',
    speed: 1.05,
    stop: [2.2, 3.8],
    surprise: ['欸，我還在巡房', '放我下來啦'],
    replies: ['是的老闆', '馬上改', '收到老闆', '好的好的'],
    lines: {
      '圖片哥': ['圖片哥，這個配色又要突破天際了？', '十年賭場設計還是這麼敢，我佩服也擔心', '圖片哥，創新可以，別把客戶嚇跑'],
      '超級資深程式設計師': ['超級資深程式設計師，這次也是照辦就好？', '從不拒絕老闆，我都不好意思再加需求了', '你先點頭再做，記得喘口氣'],
      '數據分析師': ['數據分析師，這張圖的小數點又在生氣？', '每個圖都要挑，我的簡報都不敢交了', '數字很準，眉毛可以放鬆一點'],
      'G BO': ['G BO，去背又乾淨得不像話', '多尺寸一次出完，你是不是有分身？', '背景消失得太完美，我差點找不到圖'],
      'VBO': ['VBO，全端加 AI，今晚還睡得著嗎', '從模型到介面都你包，記得喝水', 'VBO，這個功能又是你一個人扛？'],
      '哥倫比亞-活動設計師': ['哥倫比亞的活動又要跟圖片哥聯手了？', '活動設計師，這波檔期先別跟圖片哥比大膽', '哥倫比亞那邊的案子，記得留一點留白'],
      'Grok Bot': ['Grok Bot，雜事又堆到你頭上了？', '萬能助手也要排隊休息', 'Grok Bot，先把手上的再丟給別人'],
      '新 Bot': ['新 Bot，第一天就這麼拼？', '新人不用一次學會全部', '新 Bot，迷路了就問，別硬撐'],
      '*': ['{name}，在忙什麼？', '{name}，過來讓我看一下', '{name}，做得不錯，再收一收'],
    },
  },
  drag: { enabled: true, surprise: ['咦？', '哇！', '放我下來'] },
  activities: {
    pace:    { enabled: true, weight: 1.15 },  // walk a loop around the lounge
    window:  { enabled: true, weight: 1.15 },  // stand at the glass, looking out
    stretch: { enabled: true, weight: 0.9 },   // stretch in an open spot
    coffee:  { enabled: true, weight: 1.05 },  // the bar: stand for a cup, or perch on the stool
    lean:    { enabled: true, weight: 1.0 },   // lean on the wall or the bookshelf
    sofa:    { enabled: true, weight: 1.15 },  // sit, and shift: look up, left, right
    wander:  { enabled: true, weight: 1.0 },   // slow walk along the open floor
  },
  roleBias: [
    { match: /visual|banner|design|art|illustrat/i, activity: 'window', mul: 2.2 },
    { match: /writer|editor|research|substack|idea|spark/i, activity: 'lean', mul: 1.7 },
    { match: /finance|analyst|buffett|ads|account/i, activity: 'coffee', mul: 1.55 },
    { match: /scout|trend|watch|coord/i, activity: 'wander', mul: 1.45 },
  ],
};

export function resolveIdleConfig(search = '') {
  const q = new URLSearchParams(search);
  const cfg = {
    sofaOnly: IDLE_CONFIG.sofaOnly,
    splitRecFloor: IDLE_CONFIG.splitRecFloor,
    duration: { ...IDLE_CONFIG.duration },
    separation: IDLE_CONFIG.separation,
    favoriteBoost: IDLE_CONFIG.favoriteBoost,
    activities: Object.fromEntries(Object.entries(IDLE_CONFIG.activities).map(([k, v]) => [k, { ...v }])),
    roleBias: IDLE_CONFIG.roleBias,
    chat: {
      ...IDLE_CONFIG.chat,
      cooldown: [...IDLE_CONFIG.chat.cooldown],
      lines: [...IDLE_CONFIG.chat.lines],
    },
    boss: {
      ...IDLE_CONFIG.boss,
      stop: [...IDLE_CONFIG.boss.stop],
      surprise: [...IDLE_CONFIG.boss.surprise],
      replies: [...IDLE_CONFIG.boss.replies],
      lines: Object.fromEntries(Object.entries(IDLE_CONFIG.boss.lines).map(([k, v]) => [k, [...v]])),
    },
    drag: { ...IDLE_CONFIG.drag, surprise: [...IDLE_CONFIG.drag.surprise] },
  };
  if (q.get('boss') === '0' || q.get('boss') === 'off') cfg.boss.enabled = false;
  if (q.get('drag') === '0' || q.get('drag') === 'off') cfg.drag.enabled = false;
  const mode = q.get('idle');
  if (mode === 'sofa' || mode === 'classic') cfg.sofaOnly = true;
  if (mode === 'live') cfg.sofaOnly = false;
  const chat = q.get('chat');
  if (chat === '0' || chat === 'off') cfg.chat.enabled = false;
  if (chat === '1' || chat === 'on') cfg.chat.enabled = true;
  const layout = q.get('layout');
  if (layout === 'split') cfg.splitRecFloor = true;
  if (layout === 'one' || layout === 'single') cfg.splitRecFloor = false;
  return cfg;
}

export function bossLine(name, cfg) {
  const lines = cfg?.lines || {};
  const list = lines[name] || lines['*'] || ['{name}，在忙什麼？'];
  const text = list[Math.floor(Math.random() * list.length)] || '';
  return text.replaceAll('{name}', name || '你');
}

export function idleActivitiesEnabled(cfg) {
  if (!cfg || cfg.sofaOnly) return false;
  return Object.values(cfg.activities).some((a) => a.enabled && a.weight > 0);
}
