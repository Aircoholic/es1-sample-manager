# ES-1 Sample Manager

A browser-based tool for preparing samples for the **Korg Electribe ES-1 mkI** —
including direct export to the native `.ES1` backup format that the device loads
through its `[E]` menu.

**[▶ Open in browser](https://aircoholic.github.io/es1-sample-manager/)**

***

## What this is

The Korg ES-1 (1999) is a sampler-sequencer that stores audio on SmartMedia
cards. Getting samples onto the device has traditionally meant:

1. Converting files to 32 kHz / 16-bit / mono in an audio editor.
2. Naming them with the ES-1's expected scheme (`A00BIP.WAV`, `A01BIP.WAV`, …).
3. Copying them onto a SmartMedia card slot by slot.
4. Manually keeping track of what's on which card.

This app does all of that in the browser, with no install and no upload —
FFmpeg.wasm runs locally, so the audio never leaves your machine.

It also does one thing no other web tool does: it can build a complete
**`.ES1` backup file** that the ES-1 imports directly through its built-in
`[E] · LOAD ALL` menu, with all samples already in place. No card swapping,
no per-file copying.

***

## Features

**Drag & drop**
Drop any audio file onto the app. WAV, MP3, AIFF, FLAC, OGG and M4A are all
supported. Multiple files at once.

**Waveform editor**
Each sample shows an interactive waveform. Drag the start/end markers to trim,
or use the arrow keys to nudge to the nearest zero-crossing for clean,
click-free cuts.

**Per-sample processing**
Before converting, each sample can have individual options:

- **Normalize** — boosts the loudest peak to −1 dBFS so samples are as loud as
  possible without clipping.
- **DC Offset** — removes any DC offset that could cause clicks at start or end.
- **Hi Boost** — applies a gentle +4 dB high shelf from 4 kHz upward, useful
  for samples that sound dull through the ES-1's output stage.
- **Stereo** — keeps the file as stereo (uses two ES-1 slots).

**Conversion**
One click converts all queued samples to 32 kHz 16-bit WAV, trimmed and
processed. FFmpeg.wasm runs entirely in the browser.

**Export options**

- **Export .ES1** — builds a complete native ES-1 backup file with all your
  samples already loaded. Copy it to a SmartMedia card root directory and the
  device imports it via `[E]` menu. Up to ~98 seconds of audio per backup at
  32 kHz.
- **Save to Card** — writes individual WAV files directly to a connected
  SmartMedia card (Chrome/Edge only).
- **Save to Folder** — saves WAVs to any folder on your computer (Chrome/Edge
  only).
- **Download as ZIP** — packages all converted samples; works in any browser.

**Print sample list**
Generates a printable A5 landscape reference sheet for each card: slot
numbers, sample names, a notes field, and the date. Save as PDF from the
browser's print dialog and keep it with your card archives.

***

## The `.ES1` export

The native `.ES1` format is what the device produces when it backs itself up
to a card. It's a single 3.8 MB file containing all 100 mono sample slots
(plus the patterns, global settings, FX, etc.). Loading a `.ES1` is the
fastest way to put a curated set of samples onto the device — much faster
than copying 100 individual WAV files, and the ES-1 can do it without any
host computer.

Building a valid `.ES1` from scratch required reverse engineering the file
format, including:

- The Korg-proprietary ADPCM encoding for the audio data.
- The dual virtual address spaces (Range A and Range B) used by the slot
  records to point at the same physical audio bytes.
- The 24-bit length field that the hardware actually plays from.
- The global heap pointer in slot 0 that the device checks for memory
  validity.
- The pattern / global data region that must be a known-good template,
  otherwise the device shows "Off" for every part after import.

All of this is documented in [`docs/ES1_FORMAT.md`](docs/ES1_FORMAT.md) and
implemented in [`src/lib/es1Encoder.js`](src/lib/es1Encoder.js). The encoder
is standalone — anyone wanting to write `.ES1` files from another tool can
read those two files and have everything they need.

Verified against the six official Korg factory backups in the *Sound Designer
Collection*, and confirmed working on real ES-1 mkI hardware.

***

## Browser compatibility

| Feature                            | Chrome / Edge | Brave            | Firefox / Safari |
|------------------------------------|:-------------:|:----------------:|:----------------:|
| Convert · Export .ES1 · ZIP        | Yes           | Yes              | Yes              |
| Save directly to card or folder    | Yes           | `brave://flags`  | No               |

The File System Access API (used for direct card/folder writing) is a
Chrome/Edge feature. Firefox and Safari users can use the `.ES1` export or
the ZIP download instead.

***

## Run locally

```bash
git clone https://github.com/Aircoholic/es1-sample-manager.git
cd es1-sample-manager
npm install
npm run dev
```

Then open [http://localhost:5173/es1-sample-manager/](http://localhost:5173/es1-sample-manager/)
in Chrome or Edge.

Node.js 18 or later is required.

***

## About the ES-1

The Korg Electribe ES-1 (1999–2003) is a groove sampler/sequencer that
records and plays back samples from SmartMedia cards. It samples at 32 kHz,
holds up to 100 mono samples per card (or 50 stereo, or a mix), and is still
popular today for its distinctive lo-fi character, intuitive step sequencer,
and the way its 12-bit D/A converter colors the sound.

***

## License

MIT — free to use, modify and distribute. See [LICENSE](LICENSE).

## Credits

- ADPCM decoder reference: [polluxsynth/es12wav](https://github.com/polluxsynth/es12wav).
- Format reverse engineering: validated against Korg's *Sound Designer
  Collection* (available on archive.org).
- Built with [Svelte](https://svelte.dev), [Vite](https://vitejs.dev),
  [FFmpeg.wasm](https://ffmpegwasm.netlify.app/) and
  [JSZip](https://stuk.github.io/jszip/).
