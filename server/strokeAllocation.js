// Computes which holes each player receives a stroke on for a given match.
// Returns { [playerId]: { holes: number[] } }
function computeStrokeAllocation(players, courseHoles, format) {
  const result = {};

  if (format === 'fourball' || format === 'singles') {
    // Find lowest handicap in the match
    const handicaps = players.map((p) => p.handicap);
    const minHcp = Math.min(...handicaps);

    // Sort holes by strokeIndex ascending (SI 1 = hardest = first stroke given)
    const holesSortedBySI = [...courseHoles].sort((a, b) => a.strokeIndex - b.strokeIndex);

    for (const player of players) {
      const strokes = player.handicap - minHcp;
      const strokeHoles = holesSortedBySI.slice(0, strokes).map((h) => h.number);
      result[player.id] = { holes: strokeHoles };
    }
  } else if (format === 'foursomes') {
    // One allocation per pairing (combined hcp / 2), lower pairing plays off scratch
    // players array expected as two pairings: [[p1,p2],[p3,p4]]
    // For foursomes we store allocation keyed by a synthetic pairing id
    const pairings = players; // [{id, combinedHcp}]
    const minHcp = Math.min(...pairings.map((p) => p.combinedHcp));
    const holesSortedBySI = [...courseHoles].sort((a, b) => a.strokeIndex - b.strokeIndex);

    for (const pairing of pairings) {
      const strokes = pairing.combinedHcp - minHcp;
      const strokeHoles = holesSortedBySI.slice(0, strokes).map((h) => h.number);
      result[pairing.id] = { holes: strokeHoles };
    }
  }

  return result;
}

module.exports = { computeStrokeAllocation };
