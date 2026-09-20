import React from 'react';

/** 原创吉祥物“对对”：一张会眨眼的小文档。mood 决定表情 */
export type Mood = 'happy' | 'cheer' | 'think' | 'sleepy' | 'oops';

export function Mascot({ mood = 'happy', size = 120, className }: { mood?: Mood; size?: number; className?: string }) {
  const eye = (cx: number) => {
    if (mood === 'sleepy') return <path d={`M${cx - 7} 52 q7 6 14 0`} stroke="#4b4b4b" strokeWidth="3.5" fill="none" strokeLinecap="round" />;
    if (mood === 'cheer') return <path d={`M${cx - 7} 54 q7 -9 14 0`} stroke="#4b4b4b" strokeWidth="3.5" fill="none" strokeLinecap="round" />;
    const px = mood === 'think' ? cx + 3 : cx + 1, py = mood === 'think' ? 47 : 52;
    return (
      <g>
        <ellipse cx={cx} cy="51" rx="9.5" ry="11" fill="#fff" stroke="#4b4b4b" strokeWidth="2.5" />
        <circle cx={px} cy={py} r="5" fill="#4b4b4b" />
        <circle cx={px + 2} cy={py - 2.2} r="1.8" fill="#fff" />
      </g>
    );
  };
  const mouth =
    mood === 'cheer' ? <path d="M50 66 q10 14 20 0 z" fill="#ff4b4b" stroke="#4b4b4b" strokeWidth="2.5" strokeLinejoin="round" /> :
    mood === 'think' ? <ellipse cx="62" cy="69" rx="3.5" ry="3" fill="#4b4b4b" /> :
    mood === 'oops' ? <path d="M52 71 q8 -7 16 0" stroke="#4b4b4b" strokeWidth="3" fill="none" strokeLinecap="round" /> :
    mood === 'sleepy' ? <path d="M55 68 h10" stroke="#4b4b4b" strokeWidth="3" strokeLinecap="round" /> :
    <path d="M51 65 q9 10 18 0" stroke="#4b4b4b" strokeWidth="3" fill="none" strokeLinecap="round" />;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 120 120" aria-hidden>
      {/* 影子 */}
      <ellipse cx="60" cy="112" rx="30" ry="4.5" fill="#000" opacity=".08" />
      {/* 手臂 */}
      {mood === 'cheer' ? (
        <>
          <path d="M26 64 L12 40" stroke="#58cc02" strokeWidth="7" strokeLinecap="round" />
          <path d="M94 64 L108 40" stroke="#58cc02" strokeWidth="7" strokeLinecap="round" />
        </>
      ) : (
        <>
          <path d="M26 70 L16 84" stroke="#58cc02" strokeWidth="7" strokeLinecap="round" />
          <path d="M94 70 L104 84" stroke="#58cc02" strokeWidth="7" strokeLinecap="round" />
        </>
      )}
      {/* 脚 */}
      <rect x="40" y="100" width="14" height="10" rx="5" fill="#58a700" />
      <rect x="66" y="100" width="14" height="10" rx="5" fill="#58a700" />
      {/* 纸张身体 */}
      <path d="M32 14 h44 l18 18 v64 a8 8 0 0 1 -8 8 h-54 a8 8 0 0 1 -8 -8 v-74 a8 8 0 0 1 8 -8z" fill="#fff" stroke="#e5e5e5" strokeWidth="3" />
      <path d="M76 14 v12 a6 6 0 0 0 6 6 h12 z" fill="#58cc02" stroke="#58a700" strokeWidth="2" strokeLinejoin="round" />
      {/* 脸 */}
      {eye(49)}{eye(71)}
      <circle cx="38" cy="64" r="4.5" fill="#ffb3b3" opacity=".8" />
      <circle cx="82" cy="64" r="4.5" fill="#ffb3b3" opacity=".8" />
      {mouth}
      {/* 纸上的“差异”横线 */}
      <rect x="36" y="82" width="22" height="5" rx="2.5" fill="#ffcfcf" />
      <rect x="62" y="82" width="22" height="5" rx="2.5" fill="#c9f2a8" />
      <rect x="36" y="91" width="34" height="4" rx="2" fill="#e5e5e5" />
      {mood === 'sleepy' && <text x="92" y="30" fontSize="16" fontWeight="900" fill="#afafaf" fontFamily="Nunito, sans-serif">z</text>}
      {mood === 'think' && <><circle cx="98" cy="22" r="3" fill="#afafaf" /><circle cx="106" cy="12" r="4.5" fill="#afafaf" /></>}
    </svg>
  );
}

export function Confetti() {
  const colors = ['#58cc02', '#1cb0f6', '#ffc800', '#ff4b4b', '#ce82ff', '#ff9600'];
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: 70 }, (_, i) => (
        <i key={i} style={{
          left: `${(i * 37) % 100}%`, background: colors[i % colors.length],
          animationDelay: `${(i % 14) * 0.07}s`, animationDuration: `${1.6 + (i % 5) * 0.25}s`,
          transform: `rotate(${i * 29}deg)`, width: 6 + (i % 3) * 3, height: 10 + (i % 4) * 2,
        }} />
      ))}
    </div>
  );
}
