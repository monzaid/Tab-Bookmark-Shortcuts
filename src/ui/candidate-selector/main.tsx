import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { CandidateSelectorApp } from './App';

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <CandidateSelectorApp
        candidates={[]}
        mode="slot"
        onSwitch={() => {}}
        onClose={() => window.close()}
      />
    </StrictMode>,
  );
}
