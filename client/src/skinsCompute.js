// Compute skins results from hole data.
// holeData: { [hole]: { [playerId]: { net } } }
// players: array of playerIds competing
// amount: dollars per skin
// startHole / endHole: hole range (default 1–18)
export function computeSkinsResult(holeData, players, amount, startHole = 1, endHole = 18) {
  let carryover = 1;
  const skinsWon = {}; // pid → skins count
  const holeResults = [];

  for (let h = startHole; h <= endHole; h++) {
    const nets = players.map(pid => ({
      pid,
      net: holeData?.[h]?.[pid]?.net ?? null,
    }));

    if (!nets.every(x => x.net != null)) {
      holeResults.push({ hole: h, status: 'pending', skinsValue: carryover });
      continue;
    }

    const minNet = Math.min(...nets.map(x => x.net));
    const winners = nets.filter(x => x.net === minNet);

    if (winners.length === 1) {
      const pid = winners[0].pid;
      skinsWon[pid] = (skinsWon[pid] || 0) + carryover;
      holeResults.push({ hole: h, status: 'won', winner: pid, skinsValue: carryover });
      carryover = 1;
    } else {
      holeResults.push({
        hole: h, status: 'tied', skinsValue: carryover,
        tiedPids: winners.map(x => x.pid),
      });
      carryover++;
    }
  }

  const totalWon = Object.values(skinsWon).reduce((a, b) => a + b, 0);
  const N = players.length;

  // net = amount × (won × N − totalWon)
  const payouts = {};
  players.forEach(pid => {
    const won = skinsWon[pid] || 0;
    payouts[pid] = amount * (won * N - totalWon);
  });

  // pendingCarryover > 1 means skins are carrying into the next unplayed hole
  return { holeResults, skinsWon, payouts, pendingCarryover: carryover };
}
