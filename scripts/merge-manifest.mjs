/**
 * Merge base manifest with browser-specific overlay and write to dist output.
 * Also copies the static icons/ folder into dist so that runtime icon URLs
 * (e.g. icons/icon-128.png used by save notifications) resolve correctly.
 * Usage: node scripts/merge-manifest.mjs <chrome|edge|firefox>
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, copyFileSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const browser = process.argv[2];
if (!browser || !['chrome', 'edge', 'firefox'].includes(browser)) {
  console.error('Usage: node scripts/merge-manifest.mjs <chrome|edge|firefox>');
  process.exit(1);
}

const basePath = resolve(rootDir, 'manifests', 'base.json');
const overlayPath = resolve(rootDir, 'manifests', `${browser}.json`);
const outDir = resolve(rootDir, 'dist', browser);

if (!existsSync(basePath)) {
  console.error(`Base manifest not found: ${basePath}`);
  process.exit(1);
}

const base = JSON.parse(readFileSync(basePath, 'utf-8'));

let overlay = {};
if (existsSync(overlayPath)) {
  overlay = JSON.parse(readFileSync(overlayPath, 'utf-8'));
}

// Deep merge: overlay wins over base
function deepMerge(target, source) {
  const result = { ...target };
  for (const [key, value] of Object.entries(source)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
      result[key] = deepMerge(target[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

const merged = deepMerge(base, overlay);

// Remove Chromium-only fields for Firefox
if (browser === 'firefox') {
  delete merged.side_panel;
  // Firefox uses background.scripts instead of service_worker for MV3
  if (merged.background && merged.background.service_worker) {
    merged.background = { scripts: [merged.background.service_worker], type: 'module' };
  }
}

// Remove Firefox-only fields for Chromium
if (browser === 'chrome' || browser === 'edge') {
  delete merged.sidebar_action;
  delete merged.browser_specific_settings;
}

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

// Copy static assets (icons) into dist so runtime icon URLs resolve.
// These are not part of the Vite rollup inputs, so they must be copied manually.
const iconsSrc = resolve(rootDir, 'icons');
const iconsDest = resolve(outDir, 'icons');
if (existsSync(iconsSrc)) {
  if (!existsSync(iconsDest)) {
    mkdirSync(iconsDest, { recursive: true });
  }
  for (const entry of readdirSync(iconsSrc)) {
    const srcFile = join(iconsSrc, entry);
    if (statSync(srcFile).isFile()) {
      copyFileSync(srcFile, join(iconsDest, entry));
    }
  }
  console.log(`Icons copied: ${iconsSrc} -> ${iconsDest}`);
} else {
  console.warn(`Warning: icons source not found at ${iconsSrc} — notifications may fail to display`);
}

const outPath = resolve(outDir, 'manifest.json');
writeFileSync(outPath, JSON.stringify(merged, null, 2), 'utf-8');
console.log(`Manifest written: ${outPath} (${browser})`);

// Validate: must have manifest_version 3
if (merged.manifest_version !== 3) {
  console.error('ERROR: manifest_version must be 3');
  process.exit(1);
}

// Validate: must have 21 commands
const commandCount = Object.keys(merged.commands || {}).length;
if (commandCount !== 21) {
  console.error(`ERROR: Expected 21 commands, found ${commandCount}`);
  process.exit(1);
}

console.log(`Validation passed: manifest_version=3, commands=${commandCount}`);
