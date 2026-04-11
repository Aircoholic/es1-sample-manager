// ============================================================
// es1Encoder.js  —  Korg ES-1 ADPCM Encoder
// Reverse engineered from Korg ES2WAV.EXE by polluxsynth (2004)
// JavaScript port for ES-1 Sample Manager
// ============================================================

const indextable = [
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7,
   8, 8, 9, 9,10,10,11,12,13,13,14,15,16,17,18,19,
];

const stepsizetable = [
  [  2,  3,  3,  3,  3,  4,  4,  4,  5,  5,  6,  6,  7,  7,  8,  9,
    10, 11, 12, 13, 14, 15, 17, 18, 20, 22, 24, 27, 29, 32, 35, 39,
    43, 47, 52, 57, 62, 69, 75, 83, 91,100,110,121,133,146,161,177,
   195,214,235,259,285,313,344,379,417,458,504,554,610,671,738,811 ],
  [ 29, 32, 34, 37, 39, 42, 45, 49, 52, 56, 60, 65, 70, 75, 80, 86,
    93,100,107,115,124,133,143,154,166,178,191,206,221,238,255,274,
   295,317,341,367,394,424,455,490,526,566,608,654,703,756,813,874,
   939,1010,1086,1167,1255,1349,1450,1559,1677,1802,1938,2083,2240,2408,2589,2783 ],
  [ 442,465,488,512,538,565,593,622,653,686,720,756,794,834,875,919,
   965,1013,1064,1117,1173,1232,1293,1358,1426,1497,1572,1650,1733,1819,1910,2005,
   2106,2211,2321,2437,2559,2687,2821,2962,3110,3266,3429,3600,3780,3969,4168,4376,
   4595,4824,5065,5319,5584,5864,6157,6464,6787,7127,7483,7857,8250,8662,9095,9549 ],
  [ 6916,7089,7267,7448,7634,7825,8021,8221,8427,8638,8853,9075,9302,9534,9773,10017,
   10267,10524,10787,11057,11333,11616,11907,12204,12509,12822,13143,13471,13808,14153,14507,14870,
   15241,15622,16013,16413,16823,17244,17675,18117,18570,19034,19510,19998,20497,21010,21535,22073,
   22625,23191,23771,24365,24974,25598,26238,26894,27566,28256,28962,29686,30428,31189,31968,32767 ],
];

const FRAMESIZE     = 32;
const DELTA_SIGNBIT = 64;
const DELTA_MAX     = 63;

export const HEADERPOS   = 0x80000;
export const HDR_BASE    = HEADERPOS + 8;
export const MHDR_SIZE   = 26;
export const ADDR_OFFSET = 0x160000;
export const SAMPLE_RAM  = 0x200000;
export const ES1_SIZE    = 4 * 1024 * 1024;
export const ES1_SR      = 32000;

function stepsizeToIndex(stepsize, tn) {
  const t = stepsizetable[tn];
  let tp = 47, index = 0;
  tp -= 16;
  if (stepsize >= t[tp+16]) { index += 48; tp += 24; }
  else {
    tp -= 16;
    if (stepsize >= t[tp+16]) { index += 32; tp += 24; }
    else { tp -= 8; if (stepsize >= t[tp+8]) { index += 16; tp += 16; } }
  }
  tp -= 4; if (stepsize >= t[tp+4]) { index += 8; tp += 8; }
  tp -= 2; if (stepsize >= t[tp+2]) { index += 4; tp += 4; }
  tp -= 1; if (stepsize >= t[tp+1]) { index += 2; tp += 2; }
  if (stepsize >= t[tp]) index += 1;
  return index;
}

function encodeFrame(samples) {
  const fsv = samples[0];
  let diffMax = 0, diffAvg = 0, startdiffMax = 0;
  for (let i = 1; i < FRAMESIZE; i++) {
    const d  = Math.abs(samples[i] - samples[i-1]);
    const sd = Math.abs(samples[i] - fsv);
    if (d  > diffMax)      diffMax      = d;
    if (sd > startdiffMax) startdiffMax = sd;
    diffAvg += d;
  }
  diffAvg >>= 5;

  const temp = (diffMax * 73 + ((diffMax * 9362) >> 16)) >> 7;
  let tn = 3;
  if      (temp <= stepsizetable[0][63]) tn = 0;
  else if (temp <= stepsizetable[1][63]) tn = 1;
  else if (temp <= stepsizetable[2][63]) tn = 2;

  let sdm = startdiffMax, bd = 0;
  if (sdm > 255) { bd += 8; sdm >>= 8; }
  if (sdm >  15) { bd += 4; sdm >>= 4; }
  if (sdm >   3) { bd += 2; sdm >>= 2; }
  if (sdm >   1) { bd += 1; }

  const temp2 = (diffMax * 63 + ((diffMax * 32509) >> 16)) >> 7;
  const mdi   = stepsizeToIndex(temp2, tn);

  const startdiff = Math.abs(samples[1] - samples[0]);
  let sd2 = startdiff;
  if (sd2 <= diffAvg << 1) sd2 = diffAvg;
  let si = stepsizeToIndex(sd2, tn);
  if (si < mdi) si = mdi;

  const dynamics   = (1 << (bd + 1)) - 1;
  const highestval = Math.min(fsv + dynamics,  65535);
  const lowestval  = Math.max(fsv - dynamics, -65535);
  const table      = stepsizetable[tn];
  let sptr = si, curval = fsv;
  const deltas = new Uint8Array(FRAMESIZE - 1);

  for (let i = 1; i < FRAMESIZE; i++) {
    let newval = fsv + curval;
    newval += (newval < 0) ? 1 : 0;
    newval >>= 1;
    const tmp2   = table[sptr] << 1;
    const minval = highestval - tmp2;
    const maxval = lowestval  + tmp2;
    let valcase;
    if (curval >= minval) {
      if (curval <= maxval) { curval = newval; valcase = 3; if (sptr > 0) sptr--; }
      else                  { curval = minval; valcase = 2; }
    } else {
      if (curval <= maxval) { curval = maxval; valcase = 1; }
      else                  { valcase = 0; }
    }
    const diffTgt = samples[i] - curval;
    const sign    = diffTgt < 0 ? DELTA_SIGNBIT : 0;
    const dabs    = sign ? -diffTgt : diffTgt;
    let delta     = Math.floor((dabs * 32) / table[sptr]);
    if (delta > 63) delta = 63;
    const vpdiff  = ((2 * delta + 1) * table[sptr]) >> 6;
    curval = sign ? curval - vpdiff : curval + vpdiff;
    curval = Math.max(-32767, Math.min(32767, curval));
    if (valcase > 1) {
      sptr = (valcase === 2 && sign) ? sptr + indextable[delta] : sptr - 1;
    } else {
      sptr = (valcase === 1 && sign) ? sptr - 1 : sptr + indextable[delta];
    }
    sptr = Math.max(mdi, Math.min(DELTA_MAX, sptr));
    deltas[i-1] = delta | sign;
  }

  // packbuf: 2 tn-Bits + 31×7 delta-Bits = 219 Bits → 28 Bytes ab o[4]
  const o = new Uint8Array(FRAMESIZE);
  const fsvU = fsv & 0xFFFF;
  o[0] = (fsvU >> 8) & 0xFF;
  o[1] =  fsvU       & 0xFF;
  o[2] = ((si  << 2) | (mdi >> 4)) & 0xFF;
  o[3] = (((mdi & 0xF) << 4) | (bd & 0xF)) & 0xFF;

  const bits = [(tn >> 1) & 1, tn & 1];
  for (let i = 0; i < 31; i++)
    for (let b = 6; b >= 0; b--) bits.push((deltas[i] >> b) & 1);
  while (bits.length < 224) bits.push(0);
  for (let byte = 0; byte < 28; byte++) {
    let val = 0;
    for (let bit = 0; bit < 8; bit++) val = (val << 1) | bits[byte * 8 + bit];
    o[4 + byte] = val;
  }
  return o;
}

export function resampleLinear(samples, srcSR, dstSR = ES1_SR) {
  if (srcSR === dstSR) return samples;
  const ratio = srcSR / dstSR;
  const nOut  = Math.floor(samples.length / ratio);
  const out   = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) {
    const pos = i * ratio, idx = Math.floor(pos), frac = pos - idx;
    out[i] = idx + 1 < samples.length
      ? samples[idx] * (1 - frac) + samples[idx+1] * frac
      : (samples[idx] || 0);
  }
  return out;
}

export function createEmptyES1() {
  const data = new Uint8Array(ES1_SIZE);
  data.set([75,79,82,71,0,0,87], 0);
  data.set([75,79,82,71,0,0,87], HEADERPOS);
  for (let s = 0; s < 100; s++) data[HDR_BASE + s * MHDR_SIZE + 21] = 0xFF;
  const sb = HDR_BASE + 100 * MHDR_SIZE;
  for (let s = 0; s <  50; s++) data[sb + s * 28 + 21] = 0xFF;
  return data;
}

/**
 * Schreibt einen Sample-Slot in eine .es1-Datei.
 * @param {Uint8Array}   es1         Die .es1-Datei (wird in-place modifiziert)
 * @param {number}       slotNo      0–99
 * @param {Float32Array} samples32k  Mono-Audio bei 32 kHz, [-1.0 .. 1.0]
 * @param {number}       nextRamAddr Nächste freie RAM-Adresse
 * @param {function}     onProgress  Callback (framesGemacht, framesGesamt)
 * @returns {number}     Neue nextRamAddr
 */
export function writeSlot(es1, slotNo, samples32k, nextRamAddr, onProgress) {
  const pcm16 = new Int16Array(samples32k.length);
  for (let i = 0; i < samples32k.length; i++) {
    pcm16[i] = Math.max(-32767, Math.min(32767, Math.round(samples32k[i] * 32767)));
  }

  const nFrames  = Math.ceil(pcm16.length / FRAMESIZE);
  const adpcm    = new Uint8Array(nFrames * FRAMESIZE);
  const frameBuf = new Int16Array(FRAMESIZE);

  for (let fn = 0; fn < nFrames; fn++) {
    for (let i = 0; i < FRAMESIZE; i++) {
      frameBuf[i] = fn * FRAMESIZE + i < pcm16.length ? pcm16[fn * FRAMESIZE + i] : 0;
    }
    adpcm.set(encodeFrame(frameBuf), fn * FRAMESIZE);
    if (onProgress && fn % 64 === 0) onProgress(fn, nFrames);
  }
  if (onProgress) onProgress(nFrames, nFrames);

  const staddr  = nextRamAddr;
  const endaddr = staddr + adpcm.length - 1;
  const fileOff = staddr - ADDR_OFFSET;

  if (fileOff < 0 || fileOff + adpcm.length > es1.length)
    throw new Error(`Slot ${slotNo}: Kein Platz auf der Karte! (fileOff=0x${fileOff.toString(16)})`);

  es1.set(adpcm, fileOff);

  const hoff   = HDR_BASE + slotNo * MHDR_SIZE;
  const endSmp = samples32k.length - 1;
  es1[hoff+3]  = (endSmp  >> 16) & 0xFF;
  es1[hoff+4]  = (endSmp  >>  8) & 0xFF;
  es1[hoff+5]  =  endSmp         & 0xFF;
  es1[hoff+12] = (staddr  >> 16) & 0xFF;
  es1[hoff+13] = (staddr  >>  8) & 0xFF;
  es1[hoff+14] =  staddr         & 0xFF;
  es1[hoff+15] = (endaddr >> 16) & 0xFF;
  es1[hoff+16] = (endaddr >>  8) & 0xFF;
  es1[hoff+17] =  endaddr        & 0xFF;
  es1[hoff+21] = 0;

  return ((endaddr + FRAMESIZE) >> 5) << 5;
}

export function downloadES1(es1bytes, filename = 'backup.es1') {
  const blob = new Blob([es1bytes], { type: 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
