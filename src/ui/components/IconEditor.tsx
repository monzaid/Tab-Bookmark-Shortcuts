/**
 * Reusable IconEditor component — Canvas-based composite icon editor.
 * Used by: sidebar Change Icon modal, New Global Rule modal, settings New/Edit Rule form.
 *
 * Features:
 * - Background color selection (color picker + presets + no-bg)
 * - Text/emoji input
 * - Text color selection with auto-luminance default (Problem 4)
 * - File upload (collapsible)
 * - Live Canvas preview
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface IconConfig {
  bgColor?: string;
  text?: string;
  textColor?: string;
  dataUri?: string;
  /**
   * FIX-C: the reverse converter's URL carrier.
   *
   * The composer itself never sets this; it exists so `iconSourceToIconConfig`
   * can round-trip a `type:'url'` source instead of silently dropping it (v1
   * returned `{}`, so a URL icon reopened blank).
   */
  url?: string;
}

export interface IconEditorProps {
  value?: IconConfig;
  onChange: (config: IconConfig) => void;
  size?: number;
  /**
   * Hide the collapsible file-upload affordance.
   *
   * Upload is its OWN tab in `IconFieldEditor` (the five-tab icon editor), so the
   * composite editor is rendered with this flag to avoid offering two different
   * "upload" entry points that would produce the same `dataUri`.
   */
  hideUpload?: boolean;
  /**
   * Hide the composite editor's own lightweight preview.
   *
   * The five-tab icon picker already renders ONE full-width preview above its
   * tabs, so a second preview inside the Custom Icon panel is redundant noise
   * (review item 1.1). Only the preview is suppressed — the editor's own canvas
   * is still what the colour/text controls write to internally.
   */
  hidePreview?: boolean;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PRESET_BG_COLORS = ['#2563EB', '#DC2626', '#16A34A', '#D97706', '#7C3AED', '#0891B2', '#DB2777', '#4B5563'];
const PRESET_TEXT_COLORS = ['#FFFFFF', '#000000', '#DC2626', '#2563EB', '#16A34A', '#F59E0B'];

// ─── Utility: luminance-based auto text color ────────────────────────────────

export function autoTextColor(bgColor: string): string {
  // Parse hex color and compute relative luminance
  const hex = bgColor.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 0.5 ? '#000000' : '#FFFFFF';
}

// ─── Utility: render icon to data URI ────────────────────────────────────────

export function renderIconToDataUri(config: IconConfig, size: number): string {
  if (config.dataUri) return config.dataUri;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const radius = Math.round(size * 0.1875); // 12px at 64px

  // Draw rounded rect background
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();

  ctx.fillStyle = config.bgColor ?? '#9CA3AF';
  ctx.fill();

  // Draw centered text/emoji
  if (config.text) {
    const textColor = config.textColor ?? autoTextColor(config.bgColor ?? '#9CA3AF');
    ctx.fillStyle = textColor;
    const fontSize = config.text.length > 2 ? Math.round(size * 0.3125) : Math.round(size * 0.5);
    ctx.font = `${fontSize}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(config.text, size / 2, size / 2 + size * 0.03);
  }

  return canvas.toDataURL('image/png');
}

// ─── IconEditor Component ────────────────────────────────────────────────────

export function IconEditor({ value, onChange, size = 64, hideUpload = false, hidePreview = false }: IconEditorProps) {
  const [bgColor, setBgColor] = useState(value?.bgColor ?? '#2563EB');
  const [useBgColor, setUseBgColor] = useState(!!value?.bgColor || value === undefined);
  const [text, setText] = useState(value?.text ?? '');
  const [textColor, setTextColor] = useState(value?.textColor ?? autoTextColor(value?.bgColor ?? '#2563EB'));
  const [textColorManual, setTextColorManual] = useState(!!value?.textColor);
  const [uploadPreview, setUploadPreview] = useState<string | null>(value?.dataUri ?? null);
  const [showUpload, setShowUpload] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRef = useRef<HTMLCanvasElement>(null);

  /**
 * F3: last config handed up through `onChange`.
 *
 * The editor is mounted/unmounted with its host dialog, but a host that keeps
 * the dialog mounted (as the sidebar modal does) re-seeds `value` AFTER the
 * first open. Without this, `useState(value?.…)` only reads the prop once at
 * mount and the real icon never reaches the editor — the first open then shows
 * a blank default and any edit overwrites the user's icon.
 *
 * Recognising our own echo (identical object reference) keeps the sync below
 * from fighting the user's in-progress edits; only genuinely external `value`
 * changes are adopted.
 */
const lastEmitted = useRef<IconConfig | null>(null);

  /**
 * N8: structural equality, not reference identity.
 *
 * All five current call sites store the emitted object as-is, so a reference
 * check would suffice today. A future caller that clones or JSON round-trips
 * the config before handing it back would, with a reference check, look like an
 * external change and silently reset the editor — discarding the user's
 * in-progress edits. Comparing field-by-field removes that footgun.
 */
const isSameConfig = (a: IconConfig, b: IconConfig | null): boolean =>
    b !== null &&
    a.bgColor === b.bgColor &&
    a.text === b.text &&
    a.textColor === b.textColor &&
    a.dataUri === b.dataUri;

  // Adopt externally supplied values (e.g. the host seeding the icon on open).
  useEffect(() => {
    if (value !== undefined && isSameConfig(value, lastEmitted.current)) return;
    setBgColor(value?.bgColor ?? '#2563EB');
    setUseBgColor(!!value?.bgColor || value === undefined);
    setText(value?.text ?? '');
    setTextColor(value?.textColor ?? autoTextColor(value?.bgColor ?? '#2563EB'));
    setTextColorManual(!!value?.textColor);
    setUploadPreview(value?.dataUri ?? null);
  }, [value]);

  // Auto text color when bg changes and user hasn't manually set it
  const effectiveTextColor = textColorManual ? textColor : autoTextColor(useBgColor ? bgColor : '#9CA3AF');

  // Live preview update
  useEffect(() => {
    if (uploadPreview) return;
    const canvas = previewRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, size, size);
    const radius = Math.round(size * 0.1875);

    ctx.beginPath();
    ctx.moveTo(radius, 0);
    ctx.lineTo(size - radius, 0);
    ctx.quadraticCurveTo(size, 0, size, radius);
    ctx.lineTo(size, size - radius);
    ctx.quadraticCurveTo(size, size, size - radius, size);
    ctx.lineTo(radius, size);
    ctx.quadraticCurveTo(0, size, 0, size - radius);
    ctx.lineTo(0, radius);
    ctx.quadraticCurveTo(0, 0, radius, 0);
    ctx.closePath();

    ctx.fillStyle = useBgColor ? bgColor : '#9CA3AF';
    ctx.fill();

    if (text) {
      ctx.fillStyle = effectiveTextColor;
      const fontSize = text.length > 2 ? Math.round(size * 0.3125) : Math.round(size * 0.5);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, size / 2, size / 2 + size * 0.03);
    }
  }, [bgColor, useBgColor, text, effectiveTextColor, uploadPreview, size]);

  // Emit changes — propagates internal state to parent via onChange
  const emitChange = useCallback((overrides: Partial<IconConfig & { uploadPreview: string | null; useBg?: boolean }> = {}) => {
    const finalUpload = overrides.uploadPreview !== undefined ? overrides.uploadPreview : uploadPreview;
    if (finalUpload) {
      const emitted = { dataUri: finalUpload };
      lastEmitted.current = emitted;
      onChange(emitted);
      return;
    }
    const finalUseBg = overrides.useBg !== undefined ? overrides.useBg : useBgColor;
    const finalBg = overrides.bgColor !== undefined ? overrides.bgColor : (finalUseBg ? bgColor : undefined);
    const finalText = overrides.text !== undefined ? overrides.text : text;
    const finalTextColor = overrides.textColor !== undefined ? overrides.textColor : effectiveTextColor;
    const emitted: IconConfig = {
      bgColor: finalBg,
      text: finalText || undefined,
      textColor: finalText ? finalTextColor : undefined,
    };
    lastEmitted.current = emitted;
    onChange(emitted);
  }, [uploadPreview, useBgColor, bgColor, text, effectiveTextColor, onChange]);

  // Auto-propagate internal state to parent whenever it changes.
  // This is the critical fix: previously onChange was never called by handlers,
  // so the parent's iconConfig stayed stale and Apply sent the old icon.
  const isFirstRender = useRef(true);
  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    emitChange();
  }, [bgColor, useBgColor, text, effectiveTextColor, uploadPreview]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleBgColorChange = useCallback((color: string) => {
    setBgColor(color);
    setUseBgColor(true);
    setUploadPreview(null);
    if (!textColorManual) {
      setTextColor(autoTextColor(color));
    }
  }, [textColorManual]);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUri = reader.result as string;
      setUploadPreview(dataUri);
      const emitted = { dataUri };
      lastEmitted.current = emitted;
      onChange(emitted);
    };
    reader.readAsDataURL(file);
  }, [onChange]);

  return (
    <div className="tbs-icon-editor">
      {/* Live preview — suppressed when the host already shows one (item 1.1).
          The canvas stays MOUNTED either way: it is the draw target the colour
          and text controls rely on. */}
      <div className="tbs-icon-editor__preview" hidden={hidePreview}>
        {uploadPreview ? (
          <img src={uploadPreview} alt="Icon preview" style={{ width: size, height: size, borderRadius: 4 }} />
        ) : (
          <canvas ref={previewRef} width={size} height={size} aria-label="Icon preview" style={{ borderRadius: 4 }} />
        )}
      </div>

      {/* Background color selection */}
      <div className="tbs-icon-editor__section">
        <p className="tbs-icon-editor__label">Background Color</p>
        <div className="tbs-icon-editor__colors">
          <input
            type="color"
            value={bgColor}
            onChange={(e) => handleBgColorChange(e.target.value)}
            aria-label="Custom background color"
            className="tbs-icon-editor__color-input"
          />
          {PRESET_BG_COLORS.map((c) => (
            <button
              key={c}
              className={`tbs-icon-editor__swatch${bgColor === c && useBgColor ? ' tbs-icon-editor__swatch--active' : ''}`}
              style={{ background: c }}
              onClick={() => handleBgColorChange(c)}
              aria-label={`Background color ${c}`}
            />
          ))}
          <button
            className={`tbs-icon-editor__swatch tbs-icon-editor__swatch--none${!useBgColor ? ' tbs-icon-editor__swatch--active' : ''}`}
            onClick={() => { setUseBgColor(false); setUploadPreview(null); }}
            aria-label="No background color"
            title="No background"
          >
            ∅
          </button>
        </div>
      </div>

      {/* Text/Emoji input */}
      <div className="tbs-icon-editor__section">
        <p className="tbs-icon-editor__label">Text / Emoji</p>
        <input
          type="text"
          value={text}
          onChange={(e) => { setText(e.target.value); setUploadPreview(null); }}
          placeholder="🚀, A, Doc"
          maxLength={4}
          aria-label="Icon text or emoji"
          className="tbs-icon-editor__text-input"
        />
      </div>

      {/* Text color selection (Problem 4) */}
      <div className="tbs-icon-editor__section">
        <p className="tbs-icon-editor__label">Text Color</p>
        <div className="tbs-icon-editor__colors">
          <input
            type="color"
            value={effectiveTextColor}
            onChange={(e) => { setTextColor(e.target.value); setTextColorManual(true); }}
            aria-label="Custom text color"
            className="tbs-icon-editor__color-input"
          />
          {PRESET_TEXT_COLORS.map((c) => (
            <button
              key={c}
              className={`tbs-icon-editor__swatch${effectiveTextColor === c ? ' tbs-icon-editor__swatch--active' : ''}`}
              style={{ background: c }}
              onClick={() => { setTextColor(c); setTextColorManual(true); }}
              aria-label={`Text color ${c}`}
            />
          ))}
          <button
            className={`tbs-icon-editor__swatch tbs-icon-editor__swatch--auto${!textColorManual ? ' tbs-icon-editor__swatch--active' : ''}`}
            onClick={() => { setTextColorManual(false); setTextColor(autoTextColor(useBgColor ? bgColor : '#9CA3AF')); }}
            aria-label="Auto text color"
            title="Auto (based on background)"
          >
            A
          </button>
        </div>
      </div>

      {/* Upload (collapsible) — suppressed when Upload is its own tab host. */}
      {!hideUpload && (
      <div className="tbs-icon-editor__section">
        <button
          className="tbs-icon-editor__collapse-toggle"
          onClick={() => setShowUpload(!showUpload)}
          aria-expanded={showUpload}
        >
          {showUpload ? '▼' : '▶'} or upload an icon file
        </button>
        {showUpload && (
          <div className="tbs-icon-editor__upload">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileSelect}
              style={{ display: 'none' }}
              aria-label="Upload icon file"
            />
            <button
              className="tbs-btn tbs-btn--secondary tbs-btn--sm"
              onClick={() => fileInputRef.current?.click()}
            >
              Choose File
            </button>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
