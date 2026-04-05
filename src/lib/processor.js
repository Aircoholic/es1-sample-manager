export async function processAudio(audioBuffer, options = {}) {
  const {
    normalize = false,
    removeDcOffset = false,
    highpassBoost = false,
  } = options;

  if (!normalize && !removeDcOffset && !highpassBoost) {
    return audioBuffer;
  }

  const numberOfChannels = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const length = audioBuffer.length;

  const offlineCtx = new OfflineAudioContext(numberOfChannels, length, sampleRate);

  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  let lastNode = source;

  if (removeDcOffset) {
    const dcFilter = offlineCtx.createBiquadFilter();
    dcFilter.type = 'highpass';
    dcFilter.frequency.value = 5;
    lastNode.connect(dcFilter);
    lastNode = dcFilter;
  }

  if (highpassBoost) {
    const boost = offlineCtx.createBiquadFilter();
    boost.type = 'highshelf';
    boost.frequency.value = 4000;
    boost.gain.value = 4;
    lastNode.connect(boost);
    lastNode = boost;
  }

  lastNode.connect(offlineCtx.destination);
  source.start(0);

  let renderedBuffer = await offlineCtx.startRendering();

  if (normalize) {
    let peak = 0;
    for (let c = 0; c < renderedBuffer.numberOfChannels; c++) {
      const data = renderedBuffer.getChannelData(c);
      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i]) > peak) peak = Math.abs(data[i]);
      }
    }
    if (peak > 0) {
      const gain = 0.891 / peak;
      for (let c = 0; c < renderedBuffer.numberOfChannels; c++) {
        const data = renderedBuffer.getChannelData(c);
        for (let i = 0; i < data.length; i++) data[i] *= gain;
      }
    }
  }

   return renderedBuffer;
}


export function audioBufferToWav(buffer) {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const length = buffer.length * numChannels * 2;
  const arrayBuffer = new ArrayBuffer(44 + length);
  const view = new DataView(arrayBuffer);

  const writeString = (offset, str) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + length, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * 2, true);
  view.setUint16(32, numChannels * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, length, true);

  let offset = 44;
  for (let i = 0; i < buffer.length; i++) {
    for (let c = 0; c < numChannels; c++) {
      const sample = Math.max(-1, Math.min(1, buffer.getChannelData(c)[i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: 'audio/wav' });
}