/**
 * es1Encoder.js — Korg ES-1 ADPCM Encoder & .ES1 Backup Writer
 *
 * ADPCM core ported from Korg's es2wav.exe via polluxsynth/es12wav (adpcm.c).
 *
 * VERIFIED SLOT RECORD FORMAT (26 bytes per mono slot):
 *   [0-3]   reserved 0x00
 *   [4-6]   STADDR_A — Range A start (24-bit BE, addr space −0x160000)
 *   [7-9]   ENDADDR_A — Range A end (inclusive, exact sample count)
 *   [10-12] STADDR_B — Range B start (24-bit BE, addr space −0x060000)
 *   [13-15] ENDADDR_B — Range B end (inclusive, 32-byte aligned)
 *   [16-18] reserved 0x00
 *   [19-21] LENGTH-1 as 24-bit BE — exact sample count minus 1
 *   [22-24] reserved 0x00
 *   [25]    SLOT_INDEX — slot_number for occupied; 0xFF for empty
 *
 * KEY DISCOVERIES (April 2026):
 *
 * 1. RANGE B IS THE PLAYBACK SOURCE
 *    - Range A virtual addr = file_offset + 0x160000
 *    - Range B virtual addr = file_offset + 0x060000  ← different offset!
 *    - For audio at file 0x0a0000: Range B = 0x100000 (NOT 0x200000)
 *    - The ES-1 reads Range B for playback. Range A serves as a secondary
 *      address space targeting the same physical audio data.
 *    - Verified via Korg 4.es1 slot 2: Range B at 0x100000+offset → file
 *      0x0b9b20 decodes to [0,10,2,13,4,13,8,17] — exact match with the
 *      es2wav-extracted 02.wav.
 *
 * 2. PATTERN AREA MUST BE INITIALIZED
 *    - Bytes 0x000100–0x07FFFF hold global+pattern data (BPM, parts, steps,
 *      effects). Filling with 0x00 OR 0xFF makes the device load the file
 *      but show "Off" in sample selection (samples not assigned to parts).
 *    - 0xFF = all params at max → 511 BPM, all FX on, all steps on (broken).
 *    - 0x00 = all params at zero → device shows "Off" for all parts.
 *    - Solution: embed Korg 4.es1's pattern area as a known-good template
 *      (524032 bytes, gzipped to ~1.9 KB).
 *
 * FILE LAYOUT:
 *   File size  : 3 801 088 bytes (29 × 2^17)
 *   HDR1 at 0x000000, HDR2 at 0x080000
 *   Slot table : 0x080010, 100 mono × 26 + 50 stereo × 28 bytes
 *   Audio zone : 0x0A0000 – 0x39FFFF (file offsets)
 *   BPM byte at 0x100 — hardware displays value × 2 (so store 60 for 120 BPM).
 */

// ─── ADPCM TABLES ─────────────────────────────────────────────────────────────

const INDEX_TABLE = [
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
  -1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,-1,
   1, 1, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7,
   8, 8, 9, 9,10,10,11,12,13,13,14,15,16,17,18,19,
];

const STEP_TABLE = [
  [2,3,3,3,3,4,4,4,5,5,6,6,7,7,8,9,10,11,12,13,14,15,17,18,20,22,24,27,29,32,35,39,
   43,47,52,57,62,69,75,83,91,100,110,121,133,146,161,177,195,214,235,259,285,313,344,
   379,417,458,504,554,610,671,738,811],
  [29,32,34,37,39,42,45,49,52,56,60,65,70,75,80,86,93,100,107,115,124,133,143,154,166,
   178,191,206,221,238,255,274,295,317,341,367,394,424,455,490,526,566,608,654,703,756,
   813,874,939,1010,1086,1167,1255,1349,1450,1559,1677,1802,1938,2083,2240,2408,2589,2783],
  [442,465,488,512,538,565,593,622,653,686,720,756,794,834,875,919,965,1013,1064,1117,
   1173,1232,1293,1358,1426,1497,1572,1650,1733,1819,1910,2005,2106,2211,2321,2437,2559,
   2687,2821,2962,3110,3266,3429,3600,3780,3969,4168,4376,4595,4824,5065,5319,5584,5864,
   6157,6464,6787,7127,7483,7857,8250,8662,9095,9549],
  [6916,7089,7267,7448,7634,7825,8021,8221,8427,8638,8853,9075,9302,9534,9773,10017,
   10267,10524,10787,11057,11333,11616,11907,12204,12509,12822,13143,13471,13808,14153,
   14507,14870,15241,15622,16013,16413,16823,17244,17675,18117,18570,19034,19510,19998,
   20497,21010,21535,22073,22625,23191,23771,24365,24974,25598,26238,26894,27566,28256,
   28962,29686,30428,31189,31968,32767],
];

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

export const ES1_SIZE  = 3_801_088;
export const ES1_SR    = 32_000;
export const FRAMESIZE = 32;

const HEADERPOS    = 0x080000;
const HDR_BASE     = 0x080010;
const MHDR_SIZE    = 26;
const SHDR_SIZE    = 28;
const MONO_SLOTS   = 100;
const STEREO_SLOTS = 50;

const AUDIO_ZONE_START = 0x0A0000;   // file offset where audio data begins
const AUDIO_ZONE_END   = 0x3A0000;   // file offset (exclusive)
const PATTERN_START    = 0x000100;   // pattern/global data area
const PATTERN_END      = 0x080000;   // up to (but not including) HDR2

// Range A virtual addr space:  stored = file_offset + 0x160000
// Range B virtual addr space:  stored = file_offset + 0x060000
const RANGE_A_OFFSET = 0x160000;
const RANGE_B_OFFSET = 0x060000;

// Public: the starting Range A address callers should pass for the first slot
export const RAM_START = AUDIO_ZONE_START + RANGE_A_OFFSET;  // 0x200000

const EMPTY_INDEX = 0xFF;

const HDR1 = [0x4B,0x4F,0x52,0x47,0x01,0x00,0x57,0x02,0x00,0x00,0x00,0x00,0x00,0x00,0xBB,0xB3];
const HDR2 = [0x4B,0x4F,0x52,0x47,0x01,0x00,0x57,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0xAF,0x3E];

// ─── EMBEDDED PATTERN TEMPLATE ────────────────────────────────────────────────
// Source: Korg Sound Designer Collection 4.es1 — bytes 0x000100–0x07FFFF.
// This file ships only sample slots (no user patterns), so its global+pattern
// region is essentially the Korg-provided "blank slate".
// Compressed with gzip → 1938 bytes → 2584 chars base64.
const PATTERN_TEMPLATE_B64 =
  'H4sIACqd7mkC/+3XV0+TYQCG4Q9wgDjALQ7cKO6NilicbAq2qLjFH+ABRxgj/80fptU4ImcG45cH' +
  'ruug6UHTJ3n7pnfb11R0FJXJomFgcZUrPr2rVIrOH4riyzIVf2ni+/5v/3t/tuT9FyXvnyl5f67k' +
  '/Z6S97tK3u8ueb+15P3iP+//fN1yv7f7NOyXJg3TMA3TMA3TsFDNGqZhGqZhGqZhoVo0TMM0TMM0' +
  'TMNCrdEwDdMwDdMwDQu1VsM0TMM0TMM0LNQ6DdMwDdMwDdOwUOs1TMM0TMM0TMNCtWqYhmmYhmmY' +
  'hoVq0zAN0zAN0zANC7VBwzRMwzRMwzQsVLuGaZiGaZiGaViojRqmYRqmYRqmYaE2aZiGaZiGaZiG' +
  'hdqsYRqmYRqmYRoWaouGaZiGaZiGaVioDg3TMA3TMA3TsFCdGqZhGqZhGqZhobZqmIZpmIZpmIaF' +
  '2qZhGqZhGqZhGhZqu4ZpmIZpmIZpWKgdGqZhGqZhGqZhoXZqmIZpmIZpmIaF2qVhGqZhGqZhGhZq' +
  't4ZpmIZpmIZpWKg9GqZhGqZhGqZhobo0TMM0TMM0TMNC7dUwDdMwDdMwDQu1T8M0TMM0TMM0LNR+' +
  'DdMwDdMwDdOwUAc0TMM0TMM0TMNCdWuYhmmYhmmYhoU6qGEapmEapmEaFuqQhmmYhmmYhmlYqMMa' +
  'pmEapmEapmGhjmiYhmmYhmmYhoU6qmEapmEapmEaFuqYhmmYhmmYhmlYqOMapmEapmEapmGhejRM' +
  'wzRMwzRMw0Kd0DAN0zAN0zANC3VSwzRMwzRMwzQsVK+GaZiGaZiGaVioUxqmYRqmYRqmYaFOa5iG' +
  'aZiGaZiGhTqjYRqmYRqmYRoW6qyGaZiGaZiGaViocxqmYRqmYRqmYaHOa5iGaZiGaZiGhbqgYRqm' +
  'YRqmYRoW6qKGaZiGaZiGaVioSxqmYRqmYRqmYaEua5iGaZiGaZiGhbqiYRqmYRqmYRoW6qqGaZiG' +
  'aZiGaVioaxqmYRqmYRqmYaH6NEzDNEzDNEzDQl3XMA3TMA3TMA0LdUPDNEzDNEzDNCzUTQ3TMA3T' +
  'MA3TsFD9GqZhGqZhGqZhoW5pmIZpmIZpmIaFGtAwDdMwDdMwDQt1W8M0TMM0TMM0LFRFwzRMwzRM' +
  'wzQs1KCGaZiGaZiGaVioOxqmYRqmYRqmYaHuapiGaZiGaZiGhbqnYRqmYRqmYRoW6r6GaZiGaZiG' +
  'aVioBxqmYRqmYRqmYaEeapiGaZiGaZiGhRrSMA3TMA3TMA0LNaxhGqZhGqZhGhZqRMM0TMM0TMM0' +
  'LNSohmmYhmmYhmlYqDEN0zAN0zAN07BQ4xqmYRqmYRqmYaEmNEzDNEzDNEzDQk1qmIZpmIZpmIaF' +
  'qmqYhmmYhmmYhoWa0jAN0zAN0zANCzWtYRqmYRqmYRoW6pGGaZiGaZiGaViomoZpmIZpmIZpWKi6' +
  'hmmYhmmYhmlYqBkN0zAN0zAN07BQjzVMwzRMwzRMw0I90TAN0zAN0zANC/VUwzRMwzRMwzQs1KyG' +
  'aZiGaZiGaVioZxqmYRqmYRqmYaGea5iGaZiGaZiGhXqhYRqmYRqmYRoW6qWGaZiGaZiGaVioVxqm' +
  'YRqmYRqmYaFea5iGaZiGaZiGhXqjYRqmYRqmYRoW6m3jM2zXMA3TMA3TMA0LNKdhGqZhGqZhGhbd' +
  'sPLukIZpmIZpmIZpmIZpmIZpmIZpmIZpmIZpmIZpWELDmjWs0bAuDdMwDdMwDfM/LLNh77sqbRqm' +
  'YRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqm' +
  'YRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqm' +
  'YRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqm' +
  'YRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqmYRqm' +
  'YRqmYRqmYRqmYUvUipbGu31Y+LBQsGr1Lm4rmgaHhoZGhofHG8bGRkdHRxpPJjb9wUmtZINF4xZ8' +
  'flSr1WfqM42H2mS1Wp2amp6e/jQ/P//xG4e04vU7AtwC3IJ/9FseAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAACgTHUAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' +
  'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgCW+AmnG5D4A/wcA';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function base64Decode(b64) {
  // Browser-safe base64 → Uint8Array
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function inflateGzip(bytes) {
  // DecompressionStream is supported in Chrome/Edge/Firefox/Safari (recent).
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

let _patternCache = null;
async function getPatternTemplate() {
  if (!_patternCache) {
    const compressed = base64Decode(PATTERN_TEMPLATE_B64);
    _patternCache = await inflateGzip(compressed);
    if (_patternCache.length !== PATTERN_END - PATTERN_START) {
      throw new Error(
        `Pattern template size mismatch: got ${_patternCache.length}, ` +
        `expected ${PATTERN_END - PATTERN_START}`
      );
    }
  }
  return _patternCache;
}

// ─── ADPCM ENCODER ────────────────────────────────────────────────────────────

function stepsizeToIndex(s, tn) {
  const t = STEP_TABLE[tn];
  let tp = 47, idx = 0;
  tp -= 16;
  if (s >= t[tp+16]) { idx += 48; tp += 24; }
  else {
    tp -= 16;
    if (s >= t[tp+16]) { idx += 32; tp += 24; }
    else { tp -= 8; if (s >= t[tp+8]) { idx += 16; tp += 16; } }
  }
  tp -= 4; if (s >= t[tp+4]) { idx += 8; tp += 8; }
  tp -= 2; if (s >= t[tp+2]) { idx += 4; tp += 4; }
  tp -= 1; if (s >= t[tp+1]) { idx += 2; tp += 2; }
  if (s >= t[tp]) idx += 1;
  return Math.min(63, Math.max(0, idx));
}

function encodeFrame(samples) {
  const fsv = samples[0];
  let dMax = 0, sdMax = 0, dSum = 0;
  const sd = Math.abs(samples[1] - samples[0]);
  for (let i = 1; i < FRAMESIZE; i++) {
    const d = Math.abs(samples[i]-samples[i-1]), s = Math.abs(samples[i]-fsv);
    if (d > dMax) dMax = d; if (s > sdMax) sdMax = s; dSum += d;
  }
  const dAvg = dSum >> 5;
  const tnT = (dMax*73+Math.floor((dMax*9362)/65536))>>7;
  let tn = 3;
  if (tnT <= STEP_TABLE[0][63]) tn = 0;
  else if (tnT <= STEP_TABLE[1][63]) tn = 1;
  else if (tnT <= STEP_TABLE[2][63]) tn = 2;
  let bd = 0, sdm = sdMax;
  if (sdm > 255){bd+=8;sdm>>=8;} if(sdm>15){bd+=4;sdm>>=4;} if(sdm>3){bd+=2;sdm>>=2;} if(sdm>1)bd+=1;
  bd = Math.min(15, bd);
  const mi = stepsizeToIndex((dMax*63+Math.floor((dMax*32509)/65536))>>7, tn);
  let sd2 = sd; if (sd2 <= dAvg<<1) sd2 = dAvg;
  const si = Math.max(stepsizeToIndex(sd2, tn), mi);
  const T = STEP_TABLE[tn];
  const dyn = (1<<(bd+1))-1;
  const hv = Math.min(65535,fsv+dyn), lv = Math.max(-65535,fsv-dyn);
  let ssp = si, cv = fsv;
  const dl = new Uint8Array(FRAMESIZE-1);
  for (let i = 1; i < FRAMESIZE; i++) {
    let nv = fsv+cv; nv += (nv<0?1:0); nv >>= 1;
    const tmp=T[ssp]<<1, mnv=hv-tmp, mxv=lv+tmp;
    let vc;
    if (cv>=mnv) { if(cv<=mxv){cv=nv;vc=3;ssp=Math.max(0,ssp-1);}else{cv=mnv;vc=2;} }
    else { if(cv<=mxv){cv=mxv;vc=1;}else{vc=0;} }
    let diff=samples[i]-cv; const sgn=diff<0?64:0; if(sgn)diff=-diff;
    const delta=Math.min(63,Math.floor((diff*32)/T[ssp]));
    const vp=((2*delta+1)*T[ssp])>>6;
    cv=sgn?cv-vp:cv+vp; cv=Math.max(-32767,Math.min(32767,cv));
    dl[i-1]=delta|sgn;
    if(vc>1)ssp=(vc===2&&sgn)?ssp+INDEX_TABLE[delta]:ssp-1;
    else ssp=(vc===1&&sgn)?ssp-1:ssp+INDEX_TABLE[delta];
    ssp=Math.max(mi,Math.min(63,ssp));
  }
  const o = new Uint8Array(FRAMESIZE);
  const u = fsv&0xFFFF;
  o[0]=(u>>8)&0xFF; o[1]=u&0xFF;
  o[2]=((si&0x3F)<<2)|((mi>>4)&0x03); o[3]=((mi&0x0F)<<4)|(bd&0x0F);
  o[4]=((tn&0x03)<<6)|((dl[0]>>6)&0x01);
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
 * Create a blank .ES1 image with sane hardware defaults.
 *
 * Async because the embedded pattern template is gzipped and decompressed
 * lazily via DecompressionStream (the inflated result is cached after the
 * first call).
 */
export async function createEmptyES1() {
  const data = new Uint8Array(ES1_SIZE);   // zero-filled

  // Embed the Korg-derived pattern/global template at 0x000100–0x07FFFF.
  // Without this the device shows "Off" for all parts after import.
  const template = await getPatternTemplate();
  data.set(template, PATTERN_START);

  // Magic headers
  HDR1.forEach((b, i) => { data[i] = b; });
  HDR2.forEach((b, i) => { data[HEADERPOS + i] = b; });

  // Audio zone = 0xFF (erased NOR flash)
  data.fill(0xFF, AUDIO_ZONE_START, AUDIO_ZONE_END);

  // Empty-slot marker: byte [25] = 0xFF (the template's slot table is for
  // 100 occupied slots, so we reset all slot records to "empty" first).
  for (let s = 0; s < MONO_SLOTS; s++) {
    const off = HDR_BASE + s * MHDR_SIZE;
    for (let b = 0; b < MHDR_SIZE; b++) data[off + b] = 0;
    data[off + 25] = EMPTY_INDEX;
  }
  const monoEnd = HDR_BASE + MONO_SLOTS * MHDR_SIZE;
  for (let s = 0; s < STEREO_SLOTS; s++) {
    const off = monoEnd + s * SHDR_SIZE;
    for (let b = 0; b < SHDR_SIZE; b++) data[off + b] = 0;
    data[off + 25] = EMPTY_INDEX;
  }

  return data;
}

/**
 * Encode a mono 32 kHz Float32Array into a slot.
 *
 * @param {Uint8Array}   es1           Image to modify in-place
 * @param {number}       slotNo        0–99 (mono slot)
 * @param {Float32Array} samples32k    Mono Float32 [-1..1] at 32 kHz
 * @param {number}       nextRamAddr   Range A virtual address for this slot.
 *                                     Pass RAM_START (0x200000) for the first
 *                                     slot; use the return value for subsequent
 *                                     slots.
 * @param {function}     [onProgress]  (framesDone, framesTotal)
 * @returns {number} Updated nextRamAddr (Range A virtual addr, 32-byte aligned)
 */
export function writeSlot(es1, slotNo, samples32k, nextRamAddr, onProgress) {
  if (slotNo < 0 || slotNo >= MONO_SLOTS)
    throw new RangeError(`Slot ${slotNo} out of range (0–${MONO_SLOTS - 1})`);

  // Float32 → Int16
  const nSamples = samples32k.length;
  const pcm16 = new Int16Array(nSamples);
  for (let i = 0; i < nSamples; i++)
    pcm16[i] = Math.max(-32767, Math.min(32767, Math.round(samples32k[i] * 32767)));

  // Encode ADPCM blocks (1 block = 32 input samples → 32 bytes)
  const nFrames    = Math.ceil(nSamples / FRAMESIZE);
  const paddedLen  = nFrames * FRAMESIZE;        // ADPCM byte count (32-aligned)
  const adpcm      = new Uint8Array(paddedLen);
  const buf        = new Int16Array(FRAMESIZE);

  for (let fn = 0; fn < nFrames; fn++) {
    for (let i = 0; i < FRAMESIZE; i++)
      buf[i] = (fn * FRAMESIZE + i < nSamples) ? pcm16[fn * FRAMESIZE + i] : 0;
    adpcm.set(encodeFrame(buf), fn * FRAMESIZE);
    if (onProgress && (fn & 63) === 0) onProgress(fn, nFrames);
  }
  onProgress?.(nFrames, nFrames);

  // ─── Address arithmetic ────────────────────────────────────────────────────
  // Audio data is written ONCE at file offset `fileOff`. Both Range A and
  // Range B point to the same file location via two different virtual address
  // spaces:
  //   Range A virtual addr = file_offset + 0x160000
  //   Range B virtual addr = file_offset + 0x060000
  const staddrA = nextRamAddr;
  const fileOff = staddrA - RANGE_A_OFFSET;
  const staddrB = fileOff + RANGE_B_OFFSET;

  // Range A end uses the EXACT sample count
  const endaddrA = staddrA + nSamples - 1;
  // Range B end uses the PADDED byte count (32-byte aligned)
  const endaddrB = staddrB + paddedLen - 1;

  if (fileOff < AUDIO_ZONE_START || fileOff + paddedLen > AUDIO_ZONE_END)
    throw new Error(`Slot ${slotNo}: audio zone full`);

  es1.set(adpcm, fileOff);

  // ─── Slot descriptor ───────────────────────────────────────────────────────
  const hoff = HDR_BASE + slotNo * MHDR_SIZE;

  // [0-3] reserved (already 0)

  // [4-6] STADDR_A
  es1[hoff + 4] = (staddrA >> 16) & 0xFF;
  es1[hoff + 5] = (staddrA >>  8) & 0xFF;
  es1[hoff + 6] =  staddrA        & 0xFF;

  // [7-9] ENDADDR_A (exact sample count)
  es1[hoff + 7] = (endaddrA >> 16) & 0xFF;
  es1[hoff + 8] = (endaddrA >>  8) & 0xFF;
  es1[hoff + 9] =  endaddrA        & 0xFF;

  // [10-12] STADDR_B (different addr space than A)
  es1[hoff + 10] = (staddrB >> 16) & 0xFF;
  es1[hoff + 11] = (staddrB >>  8) & 0xFF;
  es1[hoff + 12] =  staddrB        & 0xFF;

  // [13-15] ENDADDR_B (32-byte aligned)
  es1[hoff + 13] = (endaddrB >> 16) & 0xFF;
  es1[hoff + 14] = (endaddrB >>  8) & 0xFF;
  es1[hoff + 15] =  endaddrB        & 0xFF;

  // [16-18] reserved (already 0)
  es1[hoff + 16] = 0;
  es1[hoff + 17] = 0;
  es1[hoff + 18] = 0;

  // [19-21] LENGTH-1 as 24-bit BE
  const lenMinus1 = nSamples - 1;
  es1[hoff + 19] = (lenMinus1 >> 16) & 0xFF;
  es1[hoff + 20] = (lenMinus1 >>  8) & 0xFF;
  es1[hoff + 21] =  lenMinus1        & 0xFF;

  // [22-24] reserved (already 0)
  es1[hoff + 22] = 0;
  es1[hoff + 23] = 0;
  es1[hoff + 24] = 0;

  // [25] slot index
  es1[hoff + 25] = slotNo & 0xFF;

  // ─── Global heap pointer ───────────────────────────────────────────────────
  // Slot 0 bytes [1-3] = "next free address" in Range B address space.
  // Verified across all 6 official Korg backups: this value always equals
  // (max Range B end + 1) across all occupied slots. Without this pointer
  // the device shows "Off" for every part — it imports the file but cannot
  // assign samples, presumably because it thinks the heap is empty/corrupt.
  //
  // We update it on every writeSlot call. Since slots are written in order
  // and Range B grows densely, the highest-end-B is always THIS slot's end.
  const nextFreeB = endaddrB + 1;
  es1[HDR_BASE + 1] = (nextFreeB >> 16) & 0xFF;
  es1[HDR_BASE + 2] = (nextFreeB >>  8) & 0xFF;
  es1[HDR_BASE + 3] =  nextFreeB        & 0xFF;

  // Next slot's Range A address: just past this slot's padded ADPCM data
  return staddrA + paddedLen;
}

/**
 * Trigger a browser download of the .ES1 file.
 */
export function downloadES1(es1bytes, filename = 'BACKUP.ES1') {
  const blob = new Blob([es1bytes], { type: 'application/octet-stream' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
