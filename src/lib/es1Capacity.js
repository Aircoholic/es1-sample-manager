/**
 * es1Capacity.js — Shared capacity math for ES-1 backups.
 *
 * One .ES1 backup can hold a fixed amount of audio: the audio zone is
 * 0x0A0000–0x39FFFF = 3 145 728 bytes. Since the ES-1 ADPCM stores one byte
 * per 32 kHz sample, that's the same number of samples, i.e. ~98.3 seconds.
 *
 * A backup also can't hold more than 100 mono slots regardless of duration.
 *
 * These helpers compute, for a list of converted slots, how the samples pack
 * into one or more backups — used by:
 *   - the capacity meter (live preview before export),
 *   - the single-file exporter (warns / truncates),
 *   - the multi-file exporter (splits across N backups).
 */

import { ES1_SR, FRAMESIZE } from './es1Encoder.js';

export const AUDIO_ZONE_BYTES = 0x3A0000 - 0x0A0000;        // 3 145 728
export const MAX_SLOTS        = 100;
export const CAPACITY_SECONDS = AUDIO_ZONE_BYTES / ES1_SR;  // ≈ 98.3 s

/**
 * Padded ADPCM byte cost of a sample of `nSamples` 32 kHz samples.
 * Each 32-sample block encodes to 32 bytes, so cost == samples rounded up
 * to the next 32-byte boundary.
 */
export function paddedCost(nSamples) {
  return Math.ceil(nSamples / FRAMESIZE) * FRAMESIZE;
}

/**
 * Read the 32 kHz sample count from a converted WAV blob.
 *
 * Properly walks the RIFF chunk list to find `fmt ` (for sample rate and block
 * align) and `data` (for the audio byte count) rather than assuming a canonical
 * 44-byte header. FFmpeg frequently inserts extra chunks (LIST/INFO, fact, …)
 * between `fmt ` and `data`, which would break a fixed-offset read.
 *
 * @param {Blob} blob
 * @returns {Promise<number>} sample count at 32 kHz
 */
export async function blobSampleCount(blob) {
  try {
    // 64 KB is far more than enough to reach the data chunk header even with
    // several metadata chunks in front of it; we only need the data chunk's
    // declared size, not its contents.
    const head = await blob.slice(0, Math.min(blob.size, 65536)).arrayBuffer();
    const view = new DataView(head);

    // Validate RIFF / WAVE container.
    if (view.byteLength < 12 ||
        view.getUint32(0, false) !== 0x52494646 /* 'RIFF' */ ||
        view.getUint32(8, false) !== 0x57415645 /* 'WAVE' */) {
      return fallbackFromBlobSize(blob);
    }

    let sampleRate  = ES1_SR;
    let blockAlign  = 2;
    let dataBytes   = null;

    let off = 12;
    while (off + 8 <= view.byteLength) {
      const id   = view.getUint32(off, false);       // chunk id, big-endian compare
      const size = view.getUint32(off + 4, true);    // chunk size, little-endian
      const body = off + 8;

      if (id === 0x666d7420 /* 'fmt ' */ && body + 16 <= view.byteLength) {
        sampleRate = view.getUint32(body + 4, true) || ES1_SR;
        blockAlign = view.getUint16(body + 12, true) || 2;
      } else if (id === 0x64617461 /* 'data' */) {
        dataBytes = size;
        break; // got what we need
      }

      // Chunks are word-aligned: advance by size (+1 if odd).
      off = body + size + (size & 1);
    }

    if (dataBytes == null) return fallbackFromBlobSize(blob);

    const frames = dataBytes / blockAlign;          // sample frames in source
    return Math.round(frames * ES1_SR / sampleRate); // frames at 32 kHz
  } catch {
    return fallbackFromBlobSize(blob);
  }
}

/** Last-resort estimate if the header can't be parsed: assume 32 kHz mono 16-bit. */
function fallbackFromBlobSize(blob) {
  const audioBytes = Math.max(0, blob.size - 44);
  return Math.round(audioBytes / 2);
}

/**
 * Compute the padded byte cost for every slot that has audio.
 *
 * @param {Array} slotList  the slots store value
 * @returns {Promise<Array<{ index, label, samples, bytes }>>}
 */
export async function measureSlots(slotList) {
  const active = slotList
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => s?.blob instanceof Blob);

  const out = [];
  for (const { s, index } of active) {
    const samples = await blobSampleCount(s.blob);
    out.push({ index, label: s.label ?? '', samples, bytes: paddedCost(samples) });
  }
  return out;
}

/**
 * Pack measured slots into backups, greedily in order. A new backup starts
 * whenever the next sample would overflow either the byte budget or the
 * 100-slot limit. Order is preserved (no bin-packing reordering) so the
 * user's arrangement is respected.
 *
 * @param {Array<{ index, label, samples, bytes }>} measured
 * @returns {Array<{ slots: Array, bytes: number, samples: number }>}  one entry per backup
 */
export function packBackups(measured) {
  const backups = [];
  let current = null;

  for (const m of measured) {
    const fits = current
      && current.bytes + m.bytes <= AUDIO_ZONE_BYTES
      && current.slots.length < MAX_SLOTS;

    if (!fits) {
      current = { slots: [], bytes: 0, samples: 0 };
      backups.push(current);
    }
    current.slots.push(m);
    current.bytes   += m.bytes;
    current.samples += m.samples;
  }

  return backups;
}

/**
 * One-shot summary for the capacity meter: totals plus how the current set
 * would split into backups.
 *
 * The fill ratio is byte-based (`firstBackupFillRatio`) so it agrees exactly
 * with the packing logic, which also works in bytes. Seconds are provided
 * alongside as a human-readable label only.
 *
 * @param {Array} slotList
 * @returns {Promise<{
 *   totalSamples, totalBytes, totalSeconds,
 *   slotCount, backupCount,
 *   firstBackupBytes, firstBackupSeconds, firstBackupFillRatio, firstBackupFull,
 *   backups
 * }>}
 */
export async function summarize(slotList) {
  const measured = await measureSlots(slotList);
  const backups  = packBackups(measured);

  const totalBytes   = measured.reduce((a, m) => a + m.bytes, 0);
  const totalSamples = measured.reduce((a, m) => a + m.samples, 0);
  const first        = backups[0] ?? { bytes: 0, samples: 0, slots: [] };

  return {
    totalSamples,
    totalBytes,
    totalSeconds:         totalSamples / ES1_SR,
    slotCount:            measured.length,
    backupCount:          backups.length,
    firstBackupBytes:     first.bytes,
    firstBackupSeconds:   first.samples / ES1_SR,
    firstBackupFillRatio: Math.min(1, first.bytes / AUDIO_ZONE_BYTES),
    firstBackupFull:      backups.length > 1 || first.bytes >= AUDIO_ZONE_BYTES,
    backups,
  };
}
