import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { computeSkinsResult } from '../skinsCompute';
import styles from './SkinsBetCard.module.css';

function teamColor(players, id) {
  return players[id]?.teamId === 'teamA' ? 'var(--teamA)' : 'var(--teamB)';
}

function firstName(players, id) {
  return players[id]?.name?.split(' ')[0] || id;
}

function fmtPayout(n) {
  if (Math.abs(n) < 0.01) return 'Even';
  const abs = Number.isInteger(Math.abs(n)) ? `$${Math.abs(n)}` : `$${Math.abs(n).toFixed(2)}`;
  return n > 0 ? `+${abs}` : `-${abs}`;
}

const FORMAT_LABEL = {
  fourball: 'Four-Ball', foursomes: 'Foursomes',
  singles: 'Singles', yellowball: 'Yellow Ball',
};

// holeData: holes for this specific match (holes/{matchId})
// matches + rounds: optional — if provided, renders a link to the match
export default function SkinsBetCard({ bet, holeData, players, matches, rounds }) {
  const [expanded, setExpanded] = useState(false);

  const sh = bet.startHole ?? 1;
  const eh = bet.endHole ?? 18;

  const result = useMemo(
    () => computeSkinsResult(holeData, bet.players || [], bet.amount, sh, eh),
    [holeData, bet, sh, eh],
  );
  const { holeResults, skinsWon, payouts, pendingCarryover } = result;

  const totalSkins = Object.values(skinsWon).reduce((a, b) => a + b, 0);
  const holesPlayed = holeResults.filter(r => r.status !== 'pending').length;
  const totalHoles = eh - sh + 1;

  const sortedPlayers = [...(bet.players || [])].sort(
    (a, b) => (skinsWon[b] || 0) - (skinsWon[a] || 0)
  );

  const match = matches?.[bet.matchId];
  const round = match && rounds?.[match.roundId];
  const rangeLabel = sh === 1 && eh === 18 ? null : `Holes ${sh}–${eh}`;

  return (
    <div className={styles.skinsCard}>
      <div className={styles.skinsHeader}>
        <div className={styles.skinsHeaderLeft}>
          <span className={styles.skinsTitle}>
            Skins · ${bet.amount}/skin{rangeLabel ? ` · ${rangeLabel}` : ''}
          </span>
          {match && round && (
            <Link to={`/match/${bet.matchId}`} className={styles.matchLink}>
              Round {round.order}: {FORMAT_LABEL[match.format] || match.format}
            </Link>
          )}
        </div>
        <span className={styles.skinsMeta}>{holesPlayed}/{totalHoles} played</span>
      </div>

      <div className={styles.skinsPlayers}>
        {sortedPlayers.map(pid => {
          const skins = skinsWon[pid] || 0;
          const payout = payouts[pid] || 0;
          return (
            <div key={pid} className={styles.skinsPlayerRow}>
              <span className={styles.skinsPlayerName} style={{ color: teamColor(players, pid) }}>
                {firstName(players, pid)}
              </span>
              <span className={styles.skinsDots}>
                {Array.from({ length: Math.max(totalSkins, 1) }, (_, i) => (
                  <span key={i} className={`${styles.skinsDot} ${i < skins ? styles.skinsDotFilled : ''}`} />
                ))}
              </span>
              <span className={styles.skinsCount}>{skins} {skins === 1 ? 'skin' : 'skins'}</span>
              <span className={`${styles.skinsPayout} ${payout > 0 ? styles.skinsPos : payout < 0 ? styles.skinsNeg : styles.skinsEven}`}>
                {fmtPayout(payout)}
              </span>
            </div>
          );
        })}
      </div>

      {pendingCarryover > 1 && (
        <div className={styles.skinsCarry}>
          🔥 {pendingCarryover} {pendingCarryover === 1 ? 'skin' : 'skins'} carrying
        </div>
      )}

      {holesPlayed > 0 && (
        <button className={styles.skinsExpandBtn} onClick={() => setExpanded(e => !e)}>
          {expanded ? '▲ Hide hole results' : `▼ Hole results (${holesPlayed} played)`}
        </button>
      )}

      {expanded && (
        <div className={styles.skinsHoleList}>
          {holeResults.map(r => {
            if (r.status === 'pending') return null;
            const isCarry = r.status === 'tied';
            return (
              <div key={r.hole} className={`${styles.skinsHoleRow} ${isCarry ? styles.skinsHoleCarry : ''}`}>
                <span className={styles.skinsHoleNum}>{r.hole}</span>
                {isCarry ? (
                  <span className={styles.skinsHoleStatus}>Tied — carry →</span>
                ) : (
                  <span className={styles.skinsHoleStatus} style={{ color: teamColor(players, r.winner) }}>
                    {firstName(players, r.winner)} wins
                  </span>
                )}
                <span className={styles.skinsHoleValue}>
                  {r.skinsValue > 1 ? `${r.skinsValue} skins` : '1 skin'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
