// 本机保存的状态（1.7.3）：审阅记录、设置都存到应用数据目录（主进程原子写入）。
// 写失败不再静默——这里记下每一类数据最近一次保存的结果，界面据此显示非阻塞的警告。
import { useEffect, useState } from 'react';

const api = (window as any).api || {};

export type PersistKind = 'review' | 'settings' | 'recent';
export interface PersistState { review?: string; settings?: string; recent?: string } // 值为错误信息；没有 = 正常

let state: PersistState = {};
const subs = new Set<(s: PersistState) => void>();
export function setPersistStatus(kind: PersistKind, error: string | null) {
  const cur = state[kind];
  if ((error || undefined) === cur) return;
  state = { ...state, [kind]: error || undefined };
  subs.forEach((f) => f(state));
}
export function usePersistStatus(): PersistState {
  const [s, setS] = useState(state);
  useEffect(() => { subs.add(setS); return () => { subs.delete(setS); }; }, []);
  return s;
}
// 主进程写最近比较等文件时的结果
try { api.onPersistStatus?.((d: { kind: PersistKind; ok: boolean; error: string }) => setPersistStatus(d.kind, d.ok ? null : d.error)); } catch {}

// ---------- 设置 ----------
const LEGACY_KEYS = ['prefs-v2', 'theme', 'lang'];
let settings: Record<string, any> | null = null;

function lsGet(k: string): any { try { const v = localStorage.getItem(k); return v == null ? undefined : v; } catch { return undefined; } }

/** 启动时读一次；第一次运行 1.7.3 时把旧版 localStorage 里的设置搬过来 */
export function initSettings() {
  if (settings) return settings;
  if (!api.settingsGet) { settings = {}; return settings; }
  let s = null;
  try { s = api.settingsGet(); } catch {}
  if (s && typeof s === 'object') { settings = s; return settings; }
  settings = {};
  for (const k of LEGACY_KEYS) {
    const raw = lsGet(k);
    if (raw === undefined) continue;
    let v: any = raw;
    if (k === 'prefs-v2') { try { v = JSON.parse(raw); } catch { continue; } }
    settings[k] = v;
    void writeSetting(k, v);
  }
  return settings;
}

async function writeSetting(k: string, v: any) {
  try {
    const r = await api.settingsSet(k, v);
    setPersistStatus('settings', r?.ok === false ? r.error || 'unknown' : null);
  } catch (e: any) { setPersistStatus('settings', String(e?.message || e)); }
}

export function getSetting<T = any>(k: string): T | undefined {
  if (!api.settingsGet) return lsGet(k);
  return initSettings()[k];
}
export function setSetting(k: string, v: any) {
  if (!api.settingsSet) { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch {} return; }
  const s = initSettings();
  if (JSON.stringify(s[k]) === JSON.stringify(v)) return;
  s[k] = v;
  void writeSetting(k, v);
}
