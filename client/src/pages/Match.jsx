import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ref, onValue, set, update } from 'firebase/database';
import { db } from '../firebase';
import TeamLogo from '../components/TeamLogo';
import styles from './Match.module.css';

// Compute match status string from hole results for four-ball / singles
function computeMatchStatus(holeResults, teamAIds, teamBIds) {
  let diff = 0; // positive = teamA up
  let holesPlayed = 0;
  for (let h = 1; h <= 18; h++) {
    const hole = holeResults?.[h];
    if (!hole?.holeWinner) continue;
    holesPlayed++;
    if (hole.holeWinner === 'teamA') diff++;
    else if (hole.holeWinner === 'teamB') diff--;
  }
  if (holesPlayed === 0) return 'All Square';
  const remaining = 18 - holesPlayed;
  if (diff === 0) return `All Square thru ${holesPlayed}`;
  const leader = diff > 0 ? 'A' : 'B';
  const margin = Math.abs(diff);
  if (margin > remaining) return `${margin}UP (closed)`;
  return `${margin}UP thru ${holesPlayed}`;
}

export default function Match({ playerId }) {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const [match, setMatch] = useState(null);
  const [holeData, setHoleData] = useState({});
  const [players, setPlayers] = useState({});
  const [courseHoles, setCourseHoles] = useState({});
  const [currentHole, setCurrentHole] = useState(1);
  const [entry, setEntry] = useState({ gross: '', fairwayHit: null, gir: false, putts: '' });

  useEffect(() => {
    const u1 = onValue(ref(db, `matches/${matchId}`), (s) => setMatch(s.val()));
    const u2 = onValue(ref(db, `holes/${matchId}`), (s) => setHoleData(s.val() || {}));
    const u3 = onValue(ref(db, 'players'), (s) => setPlayers(s.val() || {}));
    const u4 = onValue(ref(db, 'course/holes'), (s) => setCourseHoles(s.val() || {}));
    return () => { u1(); u2(); u3(); u4(); };
  }, [matchId]);

  if (!match) return <div className={styles.loading}>Loading match…</div>;

  const allPlayerIds = [...(match.teamA?.playerIds || []), ...(match.teamB?.playerIds || [])];
  const myAllocation = match.strokeAllocation?.[playerId]?.holes || [];
  const hole = courseHoles[currentHole] || {};
  const isPar3 = hole.par === 3;
  const receiveStroke = myAllocation.includes(currentHole);
  const gross = parseInt(entry.gross) || 0;
  const net = gross > 0 ? gross - (receiveStroke ? 1 : 0) : null;

  const isMyMatch = allPlayerIds.includes(playerId);
  const roundComplete = match.status === 'complete';

  async function submitHole() {
    if (!gross || !entry.putts) return;
    const holeRef = ref(db, `holes/${matchId}/${currentHole}/${playerId}`);
    await set(holeRef, {
      gross,
      net,
      fairwayHit: isPar3 ? null : entry.fairwayHit,
      gir: entry.gir,
      putts: parseInt(entry.putts),
    });

    // Compute hole winner from all players' net scores
    await computeAndWriteHoleWinner(currentHole);

    setEntry({ gross: '', fairwayHit: null, gir: false, putts: '' });
    if (currentHole < 18) setCurrentHole((h) => h + 1);
  }

  async function computeAndWriteHoleWinner(holeNum) {
    const snap = await new Promise((resolve) =>
      onValue(ref(db, `holes/${matchId}/${holeNum}`), resolve, { onlyOnce: true })
    );
    const scores = snap.val() || {};

    // For four-ball: best net from each team pairing
    const teamAIds = match.teamA?.playerIds || [];
    const teamBIds = match.teamB?.playerIds || [];

    const teamANets = teamAIds.map((id) => scores[id]?.net).filter((n) => n != null);
    const teamBNets = teamBIds.map((id) => scores[id]?.net).filter((n) => n != null);

    // Only compute when all players have submitted
    if (teamANets.length < teamAIds.length || teamBNets.length < teamBIds.length) return;

    const bestA = Math.min(...teamANets);
    const bestB = Math.min(...teamBNets);
    const winner = bestA < bestB ? 'teamA' : bestA > bestB ? 'teamB' : 'half';

    const holeRef = ref(db, `holes/${matchId}/${holeNum}`);
    const status = computeMatchStatus(
      { ...holeData, [holeNum]: { holeWinner: winner } },
      teamAIds,
      teamBIds
    );
    await update(holeRef, { holeWinner: winner, matchStatus: status });
  }

  const matchStatus = computeMatchStatus(holeData, match.teamA?.playerIds, match.teamB?.playerIds);

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/')}>‹ Back</button>
        <div className={styles.matchStatus}>{matchStatus}</div>
      </div>

      {/* Teams */}
      <div className={styles.teams}>
        <div className={`${styles.teamPill} ${styles.teamA}`}>
          {match.teamA?.playerIds?.map((id) => players[id]?.name || id).join(' & ')}
        </div>
        <div className={styles.vsLabel}>vs</div>
        <div className={`${styles.teamPill} ${styles.teamB}`}>
          {match.teamB?.playerIds?.map((id) => players[id]?.name || id).join(' & ')}
        </div>
      </div>

      {/* Hole selector */}
      <div className={styles.holeNav}>
        {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
          const played = !!holeData[h]?.holeWinner;
          return (
            <button
              key={h}
              className={`${styles.holeBtn} ${currentHole === h ? styles.holeCurrent : ''} ${played ? styles.holeDone : ''}`}
              onClick={() => setCurrentHole(h)}
            >
              {h}
            </button>
          );
        })}
      </div>

      {/* Current hole info */}
      <div className={styles.holeInfo}>
        <span className={styles.holeLabel}>Hole {currentHole}</span>
        <span className={styles.holePar}>Par {hole.par || '—'}</span>
        <span className={styles.holeSI}>SI {hole.strokeIndex || '—'}</span>
        {receiveStroke && <span className={styles.strokeDot}>+1 stroke</span>}
      </div>

      {/* Score entry — only for match participants */}
      {isMyMatch && !roundComplete && (
        <div className={styles.entryCard}>
          <div className={styles.entryLabel}>Your score — {players[playerId]?.name}</div>

          <div className={styles.field}>
            <label>Gross score</label>
            <div className={styles.stepper}>
              <button onClick={() => setEntry((e) => ({ ...e, gross: Math.max(1, (parseInt(e.gross) || 0) - 1) }))}>−</button>
              <span className={styles.stepperVal}>{entry.gross || '—'}</span>
              <button onClick={() => setEntry((e) => ({ ...e, gross: (parseInt(e.gross) || 0) + 1 }))}>+</button>
            </div>
          </div>

          {net !== null && (
            <div className={styles.netScore}>Net: {net}{receiveStroke ? ' (stroke)' : ''}</div>
          )}

          {!isPar3 && (
            <div className={styles.field}>
              <label>Fairway hit?</label>
              <div className={styles.toggle}>
                <button
                  className={entry.fairwayHit === true ? styles.toggleOn : ''}
                  onClick={() => setEntry((e) => ({ ...e, fairwayHit: true }))}
                >Yes</button>
                <button
                  className={entry.fairwayHit === false ? styles.toggleOff : ''}
                  onClick={() => setEntry((e) => ({ ...e, fairwayHit: false }))}
                >No</button>
              </div>
            </div>
          )}

          <div className={styles.field}>
            <label>GIR?</label>
            <div className={styles.toggle}>
              <button
                className={entry.gir ? styles.toggleOn : ''}
                onClick={() => setEntry((e) => ({ ...e, gir: true }))}
              >Yes</button>
              <button
                className={!entry.gir ? styles.toggleOff : ''}
                onClick={() => setEntry((e) => ({ ...e, gir: false }))}
              >No</button>
            </div>
          </div>

          <div className={styles.field}>
            <label>Putts</label>
            <div className={styles.stepper}>
              <button onClick={() => setEntry((e) => ({ ...e, putts: Math.max(0, (parseInt(e.putts) || 0) - 1) }))}>−</button>
              <span className={styles.stepperVal}>{entry.putts !== '' ? entry.putts : '—'}</span>
              <button onClick={() => setEntry((e) => ({ ...e, putts: (parseInt(e.putts) || 0) + 1 }))}>+</button>
            </div>
          </div>

          <button
            className={styles.submitBtn}
            onClick={submitHole}
            disabled={!gross || entry.putts === ''}
          >
            Save Hole {currentHole}
          </button>
        </div>
      )}

      {/* Scorecard */}
      <div className={styles.scorecard}>
        <div className={styles.sectionLabel}>Scorecard</div>
        <div className={styles.scorecardGrid}>
          <div className={styles.scRow + ' ' + styles.scHeader}>
            <span>Hole</span>
            {allPlayerIds.map((id) => <span key={id}>{players[id]?.name?.split(' ')[0] || id}</span>)}
            <span>Win</span>
          </div>
          {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
            const hd = holeData[h] || {};
            const winner = hd.holeWinner;

            // Find which player(s) carried the hole (best net on their team)
            const carriers = new Set();
            ['teamA', 'teamB'].forEach((team) => {
              const ids = match[team]?.playerIds || [];
              const nets = ids.map((id) => ({ id, net: hd[id]?.net })).filter((x) => x.net != null);
              if (!nets.length) return;
              const best = Math.min(...nets.map((x) => x.net));
              nets.filter((x) => x.net === best).forEach((x) => carriers.add(x.id));
            });

            return (
              <div key={h} className={`${styles.scRow} ${h === currentHole ? styles.scCurrent : ''}`}>
                <span className={styles.scHole}>{h}</span>
                {allPlayerIds.map((id) => {
                  const s = hd[id];
                  const alloc = match.strokeAllocation?.[id]?.holes || [];
                  const isCarrier = carriers.has(id);
                  const isTeamA = match.teamA?.playerIds?.includes(id);
                  return (
                    <span
                      key={id}
                      className={`${styles.scScore} ${isCarrier ? (isTeamA ? styles.carrierA : styles.carrierB) : ''}`}
                    >
                      <span>{s ? s.gross : '—'}</span>
                      {alloc.includes(h) && <span className={styles.strokeMark}>●</span>}
                    </span>
                  );
                })}
                <span className={styles.scWinner}>
                  {winner === 'half' ? <span className={styles.halfMark}>½</span> : winner ? <TeamLogo teamId={winner} size={18} /> : null}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      <div className={styles.bottomPad} />
    </div>
  );
}
