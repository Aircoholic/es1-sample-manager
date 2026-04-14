/**
 * es1Exporter.js — Connects slot store to the ES-1 ADPCM encoder.
 *
 * Bugs fixed vs previous version:
 *
 *   BUG 1 (no audio written): OfflineAudioContext.close() threw in Chrome/Brave
 *   before any audio buffer was decoded, silently skipping all samples.
 *   Fix: use a plain AudioContext for decodeAudioData — never call close() on it.
 *
 *   BUG 2 (garbage patterns on device): createEmptyES1 filled with 0xFF.
 *   The ES-1 reads 0xFF parameter bytes as maximum values → BPM=511, all FX on.
 *   Fix: createEmptyES1 now fills with 0x00 (off/minimum). Fixed in es1Encoder.js.
 *
 *   BUG 3 (silent truncation): No warning when total audio exceeds the ~98 s limit.
 *   Fix: capacity check before encoding, warning passed to UI via onProgress.
 */

import { get }   from 'svelte/store';
import { slots } from './slotStore.js';
import {
  createEmptyES1, writeSlot, downloadES1,
  ES1_SR, FRAMESIZE, RAM_START,
} from './es1Encoder.js';

const AUDIO_ZONE_BYTES = 0x3A0000 - 0x0A0000;   // 3 145 728

// ─── DECODE ───────────────────────────────────────────────────────────────────

/**
 * Decode a WAV Blob → mono Float32Array at ES1_SR.
 *
 * IMPORTANT: uses a plain AudioContext, NOT OfflineAudioContext.
 * Calling close() on an OfflineAudioContext that hasn't been rendered yet
 * throws in Chrome/Brave, silently aborting the entire export with no audio.
 * A plain AudioContext.decodeAudioData() is safe, async, and GC'd naturally.
 */
async function blobToFloat32(blob) {
  const buf = await blob.arrayBuffer();

  // Plain AudioContext is safe in all browsers — do NOT call .close() after
  const ctx = new AudioContext();
  const decoded = await ctx.decodeAudioData(buf);
  // Note: intentionally not calling ctx.close() here

  // Already at target rate — return directly
  if (Math.abs(decoded.sampleRate - ES1_SR) < 1) {
    return decoded.getChannelData(0);
  }

  // Resample to 32 kHz. Here we DO render so close() would be fine, but we
  // skip it anyway for consistency.
  const outLen  = Math.round(decoded.duration * ES1_SR);
  const resCtx  = new OfflineAudioContext(1, outLen, ES1_SR);
  const src     = resCtx.createBufferSource();
  src.buffer    = decoded;
  src.connect(resCtx.destination);
  src.start(0);
  const resampled = await resCtx.startRendering();
  return resampled.getChannelData(0);
}

// ─── CAPACITY PRE-CHECK ───────────────────────────────────────────────────────

/**
 * Quickly estimate total encoded bytes from WAV blob headers only.
 * Avoids decoding all audio just to check capacity.
 */
async function estimateBytes(activeSlots) {
  let total = 0;
  for (const { blob } of activeSlots) {
    try {
      const hdr  = await blob.slice(0, 44).arrayBuffer();
      const view = new DataView(hdr);
      const sr   = view.getUint32(24, true);
      const data = view.getUint32(40, true);
      const ba   = view.getUint16(32, true);
      const n    = Math.round((data / ba) * ES1_SR / sr);
      total += Math.ceil(n / FRAMESIZE) * FRAMESIZE;
    } catch {
      total += ES1_SR;   // fallback: assume 1 s
    }
  }
  return total;
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

/**
 * Build and download a .ES1 backup from all converted slots.
 *
 * @param {(p:{phase:string,slot:number,total:number,pct:number,warning?:string})=>void} [onProgress]
 */
export async function exportAndDownloadES1(onProgress) {
  const active = get(slots).filter(s => s?.blob instanceof Blob);

  if (!active.length)
    throw new Error('No converted samples found. Convert at least one sample first.');

  // Capacity check
  const needed = await estimateBytes(active);
  let warning  = null;
  if (needed > AUDIO_ZONE_BYTES) {
    const maxS  = (AUDIO_ZONE_BYTES / ES1_SR).toFixed(0);
    const needS = (needed          / ES1_SR).toFixed(0);
    warning = `Total audio (~${needS} s) exceeds the ES-1 limit of ~${maxS} s. ` +
              `Later slots will be skipped. Trim samples or use fewer slots.`;
  }
  onProgress?.({ phase:'check', slot:0, total:active.length, pct:0, warning });

  const es1    = createEmptyES1();
  const total  = active.length;
  let ramAddr  = RAM_START;
  let written  = 0;

  for (let i = 0; i < total; i++) {
    const { blob, label } = active[i];
    onProgress?.({ phase:'decode', slot:i+1, total, pct: Math.round((i/total)*50), warning });

    let f32;
    try {
      f32 = await blobToFloat32(blob);
    } catch (err) {
      console.warn(`ES1 export: slot ${i} (${label}) decode failed — skipped.`, err);
      continue;
    }

    try {
      ramAddr = writeSlot(es1, written, f32, ramAddr, (done, frames) => {
        const fp = frames > 0 ? done/frames : 1;
        onProgress?.({ phase:'encode', slot:i+1, total, pct: Math.round(50+((i+fp)/total)*45), warning });
      });
      written++;
    } catch (err) {
      if (err.message?.includes('audio zone full')) {
        console.warn(`ES1 export: audio zone full after ${written} slots.`);
        break;
      }
      console.warn(`ES1 export: slot ${i} (${label}) encode failed — skipped.`, err);
    }
  }

  if (written === 0)
    throw new Error('Export failed: no samples encoded. See browser console for details.');

  onProgress?.({ phase:'download', slot:total, total, pct:99, warning });
  downloadES1(es1, 'BACKUP.ES1');
  onProgress?.({ phase:'done', slot:total, total, pct:100, warning });
}
