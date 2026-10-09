export interface ShuffleSession {
  playlistId: number;
  order: string[];
  index: number;
}

function shuffled(ids: string[], random: () => number): string[] {
  const order = [...ids];
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order;
}

/** A device-local playback queue; never changes the saved playlist order. */
export function stepShuffle(
  session: ShuffleSession | null,
  playlistId: number,
  trackIds: string[],
  currentId: string | null,
  direction: 1 | -1,
  auto: boolean,
  random: () => number = Math.random,
): { session: ShuffleSession | null; trackId: string | null } {
  if (!trackIds.length) return { session: null, trackId: null };
  const current = currentId && trackIds.includes(currentId) ? currentId : null;
  const canReuse = session?.playlistId === playlistId
    && (session.index < 0 ? current === null : session.order[session.index] === current);
  let order: string[];
  let index: number;
  if (canReuse && session) {
    order = session.order.filter(id => trackIds.includes(id));
    index = current ? order.indexOf(current) : -1;
    // Newly added tracks join the remaining queue; removed tracks disappear.
    const known = new Set(order);
    order.push(...shuffled(trackIds.filter(id => !known.has(id)), random));
  } else {
    order = current
      ? [current, ...shuffled(trackIds.filter(id => id !== current), random)]
      : shuffled(trackIds, random);
    index = current ? 0 : -1;
  }
  let next = index + direction;
  if (direction === -1 && next < 0) {
    // With no earlier playback history, restart the current/first track.
    next = Math.max(0, index);
  } else if (next >= order.length) {
    if (auto) return { session: { playlistId, order, index }, trackId: null };
    // Manual Next begins another shuffled pass, avoiding an immediate repeat.
    order = current
      ? [current, ...shuffled(trackIds.filter(id => id !== current), random)]
      : shuffled(trackIds, random);
    next = current && order.length > 1 ? 1 : 0;
  }
  return { session: { playlistId, order, index: next }, trackId: order[next] };
}
