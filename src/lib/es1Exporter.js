/**
 * es1Exporter.js — Connects the slot store to the ES-1 encoder.
 *
 * Exports either a single BACKUP.ES1 (filling one backup, warning if the
 * audio overflows the device limit) or a set of numbered backups that hold
 * every converted sample split across as many .ES1 files as needed.
 *
 * IMPORTANT: Uses plain AudioContext (not OfflineAudioContext) for decoding.
 * Calling close() on an OfflineAudioContext before startRendering() throws
 * in Chrome/Brave and silently aborts all encoding.
 *
 * Verbose [ES1] logging to browser DevTools console.
 */

import { get }   from 'svelte/store';
import { slots } from './slotStore.js';
import {
  createEmptyES1, writeSlot, downloadES1,
  ES1_SR, RAM_START,
} from './es1Encoder.js';
import {
  measureSlots, packBackups,
  AUDIO_ZONE_BYTES, CAPACITY_SECONDS,
} from './es1Capacity.js';

// ─── DECODE ───────────────────────────────────────────────────────────────────

async function blobToFloat32(blob) {
  const arrayBuffer = await blob.arrayBuffer();

  // Plain AudioContext — do NOT call close() on it.
  const ctx     = new AudioContext();
  const decoded = await ctx.decodeAudioData(arrayBuffer);

  if (Math.abs(decoded.sampleRate - ES1_SR) < 1) {
    return decoded.getChannelData(0);
  }

  // Resample to 32 kHz
  console.log(`[ES1] Resampling from ${decoded.sampleRate} Hz → ${ES1_SR} Hz`);
  const outLen   = Math.round(decoded.duration * ES1_SR);
  const resCtx   = new OfflineAudioContext(1, outLen, ES1_SR);
  const src      = resCtx.createBufferSource();
  src.buffer     = decoded;
  src.connect(resCtx.destination);
  src.start(0);
  const resampled = await resCtx.startRendering();
  return resampled.getChannelData(0);
}

// ─── SHARED: write one backup from a list of measured slots ─────────────────────

/**
 * Build a single .ES1 image from a list of slots.
 *
 * @param {Array<{ index, label }>} slotEntries  slots that belong in this backup
 * @param {object} allSlots          the full slots store value (for blob lookup)
 * @param {function} reportProgress  (slotInBackup, totalInBackup, encodePct)
 * @returns {Promise<{ es1: Uint8Array, written: number }>}
 */
async function buildBackup(slotEntries, allSlots, reportProgress) {
  const es1   = await createEmptyES1();
  const total = slotEntries.length;
  let ramAddr = RAM_START;
  let written = 0;

  for (let i = 0; i < total; i++) {
    const sourceIdx = slotEntries[i].index;
    const { blob, label } = allSlots[sourceIdx];

    reportProgress?.(i + 1, total, 0);
    console.log(`[ES1] Decoding "${label}" (${blob.size} bytes)`);

    let f32;
    try {
      f32 = await blobToFloat32(blob);
    } catch (err) {
      console.error(`[ES1] Decode FAILED for "${label}":`, err);
      continue;
    }
    if (!f32 || f32.length === 0) {
      console.warn(`[ES1] "${label}": empty audio, skipping`);
      continue;
    }

    try {
      ramAddr = writeSlot(es1, written, f32, ramAddr, (done, frames) => {
        const fp = frames > 0 ? Math.round((done / frames) * 100) : 100;
        reportProgress?.(i + 1, total, fp);
      });
      written++;
    } catch (err) {
      if (err.message?.includes('audio zone full') || err.message?.includes('overlap')) {
        console.warn(`[ES1] Backup full after ${written} slots`);
        break;
      }
      console.error(`[ES1] Encode FAILED for "${label}":`, err);
    }
  }

  return { es1, written };
}

// ─── SINGLE-FILE EXPORT (fills one backup) ──────────────────────────────────────

export async function exportAndDownloadES1(onProgress) {
  const all      = get(slots);
  const measured = await measureSlots(all);
  console.log(`[ES1] Export start: ${measured.length} slot(s) with audio`);

  if (!measured.length)
    throw new Error('No converted samples found. Convert at least one sample first.');

  const backups = packBackups(measured);
  let warning = null;
  if (backups.length > 1) {
    const total = measured.reduce((a, m) => a + m.samples, 0);
    warning = `Total audio (~${Math.round(total / ES1_SR)} s) exceeds the ES-1 ` +
              `limit of ~${Math.round(CAPACITY_SECONDS)} s. Only the first ` +
              `${backups[0].slots.length} sample(s) fit — use "Export All (split)" ` +
              `to write everything across ${backups.length} backups.`;
    console.warn('[ES1]', warning);
  }
  onProgress?.({ phase: 'check', slot: 0, total: backups[0].slots.length, pct: 0, warning });

  const firstBackup = backups[0];
  const total = firstBackup.slots.length;

  const { es1, written } = await buildBackup(firstBackup.slots, all, (slot, tot, encPct) => {
    // Map (slot, encPct) → overall 0–95 %
    const base = ((slot - 1) / tot) * 95;
    const span = (1 / tot) * 95;
    onProgress?.({
      phase: encPct > 0 ? 'encode' : 'decode',
      slot, total: tot,
      pct: Math.round(base + (encPct / 100) * span),
      warning,
    });
  });

  if (written === 0)
    throw new Error('Export failed: no samples could be encoded. Check the browser console (F12) for details.');

  onProgress?.({ phase: 'download', slot: total, total, pct: 99, warning });
  downloadES1(es1, 'BACKUP.ES1');
  onProgress?.({ phase: 'done', slot: written, total, pct: 100, warning });

  return { written, backupCount: backups.length };
}

// ─── MULTI-FILE EXPORT (splits across N backups) ────────────────────────────────

/**
 * Export every converted sample, split across as many .ES1 files as needed.
 * Files are named BACKUP_1.ES1, BACKUP_2.ES1, … (single backup → BACKUP.ES1).
 *
 * @param {function} onProgress  receives { phase, file, fileCount, slot, total, pct, warning }
 * @param {string}   [baseName]  filename stem, default "BACKUP"
 */
export async function exportAllSplitES1(onProgress, baseName = 'BACKUP') {
  const all      = get(slots);
  const measured = await measureSlots(all);
  console.log(`[ES1] Split export: ${measured.length} slot(s) with audio`);

  if (!measured.length)
    throw new Error('No converted samples found. Convert at least one sample first.');

  const backups   = packBackups(measured);
  const fileCount = backups.length;
  const single    = fileCount === 1;
  console.log(`[ES1] Packing into ${fileCount} backup file(s)`);

  let totalWritten = 0;

  for (let b = 0; b < fileCount; b++) {
    const backup   = backups[b];
    const fileName = single ? `${baseName}.ES1` : `${baseName}_${b + 1}.ES1`;
    const fileNum  = b + 1;

    onProgress?.({
      phase: 'file-start', file: fileNum, fileCount,
      slot: 0, total: backup.slots.length, pct: 0,
    });

    const { es1, written } = await buildBackup(backup.slots, all, (slot, tot, encPct) => {
      const base = ((slot - 1) / tot) * 100;
      const span = (1 / tot) * 100;
      onProgress?.({
        phase: encPct > 0 ? 'encode' : 'decode',
        file: fileNum, fileCount,
        slot, total: tot,
        pct: Math.round(base + (encPct / 100) * span),
      });
    });

    if (written > 0) {
      downloadES1(es1, fileName);
      totalWritten += written;
      console.log(`[ES1] ${fileName}: ${written} slot(s) written`);
    }

    // Small gap so the browser registers each download separately
    if (!single && b < fileCount - 1) await new Promise(r => setTimeout(r, 350));
  }

  if (totalWritten === 0)
    throw new Error('Export failed: no samples could be encoded. Check the browser console (F12) for details.');

  onProgress?.({ phase: 'done', file: fileCount, fileCount, slot: totalWritten, total: measured.length, pct: 100 });

  return { written: totalWritten, fileCount };
}
