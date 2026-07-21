// Pure match-scoring logic used when closing a round.
// No Firebase access — takes plain data, returns plain results — so it is unit-testable.

// Compute one match's final result at round close.
// match: { format, holeCount? } · matchHoles: holes/{matchId} node · round: { pointsValue, segmentPoints? }
// Returns { result: { winner, points, segments? }, teamA_pts, teamB_pts }
function computeMatchResult(match, matchHoles, round) {
  const pts = parseFloat(round?.pointsValue) || 1;

  // Fourball with segment scoring: award Front 9 / Back 9 / Overall separately
  if (match.format === 'fourball' && round?.segmentPoints) {
    const segDefs = [
      ['front', 1, 9],
      ['back', 10, 18],
      ['overall', 1, 18],
    ];
    const segments = {};
    let matchA = 0, matchB = 0;
    for (const [key, startH, endH] of segDefs) {
      const segPts = parseFloat(round.segmentPoints[key]) || 0;
      let aHoles = 0, bHoles = 0;
      for (let h = startH; h <= endH; h++) {
        const hw = matchHoles[h]?.holeWinner;
        if (hw === 'teamA') aHoles++;
        else if (hw === 'teamB') bHoles++;
      }
      const segWinner = aHoles > bHoles ? 'teamA' : bHoles > aHoles ? 'teamB' : 'half';
      segments[key] = { winner: segWinner, points: segPts };
      if (segWinner === 'teamA') matchA += segPts;
      else if (segWinner === 'teamB') matchB += segPts;
      else { matchA += segPts / 2; matchB += segPts / 2; }
    }
    const winner = matchA > matchB ? 'teamA' : matchB > matchA ? 'teamB' : 'half';
    return {
      result: { winner, points: matchA + matchB, segments },
      teamA_pts: matchA,
      teamB_pts: matchB,
    };
  }

  let winner;

  if (match.format === 'yellowball') {
    // Lower cumulative net yellow-ball score wins
    let cumA = 0, cumB = 0;
    for (let h = 1; h <= 18; h++) {
      if (matchHoles[h]?.ybNetA != null) cumA += matchHoles[h].ybNetA;
      if (matchHoles[h]?.ybNetB != null) cumB += matchHoles[h].ybNetB;
    }
    winner = cumA < cumB ? 'teamA' : cumA > cumB ? 'teamB' : 'half';
  } else if (match.format === 'scramble') {
    // Lower cumulative team gross over the configured hole count wins
    const n = match.holeCount === 9 ? 9 : 18;
    let cumA = 0, cumB = 0;
    for (let h = 1; h <= n; h++) {
      if (matchHoles[h]?.teamA?.gross != null) cumA += matchHoles[h].teamA.gross;
      if (matchHoles[h]?.teamB?.gross != null) cumB += matchHoles[h].teamB.gross;
    }
    winner = cumA < cumB ? 'teamA' : cumA > cumB ? 'teamB' : 'half';
  } else {
    // Match play: team with more holes won takes the match
    let aHoles = 0, bHoles = 0;
    for (let h = 1; h <= 18; h++) {
      const hw = matchHoles[h]?.holeWinner;
      if (hw === 'teamA') aHoles++;
      else if (hw === 'teamB') bHoles++;
    }
    winner = aHoles > bHoles ? 'teamA' : bHoles > aHoles ? 'teamB' : 'half';
  }

  return {
    result: { winner, points: pts },
    teamA_pts: winner === 'teamA' ? pts : winner === 'half' ? pts / 2 : 0,
    teamB_pts: winner === 'teamB' ? pts : winner === 'half' ? pts / 2 : 0,
  };
}

module.exports = { computeMatchResult };
