/**
 * Nassau / Press computation utilities.
 * Pure functions — no Firebase, no React.
 */

/**
 * Compute match-play status for an arbitrary hole range between two players.
 *
 * @param {object} holeData  - holes/{matchId} Firebase value, keyed by hole number
 * @param {object} bet       - nassauBets record; needs .playerA, .playerB, .strokeAllocation
 * @param {number} startHole - first hole of segment (inclusive)
 * @param {number} endHole   - last hole of segment (inclusive)
 * @returns {{ winner: string, diff: number, holesPlayed: number, decided: boolean }}
 *   winner: 'playerA' | 'playerB' | 'half' | 'incomplete'
 *   diff: positive = playerA leads by that many holes, negative = playerB leads
 */
export function computeSegmentStatus(holeData, bet, startHole, endHole) {
  let diff = 0;
  let holesPlayed = 0;

  if (bet.mode === '2v2') {
    // Use pre-computed holeWinner ('teamA' | 'teamB' | 'half') instead of net scores
    for (let h = startHole; h <= endHole; h++) {
      const hw = holeData?.[h]?.holeWinner;
      if (!hw) continue;
      holesPlayed++;
      if (hw === 'teamA') diff++;
      else if (hw === 'teamB') diff--;
    }
  } else {
    const { playerA, playerB, strokeAllocation } = bet;
    const allocA = strokeAllocation?.[playerA]?.holes || [];
    const allocB = strokeAllocation?.[playerB]?.holes || [];

    for (let h = startHole; h <= endHole; h++) {
      const grossA = holeData?.[h]?.[playerA]?.gross;
      const grossB = holeData?.[h]?.[playerB]?.gross;
      if (grossA == null || grossB == null) continue;

      holesPlayed++;
      const netA = grossA - (allocA.includes(h) ? 1 : 0);
      const netB = grossB - (allocB.includes(h) ? 1 : 0);

      if (netA < netB) diff++;      // playerA wins hole
      else if (netB < netA) diff--; // playerB wins hole
    }
  }

  const totalHoles = endHole - startHole + 1;
  const remaining = totalHoles - holesPlayed;
  const margin = Math.abs(diff);
  const decided = margin > remaining;
  const complete = holesPlayed === totalHoles;

  let winner = 'incomplete';
  if (decided || complete) {
    if (diff > 0) winner = 'playerA';
    else if (diff < 0) winner = 'playerB';
    else winner = 'half';
  }

  return { winner, diff, holesPlayed, decided };
}

export const DEFAULT_COMPONENTS = [
  { label: 'Front 9', startHole: 1, endHole: 9 },
  { label: 'Back 9', startHole: 10, endHole: 18 },
  { label: 'Overall', startHole: 1, endHole: 18 },
];

/**
 * Compute status for each of a bet's components.
 * Returns an array of { label, startHole, endHole, status }.
 * Falls back to DEFAULT_COMPONENTS if bet.components is not set (backward compat).
 */
export function computeNassauStatus(holeData, bet) {
  const components = bet.components?.length ? bet.components : DEFAULT_COMPONENTS;
  return components.map(comp => ({
    ...comp,
    status: computeSegmentStatus(holeData, bet, comp.startHole, comp.endHole),
  }));
}

/**
 * Compute dollar payout from the result of computeNassauStatus.
 * Returns { [playerA_id]: delta, [playerB_id]: -delta }
 */
export function computeNassauPayout(componentStatuses, bet) {
  const { playerA, playerB, amount } = bet;
  let aTotal = 0;
  for (const { status } of componentStatuses) {
    if (status.winner === 'playerA') aTotal += amount;
    else if (status.winner === 'playerB') aTotal -= amount;
  }
  return { [playerA]: aTotal, [playerB]: -aTotal };
}

/**
 * Whether the presser is allowed to press a given segment or press.
 * They must be at least 2-down and there must be holes remaining.
 *
 * @param {object} segStatus - result of computeSegmentStatus
 * @param {boolean} presserIsPlayerA - is the player who wants to press playerA?
 * @param {number} startHole - start of the parent segment
 * @param {number} endHole   - end of the parent segment
 * @returns {boolean}
 */
export function canPress(segStatus, presserIsPlayerA, startHole, endHole) {
  if (segStatus.winner !== 'incomplete') return false; // already decided
  const totalHoles = endHole - startHole + 1;
  const remaining = totalHoles - segStatus.holesPlayed;
  if (remaining <= 0) return false;

  // presser must be 2-down (diff is from playerA's perspective)
  const presserDiff = presserIsPlayerA ? segStatus.diff : -segStatus.diff;
  return presserDiff <= -2;
}

/**
 * Compute dollar payout for a press.
 * A press inherits its nassauBet's amount.
 */
export function computePressPayout(pressStatus, nassauBet) {
  const { playerA, playerB, amount } = nassauBet;
  let aTotal = 0;
  if (pressStatus.winner === 'playerA') aTotal = amount;
  else if (pressStatus.winner === 'playerB') aTotal = -amount;
  return { [playerA]: aTotal, [playerB]: -aTotal };
}

/**
 * Get the segment hole range for a Nassau component name.
 */
export function segmentRange(segment) {
  if (segment === 'front') return { startHole: 1, endHole: 9 };
  if (segment === 'back') return { startHole: 10, endHole: 18 };
  return { startHole: 1, endHole: 18 }; // 'overall'
}

/**
 * Format a match-play status string, e.g. "2UP thru 7", "All Square", "Dormie 2", "Halved", "A wins 3&2"
 * playerAName / playerBName are first names.
 */
export function formatSegmentStatus(segStatus, playerAName, playerBName, startHole, endHole) {
  const { winner, diff, holesPlayed, decided } = segStatus;
  const totalHoles = endHole - startHole + 1;
  const remaining = totalHoles - holesPlayed;

  if (holesPlayed === 0) return 'Not started';

  if (winner === 'incomplete') {
    if (diff === 0) return `All Square thru ${startHole - 1 + holesPlayed}`;
    const leaderName = diff > 0 ? playerAName : playerBName;
    const margin = Math.abs(diff);
    if (remaining === margin) return `${leaderName} Dormie ${margin}`;
    return `${leaderName} ${margin}UP thru ${startHole - 1 + holesPlayed}`;
  }

  // winner is decided or complete
  if (winner === 'half') return 'Halved';

  const leaderName = diff > 0 ? playerAName : playerBName;
  const margin = Math.abs(diff);
  // "&X" only when decided early with holes still to play; "XUP" when match ran to the end
  if (decided && remaining > 0) return `${leaderName} wins ${margin}&${remaining}`;
  return `${leaderName} wins ${margin}UP`;
}
