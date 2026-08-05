import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ImportPreviewTable } from './App';

// Import styles
import '@ui/styles/base.css';
import '@ui/styles/import-preview.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <ImportPreviewTable
        preview={{ valid: true, slotConflicts: [], newSlots: [], rules: [], globalStrategy: 'B', configVersion: 0 }}
        onCommit={async () => {}}
        onCancel={() => window.close()}
      />
    </StrictMode>,
  );
}
