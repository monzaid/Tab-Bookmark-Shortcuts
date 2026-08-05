import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SettingsApp } from './App';

// Import styles
import '@ui/styles/base.css';
import '@ui/styles/settings.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <SettingsApp />
    </StrictMode>,
  );
}
