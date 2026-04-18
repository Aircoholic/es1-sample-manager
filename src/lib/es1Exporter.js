/**
 * es1Exporter.js — Connects the slot store to the ES-1 encoder.
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
  ES1_SR, FRAMESIZE, RAM_START,
} from './es1Encoder.js';

const AUDIO_ZONE = 0x3A0000 - 0x0A0000;   // 3 145 728 bytes ≈ 98 s @ 32 kHz

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

// ─── EXPORT ───────────────────────────────────────────────────────────────────

export async function exportAndDownloadES1(onProgress) {
  const active = get(slots).filter(s => s?.blob instanceof Blob);
  console.log(`[ES1] Export start: ${active.length} slot(s) with audio`);

  if (!active.length)
    throw new Error('No converted samples found. Convert at least one sample first.');

  // Capacity estimate from WAV headers
  let needed = 0;
  for (const { blob } of active) {
    try {
      const hdr  = await blob.slice(0, 44).arrayBuffer();
      const view = new DataView(hdr);
      const sr   = view.getUint32(24, true) || ES1_SR;
      const data = view.getUint32(40, true);
      const ba   = view.getUint16(32, true) || 2;
      const n    = Math.round((data / ba) * ES1_SR / sr);
      needed    += Math.ceil(n / FRAMESIZE) * FRAMESIZE;
    } catch { needed += ES1_SR; }
  }

  let warning = null;
  if (needed > AUDIO_ZONE) {
    warning = `Total audio (~${Math.round(needed/ES1_SR)} s) exceeds the ES-1 limit ` +
              `of ~${Math.round(AUDIO_ZONE/ES1_SR)} s. Later slots will be skipped.`;
    console.warn('[ES1]', warning);
  }
  onProgress?.({ phase:'check', slot:0, total:active.length, pct:0, warning });

  const es1    = createEmptyES1();
  const total  = active.length;
  let ramAddr  = RAM_START;
  let written  = 0;

  for (let i = 0; i < total; i++) {
    const { blob, label } = active[i];
    onProgress?.({ phase:'decode', slot:i+1, total, pct: Math.round((i/total)*50), warning });
    console.log(`[ES1] Slot ${i}: decoding "${label}" (${blob.size} bytes)`);

    let f32;
    try {
      f32 = await blobToFloat32(blob);
      console.log(`[ES1] Slot ${i}: ${f32.length} samples decoded`);
    } catch (err) {
      console.error(`[ES1] Slot ${i} decode FAILED:`, err);
      continue;
    }
    if (!f32 || f32.length === 0) {
      console.warn(`[ES1] Slot ${i}: empty audio, skipping`);
      continue;
    }

    try {
      const prev = ramAddr;
      ramAddr = writeSlot(es1, written, f32, ramAddr, (done, frames) => {
        const fp = frames > 0 ? done/frames : 1;
        onProgress?.({ phase:'encode', slot:i+1, total, pct: Math.round(50+((i+fp)/total)*45), warning });
      });
      console.log(`[ES1] Slot ${written}: wrote ${f32.length} samples, RAM 0x${prev.toString(16)}→0x${ramAddr.toString(16)}`);
      written++;
    } catch (err) {
      if (err.message?.includes('audio zone full') || err.message?.includes('overlap')) {
        console.warn(`[ES1] Out of space after ${written} slots`);
        break;
      }
      console.error(`[ES1] Slot ${i} encode FAILED:`, err);
    }
  }

  console.log(`[ES1] Export complete: ${written}/${total} slots written`);

  if (written === 0)
    throw new Error('Export failed: no samples could be encoded. Check the browser console (F12) for details.');

  onProgress?.({ phase:'download', slot:total, total, pct:99, warning });
  downloadES1(es1, 'BACKUP.ES1');
  onProgress?.({ phase:'done', slot:total, total, pct:100, warning });
}
