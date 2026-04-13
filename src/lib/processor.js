/**
 * processor.js — Audio processing pipeline for ES-1 sample preparation.
 *
 * processAudio() applies optional normalize / DC-remove / hi-boost to an
 * AudioBuffer and returns a new AudioBuffer at the same sample rate.
 *
 * audioBufferToWav() serialises an AudioBuffer to a 16-bit WAV Blob.
 */

/**
 * Apply DSP chain to an AudioBuffer.
 * @param {AudioBuffer} audioBuffer
 * @param {{ normalize?: boolean, removeDcOffset?: boolean, highpassBoost?: boolean }} options
 * @returns {Promise<AudioBuffer>}
 */
export async function processAudio(audioBuffer, options = {}) {
  const { normalize = false, removeDcOffset = false, highpassBoost = false } = options;

  if (!normalize && !removeDcOffset && !highpassBoost) return audioBuffer;

  const { numberOfChannels, sampleRate, length } = audioBuffer;
  const offlineCtx = new OfflineAudioContext(numberOfChannels, length, sampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  let node = source;

  if (removeDcOffset) {
    const hp = offlineCtx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 5;
    node.connect(hp);
    node = hp;
  }

  if (highpassBoost) {
    const shelf = offlineCtx.createBiquadFilter();
    shelf.type = 'highshelf';
    shelf.frequency.value = 4000;
    shelf.gain.value = 4;
    node.connect(shelf);
    node = shelf;
  }

  node.connect(offlineCtx.destination);
  source.start(0);

  let rendered = await offlineCtx.startRendering();

  if (normalize) {
    let peak = 0;
    for (let c = 0; c < rendered.numberOfChannels; c++) {
      const data = rendered.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peak) peak = abs;
      }
    }
    if (peak > 0) {
      // Target -1 dBFS ≈ 0.891
      const gain = 0.891 / peak;
      for (let c = 0; c < rendered.numberOfChannels; c++) {
        const data = rendered.getChannelData(c);
        for (let i = 0; i < data.length; i++) data[i] *= gain;
      }
    }
  }

  return rendered;
}

/**
 * Serialise an AudioBuffer to a 16-bit signed PCM WAV Blob.
 * Channels are interleaved (standard WAV layout).
 * @param {AudioBuffer} buffer
 * @returns {Blob}
 */
export function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate  = buffer.sampleRate;
  const numSamples  = buffer.length;
  const dataLen     = numSamples * numChannels * 2;
  const ab          = new ArrayBuffer(44 + dataLen);
  const view        = new DataView(ab);

  const str = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

  str(0,  'RIFF');
  view.setUint32( 4, 36 + dataLen, true);
  str(8,  'WAVE');
  str(12, 'fmt ');
  view.setUint32(16, 16, true);            // chunk size
  view.setUint16(20, 1,  true);            // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate,  true);
  view.setUint32(28, sampleRate * numChannels * 2, true); // byte rate
  view.setUint16(32, numChannels * 2, true);              // block align
  view.setUint16(34, 16, true);            // bits per sample
  str(36, 'data');
  view.setUint32(40, dataLen, true);

  // Pre-fetch channel data arrays to avoid repeated getChannelData calls
  const channels = Array.from({ length: numChannels }, (_, c) => buffer.getChannelData(c));

  let offset = 44;
  for (let i = 0; i < numSamples; i++) {
    for (let c = 0; c < numChannels; c++) {
      const s = Math.max(-1, Math.min(1, channels[c][i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([ab], { type: 'audio/wav' });
}
