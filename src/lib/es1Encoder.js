/**
 * es1Encoder.js — Korg ES-1 ADPCM Encoder & .ES1 Backup Writer
 *
 * ADPCM core ported from Korg's es2wav.exe via polluxsynth/es12wav (adpcm.c).
 * Slot-record format determined empirically from:
 *   - 6 official Korg factory backups (Sound Designer Collection)
 *   - Reference hardware backups from real Korg ES-1 devices
 *   - Verified by matching extracted .wav lengths to slot length fields
 *
 * VERIFIED SLOT RECORD FORMAT (26 bytes per mono slot):
 *   [0-3]   reserved 0x00
 *   [4-6]   STADDR  — audio start address (3-byte BE, stored-addr space)
 *   [7-9]   ENDADDR — audio end address (inclusive)
 *   [10-12] RANGE_B_START — secondary range (mirror of Range A as placeholder)
 *   [13-15] RANGE_B_END
 *   [16-18] reserved 0x00
 *   [19-21] LENGTH-1 as 24-bit BIG-ENDIAN ← THE CRITICAL FIELD
 *   [22-24] reserved 0x00
 *   [25]    SLOT_INDEX — slot_number for occupied; 0xFF for empty
 *
 * KEY DISCOVERY (April 2026): the byte at [21] is NOT a status flag.
 * It's the LOW byte of a 24-bit length field at [19-21] BE.
 * Previous versions wrote 0x1F there ("STATUS=occupied"), making the device
 * read length = 31 → playback truncated to 1ms → silence.
 *
 * Verified across all 6 official Korg backups (Sound Designer Collection):
 *   - 4.es1 slot 02 (BD02): length field 6485 = WAV length 6485 ✓
 *   - 4.es1 slot 31: length field 141871 (24-bit, byte[19]=0x02)
 *   - All occupied slots: byte[25] is non-0xFF; empty slots: byte[25] = 0xFF
 *
 * FILE LAYOUT:
 *   File size  : 3 801 088 bytes (29 × 2^17)
 *   HDR1 at 0x000000, HDR2 at 0x080000
 *   Slot table : 0x080010, 100 mono × 26 + 50 stereo × 28 bytes
 *   Audio zone : 0x0A0000 – 0x39FFFF (file offsets)
 *   Stored addr: file_offset = stored_addr − 0x160000
 *   Pattern area (0x000100–0x07FFFF) must be 0x00, NOT 0xFF.
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

export const ES1_SIZE    = 3_801_088;
export const ES1_SR      = 32_000;
export const FRAMESIZE   = 32;
export const RAM_START   = 0x200000;

const HEADERPOS    = 0x080000;
const HDR_BASE     = 0x080010;
const MHDR_SIZE    = 26;
const SHDR_SIZE    = 28;
const MONO_SLOTS   = 100;
const STEREO_SLOTS = 50;
const ADDR_OFFSET  = 0x160000;

const EMPTY_INDEX = 0xFF;       // empty-slot marker at byte [25]

const HDR1 = [0x4B,0x4F,0x52,0x47,0x01,0x00,0x57,0x02,0x00,0x00,0x00,0x00,0x00,0x00,0xBB,0xB3];
const HDR2 = [0x4B,0x4F,0x52,0x47,0x01,0x00,0x57,0x01,0x00,0x00,0x00,0x00,0x00,0x00,0xAF,0x3E];

// ─── ADPCM CORE ───────────────────────────────────────────────────────────────

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
 */
export function createEmptyES1() {
  const data = new Uint8Array(ES1_SIZE);   // zero-filled

  HDR1.forEach((b, i) => { data[i] = b; });
  HDR2.forEach((b, i) => { data[HEADERPOS + i] = b; });

  // Audio zone = 0xFF (erased NOR flash)
  data.fill(0xFF, 0x0A0000, 0x3A0000);

  // Default BPM = 60 raw → hardware displays 60 × 2 = 120 BPM
  data[0x100] = 60;

  // Empty-slot marker: byte [25] = 0xFF
  const monoEnd = HDR_BASE + MONO_SLOTS * MHDR_SIZE;
  for (let s = 0; s < MONO_SLOTS;   s++) data[HDR_BASE + s * MHDR_SIZE + 25] = EMPTY_INDEX;
  for (let s = 0; s < STEREO_SLOTS; s++) data[monoEnd  + s * SHDR_SIZE + 25] = EMPTY_INDEX;

  return data;
}

/**
 * Encode a mono 32 kHz Float32Array into a slot.
 *
 * Writes:
 *   - ADPCM audio at the address pointed to by [4-9]
 *   - Slot descriptor with 24-bit length-1 at [19-21]
 *   - Slot index at [25] = slot_number
 *   - Range B [10-15] mirrors Range A as a safe non-zero placeholder
 *
 * @param {Uint8Array}   es1           Image to modify in-place
 * @param {number}       slotNo        0–99 (mono slot)
 * @param {Float32Array} samples32k    Mono Float32 [-1..1] at 32 kHz
 * @param {number}       nextRamAddr   Start: RAM_START (0x200000)
 * @param {function}     [onProgress]  (framesDone, framesTotal)
 * @returns {number} Updated nextRamAddr, 32-byte aligned
 */
export function writeSlot(es1, slotNo, samples32k, nextRamAddr, onProgress) {
  if (slotNo < 0 || slotNo >= MONO_SLOTS)
    throw new RangeError(`Slot ${slotNo} out of range (0–${MONO_SLOTS - 1})`);

  // Float32 → Int16
  const pcm16 = new Int16Array(samples32k.length);
  for (let i = 0; i < samples32k.length; i++)
    pcm16[i] = Math.max(-32767, Math.min(32767, Math.round(samples32k[i] * 32767)));

  // Encode ADPCM blocks (1 byte per audio sample, 32 samples per block)
  const nFrames = Math.ceil(pcm16.length / FRAMESIZE);
  const adpcm   = new Uint8Array(nFrames * FRAMESIZE);
  const buf     = new Int16Array(FRAMESIZE);

  for (let fn = 0; fn < nFrames; fn++) {
    for (let i = 0; i < FRAMESIZE; i++)
      buf[i] = (fn * FRAMESIZE + i < pcm16.length) ? pcm16[fn * FRAMESIZE + i] : 0;
    adpcm.set(encodeFrame(buf), fn * FRAMESIZE);
    if (onProgress && (fn & 63) === 0) onProgress(fn, nFrames);
  }
  onProgress?.(nFrames, nFrames);

  // 1 byte = 1 sample for ES-1 ADPCM
  const nSamples = adpcm.length;
  const staddr   = nextRamAddr;
  const endaddr  = staddr + nSamples - 1;
  const fileOff  = staddr - ADDR_OFFSET;

  if (fileOff < 0 || fileOff + nSamples > ES1_SIZE)
    throw new Error(`Slot ${slotNo}: audio zone full`);

  // Write the ADPCM audio data
  es1.set(adpcm, fileOff);

  // Write the slot descriptor
  const hoff = HDR_BASE + slotNo * MHDR_SIZE;

  // [4-6] STADDR
  es1[hoff + 4] = (staddr >> 16) & 0xFF;
  es1[hoff + 5] = (staddr >>  8) & 0xFF;
  es1[hoff + 6] =  staddr        & 0xFF;

  // [7-9] ENDADDR (inclusive)
  es1[hoff + 7] = (endaddr >> 16) & 0xFF;
  es1[hoff + 8] = (endaddr >>  8) & 0xFF;
  es1[hoff + 9] =  endaddr        & 0xFF;

  // [10-15] Range B — mirror to Range A as safe non-zero placeholder
  es1[hoff + 10] = es1[hoff + 4];
  es1[hoff + 11] = es1[hoff + 5];
  es1[hoff + 12] = es1[hoff + 6];
  es1[hoff + 13] = es1[hoff + 7];
  es1[hoff + 14] = es1[hoff + 8];
  es1[hoff + 15] = es1[hoff + 9];

  // [16-18] reserved (already 0 from createEmptyES1)
  es1[hoff + 16] = 0;
  es1[hoff + 17] = 0;
  es1[hoff + 18] = 0;

  // [19-21] LENGTH-1 as 24-bit BIG-ENDIAN — THE CRITICAL FIELD
  // Hardware reads this as the playback length in samples.
  // Previously we wrote 0x1F at [21] as a "STATUS" byte → length = 31 → 1ms playback.
  const lenMinus1 = nSamples - 1;
  es1[hoff + 19] = (lenMinus1 >> 16) & 0xFF;
  es1[hoff + 20] = (lenMinus1 >>  8) & 0xFF;
  es1[hoff + 21] =  lenMinus1        & 0xFF;

  // [22-24] reserved (already 0)
  es1[hoff + 22] = 0;
  es1[hoff + 23] = 0;
  es1[hoff + 24] = 0;

  // [25] slot index — Phase_1 hardware backup uses just slot_number (no offset)
  es1[hoff + 25] = slotNo & 0xFF;

  return ((endaddr + FRAMESIZE) >> 5) << 5;
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
