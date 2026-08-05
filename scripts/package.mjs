/**
 * Package script - generates browser-specific ZIP packages from dist output.
 * T25 will enhance with hash recording and full validation.
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const browser = process.argv[2];
if (!browser || !['chrome', 'edge', 'firefox'].includes(browser)) {
  console.error('Usage: node scripts/package.mjs <chrome|edge|firefox>');
  process.exit(1);
}

const distDir = resolve(rootDir, 'dist', browser);
const outDir = resolve(rootDir, 'dist', 'packages');

if (!existsSync(distDir)) {
  console.error(`Build output not found: ${distDir}. Run build:${browser} first.`);
  process.exit(1);
}

if (!existsSync(outDir)) {
  mkdirSync(outDir, { recursive: true });
}

// Read manifest to get version
const manifestPath = resolve(distDir, 'manifest.json');
if (!existsSync(manifestPath)) {
  console.error(`manifest.json not found in ${distDir}`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const version = manifest.version || '0.0.0';
const packageName = `tab-bookmark-shortcuts-v${version}-${browser}.zip`;
const packagePath = resolve(outDir, packageName);

// Dynamic import for adm-zip
const { default: AdmZip } = await import('adm-zip');
const zip = new AdmZip();
zip.addLocalFolder(distDir);
zip.writeZip(packagePath);

console.log(`Package created: ${packagePath}`);
console.log(`Browser: ${browser}, Version: ${version}`);
