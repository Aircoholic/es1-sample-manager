/**
 * es1Exporter.js
 * Exports the current slot list as a binary .es1 file.
 * Reads slots from slotStore — each slot has { label, audioUrl, blob }.
 */

import { get } from 'svelte/store';
import { slots } from './slotStore.js';

const ES1_SLOT_COUNT   = 102;
const ES1_SLOT_BYTES   = 0x8000;  // 32 768 bytes per slot (placeholder — adjust when known)
const ES1_HEADER_MAGIC = new Uint8Array([0x45, 0x53, 0x31, 0x00]); // "ES1\0"

/**
 * Decode a WAV blob → raw 16-bit PCM samples (mono, 32kHz assumed after ffmpeg step).
 */
async function blobToPcm(blob) {
  const arrayBuffer = await blob.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 32000);
  const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
  // Mix down to mono
  const mono = audioBuffer.getChannelData(0);
  const pcm = new Int16Array(mono.length);
  for (let i = 0; i < mono.length; i++) {
    const s = mono[i];
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(s < 0 ? s * 32768 : s * 32767)));
  }
  return pcm;
}

/**
 * Convert 16-bit PCM to 8-bit unsigned PCM (ES-1 raw format, pre-encoding).
 * This is a placeholder conversion — replace with the actual ADPCM encoder
 * once the encoding algorithm is confirmed via Phase 3 analysis.
 */
function pcm16ToU8(pcm16) {
  const out = new Uint8Array(pcm16.length);
  for (let i = 0; i < pcm16.length; i++) {
    // 16-bit signed → 8-bit unsigned: shift right by 8, then add 128
    out[i] = ((pcm16[i] >> 8) + 128) & 0xFF;
  }
  return out;
}

/**
 * Main export function.
 * @param {Array} slotList  - Array of slot objects (passed from ExportBar)
 * @param {string} filename - Output filename
 * @param {Function} onProgress - Callback({ slot, totalSlots, frame, totalFrames, phase })
 */
export async function exportAsES1(slotList, filename = 'es1-samples.es1', onProgress = () => {}) {
  // Filter slots that actually have audio data (blob)
  const activeSlots = slotList.filter(sl => sl.blob != null);

  if (!activeSlots.length) {
    throw new Error('Keine konvertierten Samples vorhanden.');
  }

  const totalSlots = activeSlots.length;
  // Pre-allocate output: simple concatenation for now (structure TBD after Phase 3)
  const chunks = [];

  for (let slotIdx = 0; slotIdx < totalSlots; slotIdx++) {
    const slot = activeSlots[slotIdx];

    // --- Phase: resample/decode ---
    onProgress({ slot: slotIdx, totalSlots, frame: 0, totalFrames: 1, phase: 'resample' });
    await new Promise(r => setTimeout(r, 0)); // yield to DOM

    const pcm16 = await blobToPcm(slot.blob);

    // --- Phase: encode ---
    const totalFrames = pcm16.length;
    const u8 = new Uint8Array(totalFrames);

    const CHUNK_SIZE = 4096;
    for (let f = 0; f < totalFrames; f += CHUNK_SIZE) {
      const end = Math.min(f + CHUNK_SIZE, totalFrames);
      for (let i = f; i < end; i++) {
        u8[i] = ((pcm16[i] >> 8) + 128) & 0xFF;
      }
      onProgress({ slot: slotIdx, totalSlots, frame: end, totalFrames, phase: 'encode' });
      await new Promise(r => setTimeout(r, 0)); // yield to DOM
    }

    chunks.push({ label: slot.label || `Sample ${slotIdx}`, data: u8 });
  }

  // --- Assemble output ---
  onProgress({ slot: totalSlots, totalSlots, frame: 1, totalFrames: 1, phase: 'done' });
  await new Promise(r => setTimeout(r, 0));

  // Simple format: 4-byte magic + slot count (1 byte) + for each slot: 32-byte name + 4-byte length + data
  const NAME_BYTES = 32;
  let totalBytes = 5; // magic(4) + count(1)
  for (const c of chunks) totalBytes += NAME_BYTES + 4 + c.data.length;

  const output = new Uint8Array(totalBytes);
  let pos = 0;

  // Header
  output.set(ES1_HEADER_MAGIC, pos); pos += 4;
  output[pos++] = chunks.length;

  // Slots
  for (const c of chunks) {
    // Name: UTF-8, null-padded to 32 bytes
    const nameBytes = new TextEncoder().encode(c.label.slice(0, NAME_BYTES - 1));
    output.set(nameBytes, pos); pos += NAME_BYTES;

    // Length (little-endian 32-bit)
    const len = c.data.length;
    output[pos++] = (len)       & 0xFF;
    output[pos++] = (len >> 8)  & 0xFF;
    output[pos++] = (len >> 16) & 0xFF;
    output[pos++] = (len >> 24) & 0xFF;

    // Sample data
    output.set(c.data, pos); pos += c.data.length;
  }

  // Trigger download
  const blob = new Blob([output], { type: 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
