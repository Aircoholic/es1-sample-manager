/**
 * waveform.js — Audio analysis and waveform drawing utilities.
 */

/**
 * Decode a File to its duration, downsampled waveform peaks,
 * full raw sample buffer, and sample rate.
 * @param {File} file
 * @returns {Promise<{ duration: number, peaks: Float32Array, rawSamples: Float32Array, sampleRate: number }>}
 */
export async function analyzeFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx    = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  const raw       = audioBuffer.getChannelData(0);
  const BINS      = 1000;
  const blockSize = Math.floor(raw.length / BINS);
  const peaks     = new Float32Array(BINS);

  for (let i = 0; i < BINS; i++) {
    let max = 0;
    const base = i * blockSize;
    for (let j = 0; j < blockSize; j++) {
      const abs = Math.abs(raw[base + j]);
      if (abs > max) max = abs;
    }
    peaks[i] = max;
  }

  return {
    duration:   audioBuffer.duration,
    peaks,
    rawSamples: new Float32Array(raw),
    sampleRate: audioBuffer.sampleRate,
  };
}

/** Maximum search window for zero-crossing snapping: 20ms */
const ZC_MAX_SEARCH_S = 0.02;

/**
 * Find the nearest zero crossing to a time position, searching outward in both directions.
 * @param {number} timeSeconds
 * @param {Float32Array} rawSamples
 * @param {number} sampleRate
 * @returns {number} snapped time in seconds
 */
export function findZeroCrossing(timeSeconds, rawSamples, sampleRate) {
  const startIdx  = Math.round(timeSeconds * sampleRate);
  const maxSearch = Math.round(ZC_MAX_SEARCH_S * sampleRate);
  const last      = rawSamples.length - 2;

  for (let d = 0; d < maxSearch; d++) {
    const fwd = startIdx + d;
    if (fwd <= last && rawSamples[fwd] * rawSamples[fwd + 1] <= 0) return fwd / sampleRate;
    const bwd = startIdx - d;
    if (bwd >= 1  && rawSamples[bwd] * rawSamples[bwd - 1] <= 0) return bwd / sampleRate;
  }
  return timeSeconds;
}

/**
 * Step to the next zero crossing in one direction.
 * @param {number} timeSeconds
 * @param {Float32Array} rawSamples
 * @param {number} sampleRate
 * @param {'forward'|'backward'} direction
 * @returns {number}
 */
export function findNextZeroCrossing(timeSeconds, rawSamples, sampleRate, direction) {
  const startIdx = Math.round(timeSeconds * sampleRate);
  const last     = rawSamples.length - 2;

  if (direction === 'forward') {
    for (let i = startIdx + 1; i < last; i++) {
      if (rawSamples[i] * rawSamples[i + 1] <= 0) return i / sampleRate;
    }
  } else {
    for (let i = startIdx - 1; i > 0; i--) {
      if (rawSamples[i] * rawSamples[i - 1] <= 0) return i / sampleRate;
    }
  }
  return timeSeconds;
}

/**
 * Draw waveform, trim markers, and optional playhead onto a canvas.
 * Palette matches ES-1 design system.
 */
export function drawWaveform(canvas, peaks, duration, trimStart = 0, trimEnd = null, playheadRatio = null) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const end = trimEnd ?? duration;

  ctx.clearRect(0, 0, W, H);

  const startRatio = duration > 0 ? trimStart / duration : 0;
  const endRatio   = duration > 0 ? end / duration       : 1;
  const barW       = Math.max(1, W / peaks.length - 0.5);

  for (let i = 0; i < peaks.length; i++) {
    const x      = (i / peaks.length) * W;
    const h      = peaks[i] * H * 0.88;
    const y      = (H - h) / 2;
    const ratio  = i / peaks.length;
    const active = ratio >= startRatio && ratio <= endRatio;
    // In range: phosphor green · Out of range: deep dim
    ctx.fillStyle = active ? '#5abf3c' : '#2a2a40';
    ctx.fillRect(x, y, barW, h);
  }

  // Trim markers
  const drawMarker = (ratio, color) => {
    const x = Math.round(ratio * W) + 0.5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  };

  drawMarker(startRatio, '#5abf3c');    // green = start
  drawMarker(endRatio,   '#e07a00');    // amber = end

  // Playhead
  if (playheadRatio !== null) {
    const x = Math.round(playheadRatio * W) + 0.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
}
