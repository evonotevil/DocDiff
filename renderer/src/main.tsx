import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/latin-900.css';
import '@fontsource/noto-sans-sc/400.css';
import '@fontsource/noto-sans-sc/700.css';
import '@fontsource/noto-sans-sc/800.css';
import '@fontsource/noto-sans-sc/900.css';
import App from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { applyPlatformClass } from './lib/platform';
import { initSettings } from './lib/persist';
import { migrateLegacyReviews } from './lib/review';
import './styles.css';

applyPlatformClass();
// 1.7.3：设置和审阅记录改存到应用数据目录；第一次运行时把旧版 localStorage 里的数据搬过去
initSettings();
migrateLegacyReviews();
createRoot(document.getElementById('root')!).render(<ErrorBoundary><App /></ErrorBoundary>);
