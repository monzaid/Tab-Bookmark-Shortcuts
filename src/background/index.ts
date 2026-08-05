/**
 * Background Service Worker entry point.
 * Creates the Chrome adapter and bootstraps the WorkerOrchestrator,
 * which registers all event listeners (commands, messages, tab cleanup).
 */

import { createChromeAdapter } from '@adapters/chrome-adapter';
import { detectBrowserType } from '@adapters/contract';
import { bootstrapWorker } from './worker-orchestrator';

const browserType = detectBrowserType();
const adapter = createChromeAdapter(browserType);

bootstrapWorker(adapter);
