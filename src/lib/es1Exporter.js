// ============================================================
// es1Exporter.js  —  Baut eine .es1-Datei aus den Slots des
//                    stagingStore und löst den Download aus.
// ============================================================

import {
  createEmptyES1, writeSlot, downloadES1,
  resampleLinear, ES1_SR,
} from './es1Encoder.js';

/**
 * Exportiert alle fertigen Slots als .es1-Datei.
 *
 * @param {Array}    slots       Array aus slotStore ($slots)
 * @param {string}   filename    z.B. 'mein-kit.es1'
 * @param {function} onProgress  Callback ({ slot, totalSlots, frame, totalFrames, phase })
 *                               phase: 'resample' | 'encode' | 'done'
 */
export async function exportAsES1(slots, filename = 'backup.es1', onProgress) {
  // Nur belegte Slots (mit AudioBuffer) exportieren
  const activeSlots = slots
    .map((s, i) => ({ ...s, slotIndex: i }))
    .filter(s => s.audioBuffer != null);

  if (!activeSlots.length) throw new Error('Keine konvertierten Samples vorhanden.');

  const es1       = createEmptyES1();
  let   nextAddr  = 0x200000;
  const total     = activeSlots.length;

  for (let si = 0; si < total; si++) {
    const slot = activeSlots[si];
    onProgress?.({ slot: si, totalSlots: total, frame: 0, totalFrames: 1, phase: 'resample' });

    // Mono-Mix
    let samples = slot.audioBuffer.getChannelData(0);
    if (slot.audioBuffer.numberOfChannels > 1) {
      const mixed = new Float32Array(samples.length);
      for (let ch = 0; ch < slot.audioBuffer.numberOfChannels; ch++) {
        const d = slot.audioBuffer.getChannelData(ch);
        for (let i = 0; i < d.length; i++) mixed[i] += d[i];
      }
      for (let i = 0; i < mixed.length; i++) mixed[i] /= slot.audioBuffer.numberOfChannels;
      samples = mixed;
    }

    // Resample auf 32 kHz
    samples = resampleLinear(samples, slot.audioBuffer.sampleRate);

    // Encode mit Frame-Progress
    onProgress?.({ slot: si, totalSlots: total, frame: 0, totalFrames: 1, phase: 'encode' });
    nextAddr = writeSlot(
      es1,
      slot.slotIndex,
      samples,
      nextAddr,
      (frame, totalFrames) => {
        onProgress?.({ slot: si, totalSlots: total, frame, totalFrames, phase: 'encode' });
      }
    );

    // Kurz yielden damit der Browser atmen kann (Progress-Update sichtbar)
    await new Promise(r => setTimeout(r, 0));
  }

  onProgress?.({ slot: total, totalSlots: total, frame: 1, totalFrames: 1, phase: 'done' });
  downloadES1(es1, filename);
}
