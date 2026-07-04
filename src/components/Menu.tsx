import { useState } from 'react';

interface Props {
  onPlayAI: (level: number) => void;
  onPlayLocal: () => void;
  onTutorial: () => void;
  onChallenges: () => void;
  onToast: (msg: string) => void;
}

const LEVELS = [
  { n: 1, name: 'Novice', desc: 'Greedy — grabs the biggest capture' },
  { n: 2, name: 'Skilled', desc: 'Looks a few moves ahead' },
  { n: 3, name: 'Expert', desc: 'Deeper search, plans captures' },
  { n: 4, name: 'Master', desc: 'Full-strength search' },
];

function Diamond() {
  return <span className="diamond" aria-hidden>◇</span>;
}

export default function Menu({ onPlayAI, onPlayLocal, onTutorial, onChallenges, onToast }: Props) {
  const [pickAI, setPickAI] = useState(false);

  return (
    <div className="screen menu">
      <div className="menu-top">
        <div className="chip chip-avatar">
          <span className="avatar" aria-hidden />
          <span className="chip-body">
            <span className="chip-name">Player123</span>
            <span className="chip-rating">★ 1250</span>
          </span>
        </div>
        <div className="menu-top-right">
          <button className="icon-btn" onClick={() => onToast('Leaderboards — coming soon')} aria-label="Leaderboards">🏆</button>
          <button className="icon-btn" onClick={() => onToast('Stats — coming soon')} aria-label="Stats">📊</button>
          <button className="icon-btn" onClick={() => onToast('Settings — coming soon')} aria-label="Settings">⚙️</button>
        </div>
      </div>

      <div className="menu-hero">
        <div className="hero-ornament"><Diamond /><span className="rule" /><Diamond /></div>
        <h1 className="title">AWALÉ</h1>
        <p className="tagline">The strategy. The culture. The legacy.</p>
      </div>

      {!pickAI ? (
        <div className="menu-actions">
          <button className="pill pill-green" onClick={() => onToast('Quick Match — coming soon')}>
            <span className="pill-icon">⚔️</span>
            <span className="pill-body"><span className="pill-title">PLAY NOW</span><span className="pill-sub">Quick Match · coming soon</span></span>
          </button>
          <button className="pill" onClick={onPlayLocal}>
            <span className="pill-icon">👥</span>
            <span className="pill-body"><span className="pill-title">TWO PLAYERS</span><span className="pill-sub">Pass &amp; play on this device</span></span>
          </button>
          <button className="pill" onClick={() => setPickAI(true)}>
            <span className="pill-icon">🤖</span>
            <span className="pill-body"><span className="pill-title">PLAY VS AI</span><span className="pill-sub">Choose difficulty</span></span>
          </button>
          <button className="pill" onClick={onTutorial}>
            <span className="pill-icon">🎓</span>
            <span className="pill-body"><span className="pill-title">LEARN</span><span className="pill-sub">Interactive tutorial</span></span>
          </button>
        </div>
      ) : (
        <div className="menu-actions">
          <div className="level-head">
            <button className="back-link" onClick={() => setPickAI(false)}>← Back</button>
            <span>Choose difficulty</span>
          </div>
          {LEVELS.map(l => (
            <button key={l.n} className="pill pill-level" onClick={() => onPlayAI(l.n - 1)}>
              <span className="level-badge">{l.n}</span>
              <span className="pill-body">
                <span className="pill-title">{l.name}</span>
                <span className="pill-sub">{l.desc}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="menu-cards">
        <button className="info-card" onClick={onChallenges}>
          <span className="info-icon">🧩</span>
          <span><strong>Challenges</strong><br /><span className="muted">12 puzzles to solve</span></span>
        </button>
        <button className="info-card" onClick={() => onToast('Leaderboard — coming soon')}>
          <span className="info-icon">🏆</span>
          <span><strong>Leaderboard</strong><br /><span className="muted">Compete for the top</span></span>
        </button>
        <button className="info-card" onClick={() => onToast('Ranks — coming soon')}>
          <span className="info-icon">👑</span>
          <span><strong>Climb the Ranks</strong><br /><span className="muted">Become the champion</span></span>
        </button>
      </div>
    </div>
  );
}
