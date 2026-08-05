import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { SidebarApp } from './App';

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <SidebarApp />
    </StrictMode>,
  );
}
