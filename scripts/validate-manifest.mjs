/**
 * Manifest validation script.
 * Validates merged manifest for browser-specific correctness.
 * Usage: node scripts/validate-manifest.mjs <chrome|edge|firefox>
 */
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(__dirname, '..');

const browser = process.argv[2];
if (!browser || !['chrome', 'edge', 'firefox'].includes(browser)) {
  console.error('Usage: node scripts/validate-manifest.mjs <chrome|edge|firefox>');
  process.exit(1);
}

const manifestPath = resolve(rootDir, 'dist', browser, 'manifest.json');
if (!existsSync(manifestPath)) {
  // Try source manifests for pre-build validation
  const basePath = resolve(rootDir, 'manifests', 'base.json');
  const overlayPath = resolve(rootDir, 'manifests', `${browser}.json`);
  if (!existsSync(basePath)) {
    console.error(`Base manifest not found: ${basePath}`);
    process.exit(1);
  }
  console.log(`Dist manifest not found, validating source manifests for ${browser}...`);
  validateSourceManifests(basePath, overlayPath, browser);
  process.exit(0);
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
const errors = validateManifest(manifest, browser);

if (errors.length > 0) {
  console.error(`Manifest validation FAILED for ${browser}:`);
  errors.forEach((e) => console.error(`  ✕ ${e}`));
  process.exit(1);
}

console.log(`Manifest validation PASSED for ${browser}`);
console.log(`  manifest_version: ${manifest.manifest_version}`);
console.log(`  commands: ${Object.keys(manifest.commands || {}).length}`);
console.log(`  background: ${JSON.stringify(manifest.background)}`);
console.log(`  content_scripts: ${manifest.content_scripts?.length ?? 0}`);

function validateSourceManifests(basePath, overlayPath, browser) {
  const base = JSON.parse(readFileSync(basePath, 'utf-8'));
  const overlay = existsSync(overlayPath) ? JSON.parse(readFileSync(overlayPath, 'utf-8')) : {};
  const errors = [];

  // Validate base
  if (base.manifest_version !== 3) {
    errors.push('base.json: manifest_version must be 3');
  }

  const commandCount = Object.keys(base.commands || {}).length;
  if (commandCount !== 21) {
    errors.push(`base.json: Expected 21 commands, found ${commandCount}`);
  }

  // B5: incognito must be declared EXPLICITLY as not_allowed.
  // Omitting the key means "spanning" by default, which previously made
  // incognito.isAllowed() unconditionally return true (silent over-permission).
  if (!Object.prototype.hasOwnProperty.call(base, 'incognito')) {
    errors.push('base.json: Must explicitly declare "incognito" (missing key implies allowed)');
  } else if (base.incognito !== 'not_allowed') {
    errors.push(`base.json: "incognito" must be "not_allowed", found ${JSON.stringify(base.incognito)}`);
  }

  // Validate browser-specific constraints
  if (browser === 'firefox') {
    if (overlay.side_panel) {
      errors.push('firefox.json: Must NOT contain side_panel (Chromium-only field)');
    }
    if (!overlay.sidebar_action) {
      errors.push('firefox.json: Must contain sidebar_action');
    }
    if (base.background?.service_worker && !overlay.background) {
      // Firefox MV3 uses background.scripts, not service_worker
      errors.push('firefox.json: Should override background for Firefox MV3 compatibility');
    }
  }

  if (browser === 'chrome' || browser === 'edge') {
    if (overlay.sidebar_action) {
      errors.push(`${browser}.json: Must NOT contain sidebar_action (Firefox-only field)`);
    }
    if (overlay.browser_specific_settings) {
      errors.push(`${browser}.json: Must NOT contain browser_specific_settings (Firefox-only field)`);
    }
  }

  if (errors.length > 0) {
    console.error(`Source manifest validation FAILED for ${browser}:`);
    errors.forEach((e) => console.error(`  ✕ ${e}`));
    process.exit(1);
  }

  console.log(`Source manifest validation PASSED for ${browser}`);
}

function validateManifest(manifest, browser) {
  const errors = [];

  // Required fields
  if (manifest.manifest_version !== 3) {
    errors.push('manifest_version must be 3');
  }

  if (!manifest.name) {
    errors.push('name is required');
  }

  if (!manifest.version) {
    errors.push('version is required');
  }

  // Commands: must be exactly 21
  const commands = manifest.commands || {};
  const commandCount = Object.keys(commands).length;
  if (commandCount !== 21) {
    errors.push(`Expected 21 commands, found ${commandCount}`);
  }

  // Verify all slot commands exist
  for (let i = 1; i <= 10; i++) {
    if (!commands[`save-slot-${i}`]) errors.push(`Missing command: save-slot-${i}`);
    if (!commands[`switch-slot-${i}`]) errors.push(`Missing command: switch-slot-${i}`);
  }
  if (!commands['next-match']) errors.push('Missing command: next-match');

  // Background
  if (browser === 'firefox') {
    if (manifest.background?.service_worker) {
      errors.push('Firefox: background.service_worker should be converted to background.scripts');
    }
  } else {
    if (!manifest.background?.service_worker) {
      errors.push('Chromium: background.service_worker is required');
    }
  }

  // Content scripts
  if (!manifest.content_scripts || manifest.content_scripts.length === 0) {
    errors.push('content_scripts is required');
  } else {
    const cs = manifest.content_scripts[0];
    if (cs.run_at !== 'document_start') {
      errors.push('content_scripts[0].run_at must be document_start');
    }
  }

  // Permissions
  const requiredPerms = ['tabs', 'windows', 'storage', 'notifications'];
  for (const perm of requiredPerms) {
    if (!manifest.permissions?.includes(perm)) {
      errors.push(`Missing permission: ${perm}`);
    }
  }

  // Host permissions
  if (!manifest.host_permissions?.includes('<all_urls>')) {
    errors.push('Missing host_permission: <all_urls>');
  }

  // B5: the merged artifact must carry the explicit not_allowed declaration.
  if (!Object.prototype.hasOwnProperty.call(manifest, 'incognito')) {
    errors.push('incognito key is required (must be "not_allowed")');
  } else if (manifest.incognito !== 'not_allowed') {
    errors.push(`incognito must be "not_allowed", found ${JSON.stringify(manifest.incognito)}`);
  }

  // Browser-specific fields
  if (browser === 'firefox') {
    if (manifest.side_panel) {
      errors.push('Firefox: Must NOT contain side_panel field');
    }
    if (!manifest.sidebar_action) {
      errors.push('Firefox: Must contain sidebar_action');
    }
    if (!manifest.browser_specific_settings?.gecko?.id) {
      errors.push('Firefox: Must contain browser_specific_settings.gecko.id');
    }
  } else {
    if (manifest.sidebar_action) {
      errors.push(`${browser}: Must NOT contain sidebar_action field`);
    }
    if (manifest.browser_specific_settings) {
      errors.push(`${browser}: Must NOT contain browser_specific_settings field`);
    }
    if (!manifest.side_panel?.default_path) {
      errors.push(`${browser}: Must contain side_panel.default_path`);
    }
  }

  // No traditional popup
  if (manifest.action?.default_popup) {
    errors.push('Must NOT declare action.default_popup (sidebar is main entry)');
  }

  return errors;
}
