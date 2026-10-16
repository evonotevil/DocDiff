import React from 'react';
import { t } from '../lib/i18n';
import { Mascot } from './Mascot';

/**
 * 兜底（1.7.2）：界面渲染出错时不再整窗白屏，而是显示“对对”、一句话和一个按钮。
 * 文件、设置和审阅决定都保存在本机，重新载入不会丢。
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error, info: React.ErrorInfo) { console.error('DocDiff 渲染出错', err, info.componentStack); }
  render() {
    const { err } = this.state;
    if (!err) return this.props.children;
    return (
      <div className="app crash" role="alert">
        <Mascot mood="oops" size={120} />
        <h1>{t('界面出了点问题')}</h1>
        <p>{t('你的文件、设置和审阅决定都还在。重新载入后再比较一次就好。')}</p>
        <button className="btn primary big" onClick={() => location.reload()}>{t('重新载入')}</button>
        <details><summary>{t('技术信息')}</summary><pre>{String(err.stack || err.message || err)}</pre></details>
      </div>
    );
  }
}
