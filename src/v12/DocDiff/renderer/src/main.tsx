import React from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/nunito/latin-600.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-800.css';
import '@fontsource/nunito/latin-900.css';
import App from './App';
import { applyPlatformClass } from './lib/platform';
import './styles.css';

applyPlatformClass();
createRoot(document.getElementById('root')!).render(<App />);
