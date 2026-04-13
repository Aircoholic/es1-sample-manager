/**
 * es1Encoder.js — Korg ES-1 ADPCM Encoder
 *
 * Reverse-engineered from Korg's es2wav.exe via polluxsynth/es12wav (adpcm.c, 2004).
 * File layout verified against real ES-1 hardware backups (Phase 1–3 analysis, 2026).
 *
 * Key verified facts (from hardware backup hex analysis):
 *   - .es1 file size: exactly 3 801 088 bytes = 29 × 2^17
 *   - Header 1 at 0x000000, Header 2 at 0x080000 (16-byte KORG magic each)
 *   - Slot table starts at 0x080010 (immediately after second header)
 *   - Each mono slot descriptor = 26 bytes:
 *       [4..6]  STADDR  — 3-byte BE stored audio start address
 *       [7..9]  ENDADDR — 3-byte BE stored audio end address
 *       [21]    STATUS  — 0xFF = empty; 0x00 = occupied
 *   - file_offset = stored_addr - ADDR_OFFSET (= stored_addr - 0x160000)
 *   - Audio data zone: file offsets 0x0A0000 – 0x39FFFF
 *   - First sample RAM address: 0x200000 (= 0x0A0000 + 0x160000)
 *   - ADPCM: 32 bytes per block, encodes 32 samples (1 ms @ 32 kHz)
 */

// ─── ADPCM TABLES (from es2wav.exe, via polluxsynth) ──────────────────────────

const INDEX_TABLE = [
  -1,-1,-1,-1,-1,-1,-1,-1, -1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1, -1,-1,-1,-1,-1,-1,-1,-1,
   1, 1, 1, 1, 2, 2, 3, 3,  4, 4, 5, 5, 6, 6, 7, 7,
   8, 8, 9, 9,10,10,11,12, 13,13,14,15,16,17,18,19,
];

const STEP_TABLE = [
  [2,3,3,3,3,4,4,4,5,5,6,6,7,7,8,9,10,11,12,13,14,15,17,18,20,22,24,27,29,32,35,39,
   43,47,52,57,62,69,75,83,91,100,110,121,133,146,161,177,195,214,235,259,285,313,344,379,
   417,458,504,554,610,671,738,811],
  [29,32,34,37,39,42,45,49,52,56,60,65,70,75,80,86,93,100,107,115,124,133,143,154,166,178,
   191,206,221,238,255,274,295,317,341,367,394,424,455,490,526,566,608,654,703,756,813,874,
   939,1010,1086,1167,1255,1349,1450,1559,1677,1802,1938,2083,2240,2408,2589,2783],
  [442,465,488,512,538,565,593,622,653,686,720,756,794,834,875,919,965,1013,1064,1117,1173,
   1232,1293,1358,1426,1497,1572,1650,1733,1819,1910,2005,2106,2211,2321,2437,2559,2687,2821,
   2962,3110,3266,3429,3600,3780,3969,4168,4376,4595,4824,5065,5319,5584,5864,6157,6464,6787,
   7127,7483,7857,8250,8662,9095,9549],
  [6916,7089,7267,7448,7634,7825,8021,8221,8427,8638,8853,9075,9302,9534,9773,10017,10267,
   10524,10787,11057,11333,11616,11907,12204,12509,12822,13143,13471,13808,14153,14507,14870,
   15241,15622,16013,16413,16823,17244,17675,18117,18570,19034,19510,19998,20497,21010,21535,
   22073,22625,23191,23771,24365,24974,25598,26238,26894,27566,28256,28962,29686,30428,31189,
   31968,32767],
];

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

/** Exact .es1 file size (29 × 2^17 bytes) */
export const ES1_SIZE     = 3_801_088;

/** ES-1 sample rate (Hz) */
export const ES1_SR       = 32_000;

/** Samples per ADPCM block (= block size in bytes) */
export const FRAMESIZE    = 32;

const HEADERPOS   = 0x080000;   // second KORG header
const HDR_BASE    = 0x080010;   // slot table start (HEADERPOS + 16)
const MHDR_SIZE   = 26;         // mono slot record size
const SHDR_SIZE   = 28;         // stereo slot record size
const MONO_SLOTS  = 100;
const STEREO_SLOTS = 50;
const ADDR_OFFSET = 0x160000;   // stored_addr = file_offset + ADDR_OFFSET
const RAM_START   = 0x200000;   // first sample RAM address (file offset 0x0A0000)

// Exact header bytes (read from hardware backup, 2026)
const HDR1 = [0x4B,0x4F,0x52,0x47, 0x01,0x00,0x57,0x02,
              0x00,0x00,0x00,0x00, 0x00,0x00,0xBB,0xB3];
const HDR2 = [0x4B,0x4F,0x52,0x47, 0x01,0x00,0x57,0x01,
              0x00,0x00,0x00,0x00, 0x00,0x00,0xAF,0x3E];

// ─── ADPCM CORE ───────────────────────────────────────────────────────────────

function stepsizeToIndex(stepsize, tn) {
  const t = STEP_TABLE[tn];
  let tp = 47, idx = 0;
  tp -= 16;
  if (stepsize >= t[tp + 16]) { idx += 48; tp += 24; }
  else {
    tp -= 16;
    if (stepsize >= t[tp + 16]) { idx += 32; tp += 24; }
    else { tp -= 8; if (stepsize >= t[tp + 8]) { idx += 16; tp += 16; } }
  }
  tp -= 4; if (stepsize >= t[tp + 4]) { idx +=  8; tp += 8; }
  tp -= 2; if (stepsize >= t[tp + 2]) { idx +=  4; tp += 4; }
  tp -= 1; if (stepsize >= t[tp + 1]) { idx +=  2; tp += 2; }
  if (stepsize >= t[tp]) idx += 1;
  return Math.min(63, Math.max(0, idx));
}

/**
 * Encode one 32-sample ADPCM frame → 32 bytes.
 * Ported from adpcm.c compress() (polluxsynth/es12wav).
 * @param {Int16Array|number[]} samples  32 signed 16-bit values
 * @returns {Uint8Array}  32-byte encoded block
 */
function encodeFrame(samples) {
  const fsv = samples[0];
  let diffMax = 0, sdMax = 0, diffSum = 0;
  const startDiff = Math.abs(samples[1] - samples[0]);

  for (let i = 1; i < FRAMESIZE; i++) {
    const d = Math.abs(samples[i] - samples[i - 1]);
    const s = Math.abs(samples[i] - fsv);
    if (d > diffMax) diffMax = d;
    if (s > sdMax)   sdMax   = s;
    diffSum += d;
  }
  const diffAvg = diffSum >> 5;

  // Select table (0 = small steps, 3 = large steps)
  const tnT = (diffMax * 73 + Math.floor((diffMax * 9362) / 65536)) >> 7;
  let tn = 3;
  if      (tnT <= STEP_TABLE[0][63]) tn = 0;
  else if (tnT <= STEP_TABLE[1][63]) tn = 1;
  else if (tnT <= STEP_TABLE[2][63]) tn = 2;

  // bitdynamics
  let bd = 0, sdm = sdMax;
  if (sdm > 255) { bd += 8; sdm >>= 8; }
  if (sdm >  15) { bd += 4; sdm >>= 4; }
  if (sdm >   3) { bd += 2; sdm >>= 2; }
  if (sdm >   1) bd += 1;
  bd = Math.min(15, bd);

  const miT = (diffMax * 63 + Math.floor((diffMax * 32509) / 65536)) >> 7;
  const mi  = stepsizeToIndex(miT, tn);

  let sd2 = startDiff;
  if (sd2 <= diffAvg << 1) sd2 = diffAvg;
  const si = Math.max(stepsizeToIndex(sd2, tn), mi);

  const T   = STEP_TABLE[tn];
  const dyn = (1 << (bd + 1)) - 1;
  const hv  = Math.min( 65535, fsv + dyn);
  const lv  = Math.max(-65535, fsv - dyn);

  let ssp = si, cv = fsv;
  const dl = new Uint8Array(FRAMESIZE - 1);

  for (let i = 1; i < FRAMESIZE; i++) {
    let nv = fsv + cv;
    nv += (nv < 0 ? 1 : 0);
    nv >>= 1;
    const tmp = T[ssp] << 1, mnv = hv - tmp, mxv = lv + tmp;
    let vc;
    if (cv >= mnv) {
      if (cv <= mxv) { cv = nv; vc = 3; ssp = Math.max(0, ssp - 1); }
      else           { cv = mnv; vc = 2; }
    } else {
      if (cv <= mxv) { cv = mxv; vc = 1; }
      else           { vc = 0; }
    }

    let diff = samples[i] - cv;
    const sgn = diff < 0 ? 64 : 0;
    if (sgn) diff = -diff;
    const delta  = Math.min(63, Math.floor((diff * 32) / T[ssp]));
    const vpdiff = ((2 * delta + 1) * T[ssp]) >> 6;

    cv = sgn ? cv - vpdiff : cv + vpdiff;
    cv = Math.max(-32767, Math.min(32767, cv));
    dl[i - 1] = delta | sgn;

    if (vc > 1) ssp = (vc === 2 && sgn) ? ssp + INDEX_TABLE[delta] : ssp - 1;
    else        ssp = (vc === 1 && sgn) ? ssp - 1 : ssp + INDEX_TABLE[delta];
    ssp = Math.max(mi, Math.min(63, ssp));
  }

  // Pack bits
  const o = new Uint8Array(FRAMESIZE);
  const u = fsv & 0xFFFF;
  o[0] = (u >> 8) & 0xFF;  o[1] = u & 0xFF;
  o[2] = ((si & 0x3F) << 2) | ((mi >> 4) & 0x03);
  o[3] = ((mi & 0x0F) << 4) | (bd & 0x0F);
  o[4] = ((tn & 0x03) << 6) | ((dl[0] >> 6) & 0x01);

  o[ 5]=((dl[ 0]&63)<<2)|(dl[ 1]>>5); o[ 6]=((dl[ 1]&31)<<3)|(dl[ 2]>>4);
  o[ 7]=((dl[ 2]&15)<<4)|(dl[ 3]>>3); o[ 8]=((dl[ 3]& 7)<<5)|(dl[ 4]>>2);
  o[ 9]=((dl[ 4]& 3)<<6)|(dl[ 5]>>1); o[10]=((dl[ 5]& 1)<<7)| dl[ 6];
  o[11]= (dl[ 7]    <<1)|(dl[ 8]>>6); o[12]=((dl[ 8]&63)<<2)|(dl[ 9]>>5);
  o[13]=((dl[ 9]&31)<<3)|(dl[10]>>4); o[14]=((dl[10]&15)<<4)|(dl[11]>>3);
  o[15]=((dl[11]& 7)<<5)|(dl[12]>>2); o[16]=((dl[12]& 3)<<6)|(dl[13]>>1);
  o[17]=((dl[13]& 1)<<7)| dl[14];     o[18]= (dl[15]    <<1)|(dl[16]>>6);
  o[19]=((dl[16]&63)<<2)|(dl[17]>>5); o[20]=((dl[17]&31)<<3)|(dl[18]>>4);
  o[21]=((dl[18]&15)<<4)|(dl[19]>>3); o[22]=((dl[19]& 7)<<5)|(dl[20]>>2);
  o[23]=((dl[20]& 3)<<6)|(dl[21]>>1); o[24]=((dl[21]& 1)<<7)| dl[22];
  o[25]= (dl[23]    <<1)|(dl[24]>>6); o[26]=((dl[24]&63)<<2)|(dl[25]>>5);
  o[27]=((dl[25]&31)<<3)|(dl[26]>>4); o[28]=((dl[26]&15)<<4)|(dl[27]>>3);
  o[29]=((dl[27]& 7)<<5)|(dl[28]>>2); o[30]=((dl[28]& 3)<<6)|(dl[29]>>1);
  o[31]=((dl[29]& 1)<<7)| dl[30];
  return o;
}

// ─── PUBLIC API ───────────────────────────────────────────────────────────────

/**
 * Create a blank .es1 image (3 801 088 bytes) with correct headers
 * and all 100 mono + 50 stereo slots marked empty (STATUS = 0xFF).
 *
 * Fill is 0xFF (= erased NOR flash state). Only the header magic and
 * the slot table region are written.
 *
 * @returns {Uint8Array}
 */
export function createEmptyES1() {
  const data = new Uint8Array(ES1_SIZE).fill(0xFF);

  // Write both KORG headers (exact magic bytes from hardware)
  HDR1.forEach((b, i) => { data[0          + i] = b; });
  HDR2.forEach((b, i) => { data[HEADERPOS  + i] = b; });

  // Zero-fill slot table, then mark every slot empty
  const monoEnd   = HDR_BASE  + MONO_SLOTS   * MHDR_SIZE;
  const stereoEnd = monoEnd   + STEREO_SLOTS * SHDR_SIZE;
  data.fill(0x00, HDR_BASE, stereoEnd);

  for (let s = 0; s < MONO_SLOTS;   s++) data[HDR_BASE + s * MHDR_SIZE + 21] = 0xFF;
  for (let s = 0; s < STEREO_SLOTS; s++) data[monoEnd  + s * SHDR_SIZE + 21] = 0xFF;

  return data;
}

/**
 * Encode a mono 32 kHz sample and write it into an .es1 image.
 *
 * @param {Uint8Array}   es1         .es1 image (modified in-place)
 * @param {number}       slotNo      0–99
 * @param {Float32Array} samples32k  Mono, 32 kHz, float [-1 .. 1]
 * @param {number}       nextRamAddr Next free RAM address (start: RAM_START = 0x200000)
 * @param {function}     [onProgress] Callback (framesDone, framesTotal)
 * @returns {number}     Updated nextRamAddr (32-byte aligned)
 */
export function writeSlot(es1, slotNo, samples32k, nextRamAddr, onProgress) {
  if (slotNo < 0 || slotNo >= MONO_SLOTS) {
    throw new RangeError(`Slot ${slotNo} out of range (0–${MONO_SLOTS - 1})`);
  }

  // Float32 → Int16
  const pcm16 = new Int16Array(samples32k.length);
  for (let i = 0; i < samples32k.length; i++) {
    pcm16[i] = Math.max(-32767, Math.min(32767, Math.round(samples32k[i] * 32767)));
  }

  // Encode in ADPCM blocks
  const nFrames  = Math.ceil(pcm16.length / FRAMESIZE);
  const adpcm    = new Uint8Array(nFrames * FRAMESIZE);
  const frameBuf = new Int16Array(FRAMESIZE);

  for (let fn = 0; fn < nFrames; fn++) {
    for (let i = 0; i < FRAMESIZE; i++) {
      frameBuf[i] = (fn * FRAMESIZE + i < pcm16.length) ? pcm16[fn * FRAMESIZE + i] : 0;
    }
    adpcm.set(encodeFrame(frameBuf), fn * FRAMESIZE);
    if (onProgress && (fn & 63) === 0) onProgress(fn, nFrames);
  }
  onProgress?.(nFrames, nFrames);

  // Addresses
  const staddr    = nextRamAddr;                // value stored in header
  const endaddr   = staddr + adpcm.length - 1;
  const fileOff   = staddr - ADDR_OFFSET;       // actual file write position

  if (fileOff < 0 || fileOff + adpcm.length > ES1_SIZE) {
    throw new Error(`Slot ${slotNo}: audio zone full (addr=0x${fileOff.toString(16)})`);
  }

  // Write encoded audio
  es1.set(adpcm, fileOff);

  // Write slot descriptor (hardware-verified field positions):
  //   byte [4..6] = STADDR  (3-byte big-endian)
  //   byte [7..9] = ENDADDR (3-byte big-endian)
  //   byte [21]   = STATUS  (0x00 = occupied)
  const hoff = HDR_BASE + slotNo * MHDR_SIZE;
  es1[hoff + 4]  = (staddr  >> 16) & 0xFF;
  es1[hoff + 5]  = (staddr  >>  8) & 0xFF;
  es1[hoff + 6]  =  staddr         & 0xFF;
  es1[hoff + 7]  = (endaddr >> 16) & 0xFF;
  es1[hoff + 8]  = (endaddr >>  8) & 0xFF;
  es1[hoff + 9]  =  endaddr        & 0xFF;
  es1[hoff + 21] = 0x00;

  // Advance RAM pointer, aligned to 32 bytes
  return ((endaddr + FRAMESIZE) >> 5) << 5;
}

/**
 * Trigger a browser download of the .es1 file.
 * @param {Uint8Array} es1bytes
 * @param {string} [filename]
 */
export function downloadES1(es1bytes, filename = 'BACKUP.ES1') {
  const blob = new Blob([es1bytes], { type: 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Simple linear resampler (fallback — prefer AudioContext).
 * @param {Float32Array} samples
 * @param {number} srcSR
 * @param {number} [dstSR]
 * @returns {Float32Array}
 */
export function resampleLinear(samples, srcSR, dstSR = ES1_SR) {
  if (srcSR === dstSR) return samples;
  const ratio = srcSR / dstSR;
  const nOut  = Math.floor(samples.length / ratio);
  const out   = new Float32Array(nOut);
  for (let i = 0; i < nOut; i++) {
    const pos = i * ratio, idx = Math.floor(pos), frc = pos - idx;
    out[i] = idx + 1 < samples.length
      ? samples[idx] * (1 - frc) + samples[idx + 1] * frc
      : samples[idx] ?? 0;
  }
  return out;
}
