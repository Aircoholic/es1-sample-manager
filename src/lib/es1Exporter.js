/**
 * es1Exporter.js — Connects the Svelte slot store to the ES-1 ADPCM encoder.
 *
 * Reads slots from slotStore, decodes their WAV blobs to 16-bit PCM at 32 kHz,
 * encodes each sample with the Korg ADPCM algorithm, and builds a valid
 * 3.8 MB .ES1 backup file ready to copy onto a SmartMedia card.
 */

import { get }               from 'svelte/store';
import { slots }             from './slotStore.js';
import { createEmptyES1, writeSlot, downloadES1, ES1_SR } from './es1Encoder.js';

// ─── PCM DECODE ───────────────────────────────────────────────────────────────

/**
 * Decode a WAV Blob to a mono Float32Array at ES1_SR (32 000 Hz).
 * AudioContext resamples automatically if the source rate differs.
 * @param {Blob} blob
 * @returns {Promise<Float32Array>}
 */
async function blobToFloat32(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  // Decode at target sample rate — browser resamples if needed
  const ctx = new OfflineAudioContext(1, 1, ES1_SR);
  const decoded = await ctx.decodeAudioData(arrayBuffer);
  await ctx.close();

  if (decoded.sampleRate === ES1_SR) {
    return decoded.getChannelData(0);
  }

  // Explicit resample via OfflineAudioContext
  const outLen = Math.round(decoded.duration * ES1_SR);
  const resCtx = new OfflineAudioContext(1, outLen, ES1_SR);
  const src = resCtx.createBufferSource();
  src.buffer = decoded;
  src.connect(resCtx.destination);
  src.start(0);
  const resampled = await resCtx.startRendering();
  return resampled.getChannelData(0);
}

// ─── MAIN EXPORT ──────────────────────────────────────────────────────────────

/**
 * Build a .ES1 backup file from all converted slots and trigger a download.
 * @param {(progress: { phase: string, slot: number, total: number, pct: number }) => void} onProgress
 */
export async function exportAndDownloadES1(onProgress) {
  const allSlots = get(slots);
  const active   = allSlots.filter(s => s?.blob instanceof Blob);

  if (!active.length) {
    throw new Error('No converted samples found. Convert at least one sample first.');
  }

  const es1     = createEmptyES1();
  const total   = active.length;
  let   ramAddr = 0x200000;   // first free address in audio RAM

  for (let i = 0; i < total; i++) {
    const { blob, label } = active[i];

    onProgress?.({ phase: 'decode', slot: i + 1, total, pct: Math.round((i / total) * 50) });

    let float32;
    try {
      float32 = await blobToFloat32(blob);
    } catch (err) {
      console.warn(`Slot ${i} (${label}): decode failed — skipped.`, err);
      continue;
    }

    onProgress?.({ phase: 'encode', slot: i + 1, total, pct: Math.round(50 + (i / total) * 45) });

    try {
      ramAddr = writeSlot(es1, i, float32, ramAddr, (done, frames) => {
        const framePct = frames > 0 ? done / frames : 1;
        onProgress?.({
          phase: 'encode',
          slot:  i + 1,
          total,
          pct:   Math.round(50 + ((i + framePct) / total) * 45),
        });
      });
    } catch (err) {
      console.warn(`Slot ${i} (${label}): encode failed — skipped.`, err);
    }
  }

  onProgress?.({ phase: 'download', slot: total, total, pct: 99 });
  downloadES1(es1, 'BACKUP.ES1');
  onProgress?.({ phase: 'done', slot: total, total, pct: 100 });
}
