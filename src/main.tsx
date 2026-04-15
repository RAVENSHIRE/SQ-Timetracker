import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Suppress benign WebSocket errors from Vite's HMR which is disabled in this environment
const suppressHmrErrors = (event: any) => {
  const message = event.reason?.message || event.message || String(event.reason || '');
  if (message.includes('WebSocket') || message.includes('HMR') || message.includes('ws://')) {
    event.preventDefault();
    event.stopPropagation();
  }
};

window.addEventListener('unhandledrejection', suppressHmrErrors);
window.addEventListener('error', suppressHmrErrors);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
