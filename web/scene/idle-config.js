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
  duration: { min: 10, max: 30 },
  separation: 0.82,          // m: two bots will not claim spots closer than this (sofa cushions are 0.9 apart)
  favoriteBoost: 1.8,        // each bot, seeded by name, slightly prefers one activity
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
  const cfg = {
    sofaOnly: IDLE_CONFIG.sofaOnly,
    duration: { ...IDLE_CONFIG.duration },
    separation: IDLE_CONFIG.separation,
    favoriteBoost: IDLE_CONFIG.favoriteBoost,
    activities: Object.fromEntries(Object.entries(IDLE_CONFIG.activities).map(([k, v]) => [k, { ...v }])),
    roleBias: IDLE_CONFIG.roleBias,
  };
  const mode = new URLSearchParams(search).get('idle');
  if (mode === 'sofa' || mode === 'classic') cfg.sofaOnly = true;
  if (mode === 'live') cfg.sofaOnly = false;
  return cfg;
}

export function idleActivitiesEnabled(cfg) {
  if (!cfg || cfg.sofaOnly) return false;
  return Object.values(cfg.activities).some((a) => a.enabled && a.weight > 0);
}
