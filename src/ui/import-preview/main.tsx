import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ImportPreviewTable } from './App';
import { DEFAULT_MATCH_SETTINGS } from '@shared/types';

// Import styles
import '@ui/styles/base.css';
import '@ui/styles/import-preview.css';

const rootElement = document.getElementById('root');
if (rootElement) {
  createRoot(rootElement).render(
    <StrictMode>
      <ImportPreviewTable
        preview={{
            valid: true,
            slotConflicts: [],
            newSlots: [],
            rules: [],
            matchSettings: DEFAULT_MATCH_SETTINGS,
            switchDirection: 'next',
            autoBindGlobal: true,
            configVersion: 0,
            domainViolations: [],
          }}
        onCommit={async () => {}}
        onCancel={() => window.close()}
      />
    </StrictMode>,
  );
}
