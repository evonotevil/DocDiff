import React from 'react';
const S = (p: { d: React.ReactNode; size?: number; vb?: string }) => (
  <svg width={p.size || 16} height={p.size || 16} viewBox={p.vb || '0 0 16 16'} fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round">{p.d}</svg>
);
export const IconRich = () => <S d={<><rect x="3" y="1.8" width="10" height="12.4" rx="1.6" /><path d="M5.5 5h5M5.5 7.5h5M5.5 10h3" /></>} />;
export const IconPlain = () => <S d={<path d="M3 4h10M3 7h7M3 10h10M3 13h5" />} />;
export const IconRedline = () => <S d={<><rect x="1.8" y="3.2" width="12.4" height="9.6" rx="1.6" /><path d="M4.5 6.5h7M4.5 9.5h4.5" /></>} />;
export const IconImage = () => <S d={<><rect x="1.8" y="3" width="12.4" height="10" rx="1.6" /><circle cx="6.5" cy="8" r="2" fill="currentColor" stroke="none" /><path d="M1.8 5.5h1.5" /></>} />;
export const IconOcr = () => <S d={<><path d="M2 5V3.5C2 2.7 2.7 2 3.5 2H5M11 2h1.5c.8 0 1.5.7 1.5 1.5V5M14 11v1.5c0 .8-.7 1.5-1.5 1.5H11M5 14H3.5C2.7 14 2 13.3 2 12.5V11" /><path d="M5 6.5h6M5 9.5h4" /></>} />;
export const IconDetails = () => <S d={<><rect x="3" y="1.8" width="10" height="12.4" rx="1.6" /><path d="M5.5 5h5M5.5 7.5h5M5.5 10h5" /></>} />;
export const IconUpload = () => <S d={<><path d="M8 10V2.5M5 5.5l3-3 3 3" /><path d="M2.5 10.5v2c0 .6.4 1 1 1h9c.6 0 1-.4 1-1v-2" /></>} />;
export const IconSwap = () => <S d={<><path d="M2.5 5.5h10M10 3l2.5 2.5L10 8" /><path d="M13.5 10.5h-10M6 8l-2.5 2.5L6 13" /></>} />;
export const IconSun = () => <S d={<><circle cx="8" cy="8" r="3" /><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" /></>} />;
export const IconMoon = () => <S d={<path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" />} />;
export const IconMinus = () => <S d={<><circle cx="8" cy="8" r="6" /><path d="M5.5 8h5" /></>} />;
export const IconPlus = () => <S d={<><circle cx="8" cy="8" r="6" /><path d="M5.5 8h5M8 5.5v5" /></>} />;
export const IconUp = () => <S d={<path d="M4 10l4-4 4 4" />} />;
export const IconDown = () => <S d={<path d="M4 6l4 4 4-4" />} />;
export const IconCheck = () => <S d={<path d="M3 8.5l3 3 7-7" />} />;
export const IconX = () => <S d={<path d="M4 4l8 8M12 4l-8 8" />} />;
export const IconExport = () => <S d={<><path d="M8 2.5V10M5 7l3 3 3-3" /><path d="M2.5 10.5v2c0 .6.4 1 1 1h9c.6 0 1-.4 1-1v-2" /></>} />;
export const IconPlusDoc = () => <S d={<path d="M8 3v10M3 8h10" />} />;
export const IconFile = () => <S size={22} d={<><path d="M4 1.8h5.2L12.5 5v8.2c0 .6-.4 1-1 1h-7.5c-.6 0-1-.4-1-1V2.8c0-.6.4-1 1-1Z" /><path d="M9 1.8V5h3.5" /></>} />;
export const IconFormat = () => <S d={<path d="M4 13l4-10 4 10M5.6 9h4.8" />} />;
export const IconMove = () => <S d={<path d="M8 2v12M5 5l3-3 3 3M5 11l3 3 3-3" />} />;
export const IconEdit = () => <S d={<path d="M10.5 2.5l3 3L6 13H3v-3z" />} />;
export const Logo = () => (
  <svg width="22" height="22" viewBox="0 0 22 22"><rect x="1" y="1" width="20" height="20" rx="5" fill="#12a594" /><path d="M6.5 7h5M6.5 10.5h9M6.5 14h6.5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /><circle cx="15.5" cy="7" r="1.6" fill="#ffd2c7" /></svg>
);

// ---------- 彩色模式图标（Duolingo 风格） ----------
const C = ({ children }: { children: React.ReactNode }) => <svg width="30" height="30" viewBox="0 0 32 32" aria-hidden>{children}</svg>;
export const ModeRich = () => (
  <C><rect x="5" y="3" width="22" height="26" rx="5" fill="#1cb0f6" /><rect x="5" y="3" width="22" height="23" rx="5" fill="#49c0f8" />
    <rect x="9" y="8" width="14" height="3" rx="1.5" fill="#fff" /><rect x="9" y="13.5" width="9" height="3" rx="1.5" fill="#ffb1b1" /><rect x="9" y="19" width="12" height="3" rx="1.5" fill="#b8f28b" /></C>
);
export const ModePlain = () => (
  <C><rect x="4" y="4" width="24" height="24" rx="6" fill="#afafaf" /><rect x="4" y="4" width="24" height="21" rx="6" fill="#e5e5e5" />
    <rect x="8" y="9" width="3" height="3" rx="1" fill="#afafaf" /><rect x="13" y="9" width="11" height="3" rx="1.5" fill="#777" />
    <rect x="8" y="15" width="3" height="3" rx="1" fill="#afafaf" /><rect x="13" y="15" width="7" height="3" rx="1.5" fill="#777" /></C>
);
export const ModeRedline = () => (
  <C><rect x="4" y="4" width="24" height="24" rx="6" fill="#e5b400" /><rect x="4" y="4" width="24" height="21" rx="6" fill="#ffc800" />
    <rect x="8" y="9" width="16" height="3" rx="1.5" fill="#fff" /><path d="M8 17.5 h11" stroke="#ff4b4b" strokeWidth="3" strokeLinecap="round" />
    <path d="M18 21 l6 -9 2 1.4 -6 9 -2.6 1z" fill="#4b4b4b" /></C>
);
export const ModeImage = () => (
  <C><rect x="3" y="5" width="26" height="22" rx="5" fill="#1899d6" /><rect x="3" y="5" width="26" height="19" rx="5" fill="#84d8ff" />
    <circle cx="22" cy="11" r="3" fill="#ffc800" /><path d="M3 20 l8 -7 7 6 4 -3 7 6 v0 a5 5 0 0 1 -5 2 h-16 a5 5 0 0 1 -5 -4z" fill="#58cc02" /></C>
);
export const ModeOcr = () => (
  <C><path d="M5 11 V8 a3 3 0 0 1 3 -3 h3 M21 5 h3 a3 3 0 0 1 3 3 v3 M27 21 v3 a3 3 0 0 1 -3 3 h-3 M11 27 h-3 a3 3 0 0 1 -3 -3 v-3" stroke="#ce82ff" strokeWidth="3.5" fill="none" strokeLinecap="round" />
    <rect x="10" y="11" width="12" height="3" rx="1.5" fill="#a560e8" /><rect x="10" y="17" width="8" height="3" rx="1.5" fill="#a560e8" /></C>
);
export const ModeDetails = () => (
  <C><rect x="4" y="4" width="24" height="24" rx="12" fill="#e08600" /><rect x="4" y="4" width="24" height="22" rx="11" fill="#ff9600" />
    <circle cx="16" cy="10.5" r="2.2" fill="#fff" /><rect x="14" y="14" width="4" height="9" rx="2" fill="#fff" /></C>
);
export const FileGlyph = ({ type, size = 44 }: { type: string; size?: number }) => {
  const c = type === 'docx' ? ['#1cb0f6', '#1899d6'] : type === 'pdf' ? ['#ff4b4b', '#ea2b2b'] : ['#afafaf', '#8f8f8f'];
  return (
    <svg width={size} height={size} viewBox="0 0 44 44" aria-hidden>
      <path d="M10 3 h17 l10 10 v25 a4 4 0 0 1 -4 4 h-23 a4 4 0 0 1 -4 -4 v-31 a4 4 0 0 1 4 -4z" fill={c[1]} />
      <path d="M10 3 h17 l10 10 v22 a4 4 0 0 1 -4 4 h-23 a4 4 0 0 1 -4 -4 v-28 a4 4 0 0 1 4 -4z" fill={c[0]} />
      <path d="M27 3 v7 a3 3 0 0 0 3 3 h7z" fill="#fff" opacity=".45" />
      <text x="21" y="31" textAnchor="middle" fontFamily="Nunito, sans-serif" fontWeight="900" fontSize="9" fill="#fff">{type.toUpperCase()}</text>
    </svg>
  );
};
export const IconPaste = () => <S d={<><rect x="3.5" y="2.8" width="9" height="11.4" rx="1.6" /><path d="M6 2.8h4v2H6z M6 8h4 M6 10.5h3" /></>} />;
export const IconCopy = () => <S d={<><rect x="5" y="5" width="8.5" height="9" rx="1.6" /><path d="M3 11V3.5c0-.8.7-1.5 1.5-1.5H10" /></>} />;
export const IconGear = () => <S d={<><circle cx="8" cy="8" r="2.2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></>} />;
export const IconClock = () => <S d={<><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></>} />;
export const IconRefresh = () => <S d={<><path d="M13 8a5 5 0 1 1-1.5-3.5" /><path d="M13 2.5v3h-3" /></>} />;
export const IconKeyboard = () => <S d={<><rect x="1.8" y="4" width="12.4" height="8" rx="1.6" /><path d="M4.5 7h.01M7 7h.01M9.5 7h.01M12 7h.01M5 9.5h6" /></>} />;
export const IconChevronLeft = () => <S d={<path d="M10 3L5 8l5 5" />} />;
export const IconChevronRight = () => <S d={<path d="M6 3l5 5-5 5" />} />;
export const IconPanelLeft = () => <S d={<><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" /><path d="M6 2.8v10.4" /></>} />;
export const IconPanelRight = () => <S d={<><rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.6" /><path d="M10 2.8v10.4" /></>} />;
