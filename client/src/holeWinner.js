// Shared match-play hole logic used by both the live Match page and the
// global offline-sync flusher. Pure functions — no Firebase, no React.

// Running match-play status string, e.g. "2UP thru 11", "3&2", "All Square".
// holeResults: map of holeNum -> { holeWinner }.
export function computeMatchStatus(holeResults) {
  let diff = 0;
  let holesPlayed = 0;
  for (let h = 1; h <= 18; h++) {
    const hole = holeResults?.[h];
    if (!hole?.holeWinner) continue;
    holesPlayed++;
    if (hole.holeWinner === 'teamA') diff++;
    else if (hole.holeWinner === 'teamB') diff--;
    // Match decided once the lead exceeds the holes remaining
    const margin = Math.abs(diff);
    const remaining = 18 - holesPlayed;
    if (margin > remaining) return `${margin}&${remaining}`;
  }
  if (holesPlayed === 0) return 'All Square';
  if (diff === 0) return `All Square thru ${holesPlayed}`;
  const margin = Math.abs(diff);
  return `${margin}UP thru ${holesPlayed}`;
}

// Yellow-ball carrier for a team on a given hole (rotation repeats).
function carrierFor(match, round, holeNum, team) {
  const order = (match.carrierOrder || round?.carrierOrder)?.[team];
  if (!order?.length) return null;
  return order[(holeNum - 1) % order.length];
}

// Compute the outcome fields to write for a hole, given the full holes map for
// the match (matchHoles[holeNum] holds the entered scores). Returns the fields
// to merge in — { holeWinner, matchStatus? , ybNetA?, ybNetB? } — or null when
// the hole isn't complete yet (not everyone has entered).
export function computeHoleOutcome(match, round, matchHoles, holeNum) {
  const format = match.format;
  const teamAIds = match.teamA?.playerIds || [];
  const teamBIds = match.teamB?.playerIds || [];
  const scores = matchHoles?.[holeNum] || {};
  const isTeamEntry = format === 'foursomes' || format === 'scramble';

  if (isTeamEntry) {
    const a = scores.teamA;
    const b = scores.teamB;
    if (a?.net == null || b?.net == null) return null;
    const winner = a.net < b.net ? 'teamA' : a.net > b.net ? 'teamB' : 'half';
    if (format === 'scramble') return { holeWinner: winner }; // stroke play, no match status
    return { holeWinner: winner, matchStatus: computeMatchStatus({ ...matchHoles, [holeNum]: { holeWinner: winner } }) };
  }

  if (format === 'yellowball') {
    const cA = carrierFor(match, round, holeNum, 'teamA');
    const cB = carrierFor(match, round, holeNum, 'teamB');
    const ybNetA = scores[cA]?.net;
    const ybNetB = scores[cB]?.net;
    if (ybNetA == null || ybNetB == null) return null;
    const winner = ybNetA < ybNetB ? 'teamA' : ybNetA > ybNetB ? 'teamB' : 'half';
    return { holeWinner: winner, ybNetA, ybNetB };
  }

  // fourball / singles — best net ball per team
  const aNets = teamAIds.map((id) => scores[id]?.net).filter((n) => n != null);
  const bNets = teamBIds.map((id) => scores[id]?.net).filter((n) => n != null);
  if (aNets.length < teamAIds.length || bNets.length < teamBIds.length) return null;
  const bestA = Math.min(...aNets);
  const bestB = Math.min(...bNets);
  const winner = bestA < bestB ? 'teamA' : bestA > bestB ? 'teamB' : 'half';
  return { holeWinner: winner, matchStatus: computeMatchStatus({ ...matchHoles, [holeNum]: { holeWinner: winner } }) };
}
