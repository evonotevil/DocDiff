// 平台差异集中处理（Windows 适配预埋）：快捷键显示、平台标记
const api = (window as any).api || {};
export const platform: string = api.platform || 'darwin';
export const isMac = platform === 'darwin';
export const isWin = platform === 'win32';

/** 'mod+shift+O' → macOS "⇧⌘O"，Windows "Ctrl+Shift+O" */
export function kbd(combo: string): string {
  const parts = combo.split('+');
  const key = parts.pop()!;
  const mods = parts.map((m) => m.toLowerCase());
  if (isMac) {
    const order: [string, string][] = [['ctrl', '⌃'], ['alt', '⌥'], ['shift', '⇧'], ['mod', '⌘']];
    return order.filter(([m]) => mods.includes(m)).map(([, s]) => s).join('') + key.toUpperCase();
  }
  const names: Record<string, string> = { mod: 'Ctrl', ctrl: 'Ctrl', shift: 'Shift', alt: 'Alt' };
  return [...mods.map((m) => names[m] || m), key.toUpperCase()].join('+');
}

/** 键盘事件是否按下了平台主修饰键（macOS ⌘ / Windows Ctrl） */
export const modPressed = (e: KeyboardEvent | React.KeyboardEvent) => (isMac ? e.metaKey : e.ctrlKey);

export function applyPlatformClass() {
  document.documentElement.dataset.platform = isMac ? 'mac' : isWin ? 'win' : 'linux';
}
