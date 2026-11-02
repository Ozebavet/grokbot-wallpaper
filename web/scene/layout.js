// Optional second floor. Off by default: every bot stays on the floor its group already
// assigned (one shared Office floor). When splitRecFloor is on, idle bots are shown on a
// lounge floor and everyone else stays on the office floor. The journal is not rewritten;
// this is only the view passed to the scene and the panels.

function countsOf(ids, bots) {
  const counts = { working: 0, idle: 0, waiting_user: 0, error: 0, stuck: 0, done: 0 };
  for (const id of ids) {
    const s = bots[id].effective_status || bots[id].status;
    if (counts[s] != null) counts[s]++;
  }
  return counts;
}

export function presentState(state, cfg) {
  if (!state || !cfg?.splitRecFloor) return state;
  const bots = {};
  const officeIds = [];
  const recIds = [];
  const source = Object.entries(state.bots || {});
  for (const [id, bot] of source) {
    const copy = { ...bot };
    const idle = (copy.effective_status || copy.status) === 'idle';
    copy.floor = idle ? 'rec' : 'office';
    bots[id] = copy;
    (idle ? recIds : officeIds).push(id);
  }
  // Desks are unique per floor. Splitting one floor in two would otherwise leave gaps, and
  // merging several source floors would stack two bots on desk 1.
  officeIds.forEach((id, i) => { bots[id].desk = i + 1; });
  recIds.forEach((id, i) => { bots[id].desk = i + 1; });
  const officeName = state.floors?.length === 1 ? state.floors[0].name : 'Office';
  return {
    ...state,
    bots,
    floors: [
      { id: 'office', name: officeName, order: 1, bots: officeIds, counts: countsOf(officeIds, bots), free_desks: Math.max(0, 20 - officeIds.length) },
      { id: 'rec', name: 'Lounge', order: 2, bots: recIds, counts: countsOf(recIds, bots), free_desks: Math.max(0, 20 - recIds.length) },
    ],
  };
}
