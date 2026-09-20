import React from 'react';
// 与应用图标（build/icon.png）同一份图形
import markSvg from '../assets/logo-mark.svg?raw';

const sized = (h: number) => markSvg.replace('<svg ', `<svg width="${Math.round(h * 824 / 852)}" height="${h}" `);

export function LogoMark({ size = 36 }: { size?: number }) {
  return <span className="logo-mark" style={{ width: Math.round(size * 824 / 852), height: size }} dangerouslySetInnerHTML={{ __html: sized(size) }} aria-hidden />;
}

export function Wordmark({ size = 34, sub }: { size?: number; sub?: string }) {
  return (
    <span className="wordmark">
      <LogoMark size={size} />
      <span className="wm-text">docdiff</span>
      {sub && <small>{sub}</small>}
    </span>
  );
}
