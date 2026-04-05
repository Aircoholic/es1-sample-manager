/**
 * Reads a file and returns duration, downsampled waveform peaks, raw samples, and sample rate.
 */
export async function analyzeFile(file) {
  const arrayBuffer = await file.arrayBuffer();
  const audioCtx = new AudioContext();
  const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
  await audioCtx.close();

  const duration = audioBuffer.duration;
  const rawData = audioBuffer.getChannelData(0);
  const samples = 1000;
  const blockSize = Math.floor(rawData.length / samples);
  const peaks = new Float32Array(samples);

  for (let i = 0; i < samples; i++) {
    let max = 0;
    for (let j = 0; j < blockSize; j++) {
      const val = Math.abs(rawData[i * blockSize + j]);
      if (val > max) max = val;
    }
    peaks[i] = max;
  }

  const rawSamples = new Float32Array(rawData);

  return { duration, peaks, rawSamples, sampleRate: audioBuffer.sampleRate };
}

/**
 * Finds the nearest zero crossing to a given time position, searching in both directions.
 */
export function findZeroCrossing(timeSeconds, rawSamples, sampleRate) {
  const startIdx = Math.round(timeSeconds * sampleRate);
  const maxSearch = Math.round(0.02 * sampleRate);

  for (let d = 0; d < maxSearch; d++) {
    const iForward = startIdx + d;
    const iBack = startIdx - d;

    if (iForward < rawSamples.length - 1) {
      if (rawSamples[iForward] * rawSamples[iForward + 1] <= 0) {
        return iForward / sampleRate;
      }
    }
    if (iBack > 0) {
      if (rawSamples[iBack] * rawSamples[iBack - 1] <= 0) {
        return iBack / sampleRate;
      }
    }
  }

  return timeSeconds;
}

/**
 * Finds the next zero crossing in a given direction from a time position.
 * direction: 'forward' or 'backward'
 */
export function findNextZeroCrossing(timeSeconds, rawSamples, sampleRate, direction) {
  const startIdx = Math.round(timeSeconds * sampleRate);
  const maxSearch = rawSamples.length;

  if (direction === 'forward') {
    for (let i = startIdx + 1; i < maxSearch - 1; i++) {
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
 * Draws the waveform, trim markers, and optional playhead on a canvas element.
 */
export function drawWaveform(canvas, peaks, duration, trimStart = 0, trimEnd = null, playheadRatio = null) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;
  const end = trimEnd ?? duration;

  ctx.clearRect(0, 0, W, H);

  const startRatio = trimStart / duration;
  const endRatio = end / duration;

  peaks.forEach((peak, i) => {
    const x = (i / peaks.length) * W;
    const barHeight = peak * H * 0.9;
    const y = (H - barHeight) / 2;
    const ratio = i / peaks.length;
    const inRange = ratio >= startRatio && ratio <= endRatio;
    ctx.fillStyle = inRange ? '#a78bfa' : '#3a3a5e';
    ctx.fillRect(x, y, Math.max(1, W / peaks.length - 1), barHeight);
  });

  const drawMarker = (ratio, color) => {
    const x = ratio * W;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  };

  drawMarker(startRatio, '#4ade80');
  drawMarker(endRatio, '#f87171');

  if (playheadRatio !== null) {
    const x = playheadRatio * W;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, H);
    ctx.stroke();
  }
}