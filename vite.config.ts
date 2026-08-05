import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PreRenderedChunk } from 'rollup';

const __dirname = dirname(fileURLToPath(import.meta.url));

const targetBrowser = process.env.TARGET_BROWSER || 'chrome';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@adapters': resolve(__dirname, 'src/adapters'),
      '@background': resolve(__dirname, 'src/background'),
      '@content': resolve(__dirname, 'src/content'),
      '@ui': resolve(__dirname, 'src/ui'),
    },
  },
  define: {
    'process.env.TARGET_BROWSER': JSON.stringify(targetBrowser),
  },
  build: {
    outDir: `dist/${targetBrowser}`,
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background/index.ts'),
        content: resolve(__dirname, 'src/content/index.ts'),
        sidebar: resolve(__dirname, 'src/ui/sidebar/index.html'),
        settings: resolve(__dirname, 'src/ui/settings/index.html'),
        recovery: resolve(__dirname, 'src/ui/recovery/index.html'),
        'import-preview': resolve(__dirname, 'src/ui/import-preview/index.html'),
        'candidate-selector': resolve(__dirname, 'src/ui/candidate-selector/index.html'),
        'conflict-confirm': resolve(__dirname, 'src/ui/conflict-confirm/index.html'),
      },
      output: {
        entryFileNames: (chunkInfo: PreRenderedChunk) => {
          if (chunkInfo.name === 'background') return 'background.js';
          if (chunkInfo.name === 'content') return 'content.js';
          return 'assets/[name]-[hash].js';
        },
      },
    },
  },
});
