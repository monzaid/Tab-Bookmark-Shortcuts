import { defineWorkspace } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

const alias = {
  '@shared': resolve(__dirname, 'src/shared'),
  '@adapters': resolve(__dirname, 'src/adapters'),
  '@background': resolve(__dirname, 'src/background'),
  '@content': resolve(__dirname, 'src/content'),
  '@ui': resolve(__dirname, 'src/ui'),
};

export default defineWorkspace([
  {
    plugins: [react()],
    resolve: { alias },
    test: {
      name: 'unit',
      include: ['tests/unit/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['tests/setup.ts'],
      globals: true,
    },
  },
  {
    plugins: [react()],
    resolve: { alias },
    test: {
      name: 'integration',
      include: ['tests/integration/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['tests/setup.ts'],
      globals: true,
    },
  },
  {
    plugins: [react()],
    resolve: { alias },
    test: {
      name: 'ui-smoke',
      include: ['tests/ui-smoke/**/*.test.{ts,tsx}'],
      environment: 'jsdom',
      setupFiles: ['tests/setup.ts'],
      globals: true,
    },
  },
]);
