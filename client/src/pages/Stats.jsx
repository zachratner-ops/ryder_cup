import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../firebase';
import styles from './Stats.module.css';

// ── helpers ────────────────────────────────────────────────────────────────

function avg(arr) {
  if (!arr.length) return null;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function fmtAvg(arr, decimals = 1) {
  const v = avg(arr);
  return v == null ? '—' : v.toFixed(decimals);
}

function fmtPct(hits, total) {
  if (!total) return '—';
  return `${Math.round((hits / total) * 100)}%`;
}

function fmtVsPar(arr) {
  const v = avg(arr);
  if (v == null) return { str: '—', cls: '' };
  const str = Math.abs(v) < 0.05 ? 'E' : v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
  const cls = v < -0.05 ? styles.under : v > 0.05 ? styles.over : styles.even;
  return { str, cls };
}

function fmtNet(v) {
  if (v == null) return '—';
  if (Math.abs(v) < 0.05) return 'E';
  return v > 0 ? `+${v.toFixed(1)}` : v.toFixed(1);
}

// ── Score distribution bar ─────────────────────────────────────────────────

const DIST_COLORS = {
  eagle:  '#ca8a04',
  birdie: '#16a34a',
  par:    'var(--border)',
  bogey:  '#f97316',
  double: '#dc2626',
};

const DIST_META = [
  { key: 'eagle',  label: 'Eagle+' },
  { key: 'birdie', label: 'Birdie' },
  { key: 'par',    label: 'Par'    },
  { key: 'bogey',  label: 'Bogey'  },
  { key: 'double', label: 'Dbl+'   },
];

function ScoreDistBar({ dist }) {
  const total = DIST_META.reduce((s, { key }) => s + dist[key], 0);
  if (!total) return null;
  return (
    <div className={styles.distWrap}>
      <div className={styles.distBar}>
        {DIST_META.filter(({ key }) => dist[key] > 0).map(({ key }) => (
          <div key={key} className={styles.distSeg} style={{ flex: dist[key], background: DIST_COLORS[key] }} />
        ))}
      </div>
      <div className={styles.distLabels}>
        {DIST_META.filter(({ key }) => dist[key] > 0).map(({ key, label }) => (
          <div key={key} className={styles.distItem}>
            <span className={styles.distDot} style={{ background: DIST_COLORS[key] }} />
            <span className={styles.distCount}>{dist[key]} {label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Award card ─────────────────────────────────────────────────────────────

function AwardCard({ icon, label, name, value, teamId }) {
  return (
    <div className={styles.awardCard}>
      <span className={styles.awardIcon}>{icon}</span>
      <span className={styles.awardLabel}>{label}</span>
      <span className={styles.awardName} style={{ color: teamId ? `var(--${teamId})` : 'var(--text-muted)' }}>
        {name || '—'}
      </span>
      <span className={styles.awardVal}>{value ?? '—'}</span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────

export default function Stats() {
  const [players, setPlayers]       = useState({});
  const [tournament, setTournament] = useState(null);
  const [allHoles, setAllHoles]     = useState({});
  const [matches, setMatches]       = useState({});
  const [courseHoles, setCourseHoles] = useState({});
  const [h2hA, setH2hA] = useState('');
  const [h2hB, setH2hB] = useState('');

  useEffect(() => {
    const u1 = onValue(ref(db, 'players'),     s => setPlayers(s.val() || {}));
    const u2 = onValue(ref(db, 'tournament'),  s => setTournament(s.val()));
    const u3 = onValue(ref(db, 'holes'),       s => setAllHoles(s.val() || {}));
    const u4 = onValue(ref(db, 'matches'),     s => setMatches(s.val() || {}));
    const u5 = onValue(ref(db, 'course/holes'), s => setCourseHoles(s.val() || {}));
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, []);

  // ── Per-player stats aggregation ──────────────────────────────────────────

  function getPlayerStats(playerId) {
    const s = {
      gross: [], netVsPar: [], putts: [],
      fairwayHits: 0, fairwayAttempts: 0,
      girHits: 0, girAttempts: 0,
      scramblingMade: 0, scramblingAttempts: 0,
      scoreDist: { eagle: 0, birdie: 0, par: 0, bogey: 0, double: 0 },
      holesWon: 0, holesLost: 0, holesHalved: 0,
      par3: [], par4: [], par5: [],
      threePutts: 0,
      total: 0,
    };

    for (const [matchId, matchHoles] of Object.entries(allHoles)) {
      const match = matches[matchId];
      const playerTeam = match?.teamA?.playerIds?.includes(playerId) ? 'teamA'
        : match?.teamB?.playerIds?.includes(playerId) ? 'teamB'
        : null;

      for (const [holeStr, holeScores] of Object.entries(matchHoles)) {
        const holeNum = parseInt(holeStr);
        const score = holeScores?.[playerId];
        const par = courseHoles[holeNum]?.par;
        if (!score?.gross) continue;

        s.total++;
        s.gross.push(score.gross);

        if (score.net != null && par) s.netVsPar.push(score.net - par);

        if (score.putts != null) {
          s.putts.push(score.putts);
          if (score.putts >= 3) s.threePutts++;
        }

        if (score.fairwayHit != null) {
          s.fairwayAttempts++;
          if (score.fairwayHit) s.fairwayHits++;
        }

        s.girAttempts++;
        if (score.gir) s.girHits++;

        if (!score.gir && par) {
          s.scramblingAttempts++;
          if (score.gross <= par) s.scramblingMade++;
        }

        if (par) {
          const diff = score.gross - par;
          if (diff <= -2)     s.scoreDist.eagle++;
          else if (diff === -1) s.scoreDist.birdie++;
          else if (diff === 0)  s.scoreDist.par++;
          else if (diff === 1)  s.scoreDist.bogey++;
          else                  s.scoreDist.double++;

          if (par === 3) s.par3.push(diff);
          else if (par === 4) s.par4.push(diff);
          else if (par === 5) s.par5.push(diff);
        }

        if (playerTeam) {
          const winner = holeScores.holeWinner;
          if (winner === playerTeam) s.holesWon++;
          else if (winner === 'half') s.holesHalved++;
          else if (winner && winner !== playerTeam) s.holesLost++;
        }
      }
    }

    return s;
  }

  const allStats = Object.fromEntries(
    Object.keys(players).map(id => [id, getPlayerStats(id)])
  );
  const playerList = Object.keys(players);
  const activePlayers = playerList.filter(id => allStats[id].total > 0);
  const hasData = activePlayers.length > 0;

  // ── Awards ────────────────────────────────────────────────────────────────

  function findAward(selector, compareFn) {
    const candidates = activePlayers
      .map(id => ({ id, val: selector(allStats[id]) }))
      .filter(({ val }) => val != null && !isNaN(val));
    if (!candidates.length) return null;
    return candidates.sort(compareFn)[0];
  }

  const mostBirdies   = findAward(s => (s.scoreDist.birdie + s.scoreDist.eagle) || null, (a, b) => b.val - a.val);
  const bestScrambler = findAward(s => s.scramblingAttempts >= 3 ? s.scramblingMade / s.scramblingAttempts : null, (a, b) => b.val - a.val);
  const bestPutter    = findAward(s => s.putts.length >= 9 ? avg(s.putts) : null, (a, b) => a.val - b.val);
  const threePuttKing = findAward(s => s.threePutts || null, (a, b) => b.val - a.val);
  const mostHolesWon  = findAward(s => s.holesWon || null, (a, b) => b.val - a.val);

  // Best single complete 18-hole gross total across all matches
  const bestRound = (() => {
    let best = null;
    for (const [matchId, matchHoles] of Object.entries(allHoles)) {
      for (const pid of activePlayers) {
        let total = 0, count = 0;
        for (let h = 1; h <= 18; h++) {
          const g = matchHoles[h]?.[pid]?.gross;
          if (g) { total += g; count++; }
        }
        if (count === 18 && (best === null || total < best.val)) {
          best = { id: pid, val: total };
        }
      }
    }
    return best;
  })();

  // ── Team aggregates ───────────────────────────────────────────────────────

  function teamAgg(teamId) {
    const pids = playerList.filter(id => players[id].teamId === teamId);
    const t = { fairwayHits: 0, fairwayAttempts: 0, girHits: 0, girAttempts: 0, putts: [], scramblingMade: 0, scramblingAttempts: 0, holesWon: 0 };
    for (const pid of pids) {
      const s = allStats[pid];
      if (!s) continue;
      t.fairwayHits += s.fairwayHits;
      t.fairwayAttempts += s.fairwayAttempts;
      t.girHits += s.girHits;
      t.girAttempts += s.girAttempts;
      t.putts.push(...s.putts);
      t.scramblingMade += s.scramblingMade;
      t.scramblingAttempts += s.scramblingAttempts;
      t.holesWon += s.holesWon;
    }
    return t;
  }

  const tA = teamAgg('teamA');
  const tB = teamAgg('teamB');
  const teamAName = tournament?.teamA?.name || 'Team A';
  const teamBName = tournament?.teamB?.name || 'Team B';

  function winner(aVal, bVal, lowerBetter = false) {
    if (aVal == null || bVal == null) return null;
    if (aVal === bVal) return 'tie';
    return (lowerBetter ? aVal < bVal : aVal > bVal) ? 'A' : 'B';
  }

  const battleRows = [
    { label: 'Fairways',   aVal: tA.fairwayAttempts   ? tA.fairwayHits / tA.fairwayAttempts     : null, bVal: tB.fairwayAttempts   ? tB.fairwayHits / tB.fairwayAttempts     : null, fmt: v => `${Math.round(v * 100)}%` },
    { label: 'GIR',        aVal: tA.girAttempts        ? tA.girHits / tA.girAttempts             : null, bVal: tB.girAttempts        ? tB.girHits / tB.girAttempts             : null, fmt: v => `${Math.round(v * 100)}%` },
    { label: 'Avg putts',  aVal: avg(tA.putts),                                                           bVal: avg(tB.putts),                                                           fmt: v => v.toFixed(2), lowerBetter: true },
    { label: 'Scrambling', aVal: tA.scramblingAttempts ? tA.scramblingMade / tA.scramblingAttempts : null, bVal: tB.scramblingAttempts ? tB.scramblingMade / tB.scramblingAttempts : null, fmt: v => `${Math.round(v * 100)}%` },
    { label: 'Holes won',  aVal: tA.holesWon,                                                             bVal: tB.holesWon,                                                             fmt: v => `${v}` },
  ];

  // ── Players sorted by net avg ─────────────────────────────────────────────

  const sortedPlayers = [...activePlayers].sort((a, b) => {
    const av = avg(allStats[a].netVsPar) ?? Infinity;
    const bv = avg(allStats[b].netVsPar) ?? Infinity;
    return av - bv;
  });

  // ── H2H ──────────────────────────────────────────────────────────────────

  const h2hAId = h2hA || playerList[0] || '';
  const h2hBId = h2hB || playerList[1] || '';
  const sA = h2hAId ? allStats[h2hAId] : null;
  const sB = h2hBId ? allStats[h2hBId] : null;

  const h2hRows = sA && sB && h2hAId !== h2hBId ? [
    { label: 'Net avg',    aVal: avg(sA.netVsPar),   bVal: avg(sB.netVsPar),   fmt: fmtNet, lowerBetter: true },
    { label: 'GIR',        aVal: sA.girAttempts ? sA.girHits / sA.girAttempts : null, bVal: sB.girAttempts ? sB.girHits / sB.girAttempts : null, fmt: v => `${Math.round(v * 100)}%` },
    { label: 'Fairways',   aVal: sA.fairwayAttempts ? sA.fairwayHits / sA.fairwayAttempts : null, bVal: sB.fairwayAttempts ? sB.fairwayHits / sB.fairwayAttempts : null, fmt: v => `${Math.round(v * 100)}%` },
    { label: 'Avg putts',  aVal: avg(sA.putts),       bVal: avg(sB.putts),       fmt: v => v.toFixed(2), lowerBetter: true },
    { label: 'Scrambling', aVal: sA.scramblingAttempts ? sA.scramblingMade / sA.scramblingAttempts : null, bVal: sB.scramblingAttempts ? sB.scramblingMade / sB.scramblingAttempts : null, fmt: v => `${Math.round(v * 100)}%` },
    { label: 'Holes won',  aVal: sA.holesWon,         bVal: sB.holesWon,         fmt: v => `${v}` },
  ] : null;

  // ── Render ────────────────────────────────────────────────────────────────

  if (!playerList.length) {
    return <div className={styles.page}><div className={styles.empty}>No tournament data yet</div></div>;
  }

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Stats</h1>

      {/* ── Awards ── */}
      {hasData && (
        <section>
          <div className={styles.sectionLabel}>Weekend Awards</div>
          <div className={styles.awardsGrid}>
            <AwardCard icon="🐦" label="Most Birdies"
              name={mostBirdies ? players[mostBirdies.id]?.name : null}
              value={mostBirdies?.val}
              teamId={mostBirdies ? players[mostBirdies.id]?.teamId : null}
            />
            <AwardCard icon="🏆" label="Most Holes Won"
              name={mostHolesWon ? players[mostHolesWon.id]?.name : null}
              value={mostHolesWon?.val}
              teamId={mostHolesWon ? players[mostHolesWon.id]?.teamId : null}
            />
            <AwardCard icon="🔥" label="Best Round"
              name={bestRound ? players[bestRound.id]?.name : null}
              value={bestRound?.val}
              teamId={bestRound ? players[bestRound.id]?.teamId : null}
            />
            <AwardCard icon="⛳" label="Fewest Putts"
              name={bestPutter ? players[bestPutter.id]?.name : null}
              value={bestPutter ? bestPutter.val.toFixed(2) : null}
              teamId={bestPutter ? players[bestPutter.id]?.teamId : null}
            />
            <AwardCard icon="🎯" label="Best Scrambler"
              name={bestScrambler ? players[bestScrambler.id]?.name : null}
              value={bestScrambler ? `${Math.round(bestScrambler.val * 100)}%` : null}
              teamId={bestScrambler ? players[bestScrambler.id]?.teamId : null}
            />
            <AwardCard icon="😬" label="3-Putt King"
              name={threePuttKing ? players[threePuttKing.id]?.name : null}
              value={threePuttKing ? `${threePuttKing.val}×` : null}
              teamId={threePuttKing ? players[threePuttKing.id]?.teamId : null}
            />
          </div>
        </section>
      )}

      {/* ── Team Battle ── */}
      {hasData && (
        <section>
          <div className={styles.sectionLabel}>Team Battle</div>
          <div className={styles.teamBattle}>
            <div className={styles.battleHeader}>
              <span className={styles.battleTeamA}>{teamAName}</span>
              <span />
              <span className={styles.battleTeamB}>{teamBName}</span>
            </div>
            {battleRows.map(({ label, aVal, bVal, fmt, lowerBetter }) => {
              const w = winner(aVal, bVal, lowerBetter);
              return (
                <div key={label} className={styles.battleRow}>
                  <span
                    className={styles.battleVal}
                    style={{
                      color: w === 'A' ? 'var(--teamA)' : 'var(--text-muted)',
                      fontWeight: w === 'A' ? 700 : 400,
                    }}
                  >
                    {aVal != null ? fmt(aVal) : '—'}
                  </span>
                  <span className={styles.battleLabel}>{label}</span>
                  <span
                    className={`${styles.battleVal} ${styles.battleValRight}`}
                    style={{
                      color: w === 'B' ? 'var(--teamB)' : 'var(--text-muted)',
                      fontWeight: w === 'B' ? 700 : 400,
                    }}
                  >
                    {bVal != null ? fmt(bVal) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Players ── */}
      {hasData && (
        <section>
          <div className={styles.sectionLabel}>Players — net avg</div>
          <div className={styles.playerList}>
            {sortedPlayers.map(id => {
              const p = players[id];
              const s = allStats[id];
              const netAvg = avg(s.netVsPar);
              const netStr = fmtNet(netAvg);
              const netCls = netAvg == null ? '' : netAvg < -0.05 ? styles.under : netAvg > 0.05 ? styles.over : styles.even;
              return (
                <div key={id} className={`${styles.playerCard} ${p.teamId === 'teamA' ? styles.playerCardA : styles.playerCardB}`}>
                  <div className={styles.playerHeader}>
                    <span className={styles.playerName}>{p.name}</span>
                    <div className={styles.playerNetWrap}>
                      <span className={`${styles.playerNet} ${netCls}`}>{netStr} net</span>
                      <span className={styles.playerHoles}>{s.total} holes</span>
                    </div>
                  </div>
                  <ScoreDistBar dist={s.scoreDist} />
                  <div className={styles.playerStatRow}>
                    <div className={styles.miniStat}>
                      <span className={styles.miniVal}>{fmtPct(s.fairwayHits, s.fairwayAttempts)}</span>
                      <span className={styles.miniLabel}>Fairways</span>
                    </div>
                    <div className={styles.miniStat}>
                      <span className={styles.miniVal}>{fmtPct(s.girHits, s.girAttempts)}</span>
                      <span className={styles.miniLabel}>GIR</span>
                    </div>
                    <div className={styles.miniStat}>
                      <span className={styles.miniVal}>{fmtPct(s.scramblingMade, s.scramblingAttempts)}</span>
                      <span className={styles.miniLabel}>Scramble</span>
                    </div>
                    <div className={styles.miniStat}>
                      <span className={styles.miniVal}>{fmtAvg(s.putts, 1)}</span>
                      <span className={styles.miniLabel}>Putts</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Par Type Splits ── */}
      {hasData && (
        <section>
          <div className={styles.sectionLabel}>Par Type Splits</div>
          <div className={styles.parTable}>
            <div className={`${styles.parRow} ${styles.parHeader}`}>
              <span />
              <span className={styles.parCell}>Par 3</span>
              <span className={styles.parCell}>Par 4</span>
              <span className={styles.parCell}>Par 5</span>
            </div>
            {sortedPlayers.map(id => {
              const p = players[id];
              const s = allStats[id];
              const p3 = fmtVsPar(s.par3);
              const p4 = fmtVsPar(s.par4);
              const p5 = fmtVsPar(s.par5);
              return (
                <div key={id} className={styles.parRow}>
                  <span className={styles.parName} style={{ color: `var(--${p.teamId})` }}>
                    {p.name.split(' ')[0]}
                  </span>
                  <span className={`${styles.parCell} ${p3.cls}`}>{p3.str}</span>
                  <span className={`${styles.parCell} ${p4.cls}`}>{p4.str}</span>
                  <span className={`${styles.parCell} ${p5.cls}`}>{p5.str}</span>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Head to Head ── */}
      <section>
        <div className={styles.sectionLabel}>Head to Head</div>
        <div className={styles.h2hPickers}>
          <select className={styles.h2hSelect} value={h2hAId} onChange={e => setH2hA(e.target.value)}>
            {playerList.map(id => <option key={id} value={id}>{players[id]?.name}</option>)}
          </select>
          <span className={styles.h2hVs}>vs</span>
          <select className={styles.h2hSelect} value={h2hBId} onChange={e => setH2hB(e.target.value)}>
            {playerList.map(id => <option key={id} value={id}>{players[id]?.name}</option>)}
          </select>
        </div>
        {h2hRows && (
          <div className={styles.h2hTable}>
            {h2hRows.map(({ label, aVal, bVal, fmt, lowerBetter }) => {
              const w = winner(aVal, bVal, lowerBetter);
              const aColor = w === 'A' ? `var(--${players[h2hAId]?.teamId})` : 'var(--text-muted)';
              const bColor = w === 'B' ? `var(--${players[h2hBId]?.teamId})` : 'var(--text-muted)';
              return (
                <div key={label} className={styles.h2hRow}>
                  <span className={styles.h2hVal} style={{ color: aColor, fontWeight: w === 'A' ? 700 : 400 }}>
                    {aVal != null ? fmt(aVal) : '—'}
                  </span>
                  <span className={styles.h2hLabel}>{label}</span>
                  <span className={`${styles.h2hVal} ${styles.h2hValRight}`} style={{ color: bColor, fontWeight: w === 'B' ? 700 : 400 }}>
                    {bVal != null ? fmt(bVal) : '—'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
        {h2hAId === h2hBId && <div className={styles.empty} style={{ padding: '20px' }}>Select two different players to compare</div>}
        {!hasData && <div className={styles.empty} style={{ padding: '20px' }}>No scores yet</div>}
      </section>

      {!hasData && (
        <div className={styles.empty}>No scores yet — check back once the first round is underway</div>
      )}

      <div className={styles.bottomPad} />
    </div>
  );
}
