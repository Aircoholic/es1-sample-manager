# Korg Electribe ES-1 mkI .ES1 Backup File Format

A complete reverse-engineered specification of the SmartMedia backup format
used by the Korg Electribe ES-1 mkI sampler-sequencer (1999).

This documents what an `.ES1` file actually contains and how the hardware reads
it back. The format had been partially understood for years but key fields —
the dual-range audio addressing, the 24-bit length field, and the global heap
pointer — had never been fully described publicly. Without them, third-party
tools could produce files that loaded without errors but had silent or missing
samples.

The reverse engineering was done by inspecting the six official Korg factory
backups in the *Sound Designer Collection* alongside backups produced by real
ES-1 hardware, with the official `es2wav.exe` extractor used as ground truth
for sample boundaries and lengths.

---

## File layout overview

```
0x000000  ┌──────────────────────────────────────────────┐
          │ HDR1 (16 bytes)                              │
          │ "KORG" 01 00 57 02 00 00 00 00 00 00 BB B3  │
0x000010  ├──────────────────────────────────────────────┤
          │ Reserved / unused (240 bytes, zero)          │
0x000100  ├──────────────────────────────────────────────┤
          │                                              │
          │ Pattern / global data (≈ 524 KB)             │
          │   ─ BPM byte at 0x000100                     │
          │   ─ Per-part configurations                  │
          │   ─ Pattern step data                        │
          │   ─ Song data, FX settings                   │
          │                                              │
0x080000  ├──────────────────────────────────────────────┤
          │ HDR2 (16 bytes)                              │
          │ "KORG" 01 00 57 01 00 00 00 00 00 00 AF 3E  │
0x080010  ├──────────────────────────────────────────────┤
          │ Mono slot table: 100 × 26 bytes = 2 600 b    │
0x0809F8  ├──────────────────────────────────────────────┤
          │ Stereo slot table: 50 × 28 bytes = 1 400 b   │
0x080F70  ├──────────────────────────────────────────────┤
          │ Padding / reserved (≈ 124 KB)                │
0x0A0000  ├──────────────────────────────────────────────┤
          │                                              │
          │ Audio data zone (≈ 3 MB)                     │
          │   ADPCM-encoded samples, 32-byte blocks      │
          │                                              │
0x3A0000  └──────────────────────────────────────────────┘
File size = 3 801 088 bytes (29 × 2¹⁷, exactly the size of a 4 MB SmartMedia
card after the device-specific reserved areas).
```

---

## Audio data: dual virtual address spaces

This is the single most consequential discovery of the reverse engineering.

The audio zone in the file is one physical region (file offsets `0x0A0000` to
`0x39FFFF`). But the slot records point to that audio data using **two
different virtual address spaces**, each with its own offset translation:

```
Range A:   stored_addr = file_offset + 0x160000   (so 0x200000 → file 0x0A0000)
Range B:   stored_addr = file_offset + 0x060000   (so 0x100000 → file 0x0A0000)
```

Range B is the address space the ES-1 reads from to play samples. Range A
appears to be a secondary view that the device sets up but does not use for
playback. The audio bytes are stored *once*; both ranges resolve to the same
physical bytes in the file.

> **The pitfall:** every previous third-party encoder I could find sets Range B
> to the same stored address as Range A. The slot record looks reasonable, but
> when the ES-1 applies the Range-B `−0x060000` translation it lands at file
> offset `0x1A0000`, which contains either zeros or unrelated bytes. The device
> shows the slot as "Off" because it can't validate the audio data at that
> address.

Verified empirically: decoding the bytes at Range B's file offset for each
slot in `4.es1` produces byte-perfect matches with the WAV files extracted by
the official `es2wav.exe` tool. Decoding Range A's bytes produces unrelated
audio.

---

## Slot record — mono samples (26 bytes)

The slot table starts at file offset `0x080010`. Each mono slot record is
26 bytes:

| Offset | Size | Field           | Description                                                                                      |
|-------:|-----:|:----------------|:-------------------------------------------------------------------------------------------------|
|  0     | 1    | reserved        | Always `0x00`.                                                                                   |
|  1–3   | 3    | **`HEAP_PTR`**  | **In slot 0 only:** global "next free Range B address" pointer. In other slots: per-sample loop point in Range A space, or zero. |
|  4–6   | 3    | `STADDR_A`      | Range A start, 24-bit big-endian.                                                                |
|  7–9   | 3    | `ENDADDR_A`     | Range A end, inclusive. `ENDADDR_A − STADDR_A + 1 = sample_count` (exact, not padded).            |
| 10–12  | 3    | `STADDR_B`      | Range B start, 24-bit BE. Translation offset is `−0x060000`, different from Range A.              |
| 13–15  | 3    | `ENDADDR_B`     | Range B end, inclusive. `ENDADDR_B − STADDR_B + 1 = padded_bytes` (next 32-byte boundary).        |
| 16–18  | 3    | reserved        | Always `0x00` in factory files.                                                                  |
| 19–21  | 3    | **`LENGTH−1`**  | Sample length minus one, 24-bit big-endian. This is the value the hardware actually plays.        |
| 22–24  | 3    | reserved        | Always `0x00` in factory files.                                                                  |
| 25     | 1    | `SLOT_INDEX`    | The slot's identifier. `0xFF` for empty slots; otherwise the slot number (with optional `+0x50` offset — both forms seen in factory files). |

### Length field — 24-bit, not 16-bit

The length is stored at bytes `[19–21]` as a 24-bit big-endian value, holding
`sample_count − 1`. Earlier reverse-engineering attempts (including my own
intermediate versions) treated byte `[21]` as a "STATUS = occupied" flag with
the constant value `0x1F`. That happens to be the correct length−1 value for
a 32-sample test tone, which is exactly what device-recorded test backups
contain — so the misreading went undetected until factory backups with longer
samples were examined.

Reading `[21]` as status meant the hardware loaded the slot record fine but
read `length = 31` from the same byte range, played 32 samples (~1 ms) and
fell silent.

### Heap pointer in slot 0

Slot 0's bytes `[1–3]` hold a 24-bit BE pointer to the *next free address in
the Range B address space* — that is, `max(ENDADDR_B) + 1` across all occupied
slots. Verified across all six official Korg backups:

| File   | slot 0 `[1–3]` | max `ENDADDR_B` + 1 |
|:-------|---------------:|--------------------:|
| 1.es1  | `0x3EA840`     | `0x3EA840`          |
| 2.es1  | `0x3FCEC0`     | `0x3FCEC0`          |
| 3.es1  | `0x303AA0`     | `0x303AA0`          |
| 4.es1  | `0x25BFC0`     | `0x25BFC0`          |
| 5.es1  | `0x3B9E00`     | `0x3B9E00`          |
| 6.es1  | `0x1FF760`     | `0x1FF760`          |

Without this pointer the device shows "Off" for every part — it imports the
file but cannot assign samples to parts, presumably because it thinks the
sample heap is empty or corrupt.

### In other slots: loop points

When `[1–3]` is non-zero in slots 1 and up, it appears to be a per-sample
loop point in Range A address space. Factory files with looped samples
(`2.es1`) have many non-zero entries here; files with pure drum hits (`4.es1`)
have only the global heap pointer in slot 0 and zeros elsewhere.

The encoder in this project leaves loop points at zero for all slots and only
writes the global heap pointer in slot 0. Samples play without looping, which
is the expected behavior for a sample manager.

---

## Slot record — stereo samples (28 bytes)

Stereo slot records have the same general layout but are 28 bytes each. They
are not currently produced by this encoder (the WebApp exports mono samples
only). The two extra bytes appear at offsets `[26–27]` and contain additional
addressing data for the second channel; they are not yet fully decoded.

---

## Audio encoding: Korg's ADPCM

Samples are stored as a Korg-proprietary 8-bits-per-sample ADPCM variant:

- 32 audio samples per 32-byte block (1:1 byte-to-sample ratio after compression).
- Each block header carries a 16-bit signed *first sample value* (`fsv`),
  a 6-bit step index (`si`), a 6-bit minimum step index (`mi`), a 4-bit bit
  depth (`bd`), and a 2-bit table number (`tn`).
- The remaining 31 samples are encoded as 7-bit deltas (sign + 6-bit magnitude)
  predicted from the previous sample.
- Four step tables, each with 64 entries, cover increasing dynamic ranges.

The implementation in `es1Encoder.js` is a JavaScript port of the C decoder in
[polluxsynth/es12wav](https://github.com/polluxsynth/es12wav), inverted into an
encoder. Round-trip on the official Korg WAVs is byte-perfect for the audio
bytes inside each block; the resulting `.ES1` files play on real ES-1 hardware
at correct pitch and length.

---

## Pattern / global data area (0x000100 – 0x07FFFF)

This region holds global settings, part configurations, pattern step data,
song data, and FX settings — everything the sequencer needs that isn't a raw
sample. It is roughly 524 KB.

The hardware loads the file regardless of what's in this region, but **a zeroed
or `0xFF`-filled region causes "Off" in every part**: zeros leave the parts
unassigned, and `0xFF` fills means BPM = 511, all FX on, all steps active,
which the device interprets as a corrupt pattern.

This encoder embeds the pattern region from Korg's factory `4.es1` (the
simplest of the six factory backups: 100 sample slots, no user patterns) as a
known-good template, gzipped to ~1.9 KB and inflated at runtime via
`DecompressionStream`. The resulting backup loads cleanly even though the
user-supplied samples differ in length, content, and assignment from the
template's original slots.

A more sophisticated encoder could synthesize this region from scratch by
parsing the pattern data structure, but for the current use case ("import any
samples, get a working backup") the template approach is reliable and small.

### Notable fields inside this region

| File offset | Description                                                          |
|------------:|:---------------------------------------------------------------------|
| `0x000100`  | BPM byte. Display value = stored value × 2 (so write `60` for 120 BPM). |
| `0x000200+` | Per-part configurations (16 parts, roughly 128 bytes each).           |

The per-part block contains the assigned sample slot, level, pan, FX sends,
and other parameters. Because this encoder uses Korg's template, the parts
arrive pre-assigned to slots 0, 78, 90, 93, etc., and the user reassigns them
in normal device operation. (Mapping every slot to a unique part in the
generated file is a possible future enhancement.)

---

## File header magic

The two 16-byte magic blocks at file offsets `0x000000` and `0x080000` must
match exactly or the device rejects the file:

```
HDR1:  4B 4F 52 47  01 00 57 02  00 00 00 00  00 00 BB B3
HDR2:  4B 4F 52 47  01 00 57 01  00 00 00 00  00 00 AF 3E
```

The first four bytes are ASCII "KORG". The remaining bytes encode a format
version and a checksum-like trailer; in all factory and device-recorded
backups I examined the values are constant.

---

## Things this document does *not* yet cover

- **Stereo slot records** (28 bytes each) — basic layout matches mono but the
  extra two bytes aren't fully decoded.
- **Pattern step data structure** — the encoder embeds Korg's template
  wholesale rather than synthesizing patterns. Sequencing tools that want to
  generate `.ES1` files with custom patterns will need to parse this region.
- **Loop points in slot records** — non-zero `[1–3]` values in slots 1+ appear
  to be loop points, but the exact format (start-only, start+end, etc.) hasn't
  been verified.
- **The two extra bytes per stereo slot** at `[26–27]`.

Contributions welcome.

---

## References

- [polluxsynth/es12wav](https://github.com/polluxsynth/es12wav) — C decoder for
  ES-1 ADPCM samples, the basis for this encoder's ADPCM core.
- *Korg ES-1 Sound Designer Collection* (archive.org): six factory `.es1`
  backups plus the official `es2wav.exe` extractor — the ground truth for
  validating this specification.
- Korg ES-1 mkI Owner's Manual.
