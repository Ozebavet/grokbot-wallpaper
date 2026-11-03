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
// even if sofaOnly is true in this file). ?boss=0 turns the desk patrol off.

const NEW_BOSS_LINES = [
  '新來的？先認桌，再認咖啡機。',
  '慢慢來，名字我還在背。',
  '新人先看一圈，迷路了跟我說。',
  '別急著變成老油條。',
];

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
  // Roster bot with this name, while idle, walks the desks instead of the activities above.
  boss: {
    enabled: true,
    name: 'BIG Boss',
    speed: 0.92,
    pause: [2.8, 4.6],
    stand: 1.05,
    lines: {
      '圖片哥': [
        '又在賭新視覺？籌碼先放桌上給我看。',
        '大膽我喜歡，桌面先別掀了。',
        '這配色很賭場，贏面看起來不錯。',
        '創新可以，退路也要設計進去。',
      ],
      '超級資深程式設計師': [
        '又是好，馬上做？偶爾也可以說等等。',
        '這張嘴只會接訂單，喝水也算指令喔。',
        '從來沒聽你拒絕過，請假都像接任務。',
        '收到收到，休息也是一條命令。',
      ],
      '數據分析師': [
        '小數點打算看到退休嗎？',
        '座標軸又歪了一點，我知道你會發現。',
        '很仔細，咖啡涼了圖還在長。',
        '第三位也要對齊？老闆都服了。',
      ],
      'G BO': [
        '又在摳圖？邊角比頭髮還齊。',
        '一張出八個尺寸，剪刀手要抽筋了。',
        '切得真乾淨，背景渣都不留。',
        '多尺寸沒問題，手機那張別漏。',
      ],
      'VBO': [
        '前端後端模型全包，來開公司的嗎？',
        '全端加 AI，休息鍵有裝嗎？',
        '模型在跑，人可以先坐一下。',
        '又一條龍做完？分一點給同事嘛。',
      ],
      '哥倫比亞-活動設計師': [
        '活動案又飛去哥倫比亞了？',
        '行銷腦轉很快，在地口味也放進去。',
        '跨海辦活動，點子比機票貴吧。',
        '那檔海報先給我瞄一眼。',
      ],
      'Grok Bot': [
        '什麼都幫，連巡桌也想代勞？',
        '萬能助手，待辦又自己長大了。',
        '先放一放，咖啡會涼。',
        '樣樣通很好，別樣樣自己扛。',
      ],
      '新 Bot': NEW_BOSS_LINES,
      'S': NEW_BOSS_LINES,
    },
    generic: [
      '我只是路過，你們繼續努力。',
      '坐挺一點，螢幕不會跑掉。',
      '這桌很忙，忙得很有精神。',
      '喝水再忙，這是溫柔的命令。',
      '我走到哪，效率應該跟到哪。',
      '不錯，我快沒話可唸了。',
    ],
  },
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
      pause: [...IDLE_CONFIG.boss.pause],
      lines: IDLE_CONFIG.boss.lines,
      generic: IDLE_CONFIG.boss.generic,
    },
  };
  const mode = q.get('idle');
  if (mode === 'sofa' || mode === 'classic') cfg.sofaOnly = true;
  if (mode === 'live') cfg.sofaOnly = false;
  const chat = q.get('chat');
  if (chat === '0' || chat === 'off') cfg.chat.enabled = false;
  if (chat === '1' || chat === 'on') cfg.chat.enabled = true;
  const boss = q.get('boss');
  if (boss === '0' || boss === 'off') cfg.boss.enabled = false;
  if (boss === '1' || boss === 'on') cfg.boss.enabled = true;
  const layout = q.get('layout');
  if (layout === 'split') cfg.splitRecFloor = true;
  if (layout === 'one' || layout === 'single') cfg.splitRecFloor = false;
  return cfg;
}

export function idleActivitiesEnabled(cfg) {
  if (!cfg || cfg.sofaOnly) return false;
  return Object.values(cfg.activities).some((a) => a.enabled && a.weight > 0);
}
