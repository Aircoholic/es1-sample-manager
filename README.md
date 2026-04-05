# ES-1 Sample Manager

A browser-based tool for preparing and managing samples on the **Korg ES-1 rhythm machine**.

**[▶ Open in browser](https://aircoholic.github.io/es1-sample-manager/)**

***

## What is this?

The Korg ES-1 is a sampler that stores audio on SmartMedia cards. Each card holds up to 100 samples in slots `00`–`99`, saved as 32kHz 16-bit mono WAV files with specific filenames (`A00BIP.WAV`, `A01BIP.WAV`, etc.).

Preparing samples for the ES-1 usually means:
- Converting files to the right format (32kHz, 16-bit, mono)
- Renaming them to match the ES-1's naming scheme
- Copying them to the card in the right order
- Keeping track of what's on each card

This tool handles all of that in the browser — no software to install, no command line.

***

## Features

**Drag & drop**
Drop any audio file onto the app. WAV, MP3, AIFF, FLAC, OGG and M4A are all supported. Multiple files at once.

**Waveform editor**
Each sample shows an interactive waveform. Drag the start/end markers to trim, or use the arrow keys to nudge to the nearest zero-crossing for clean, click-free cuts.

**Per-sample processing**
Before converting, each sample can have individual options:
- **Normalize** — boosts the loudest peak to -1 dBFS, so your samples are as loud as possible without clipping
- **DC Offset** — removes any DC offset that could cause clicks at the start or end of a sample
- **Hi Boost** — applies a gentle +4dB high shelf from 4kHz upward, useful for samples that sound dull through the ES-1's output stage
- **Stereo** — keeps the file as stereo (uses 2 sample slots on the ES-1)

**Conversion**
One click converts all queued samples to 32kHz 16-bit WAV, trimmed and processed. FFmpeg runs entirely in the browser — no files leave your computer.

**Export options**
- **Save to Card** — writes files directly to a connected SmartMedia card (Chrome/Edge only)
- **Save to Folder** — saves to any folder on your computer (Chrome/Edge only)
- **Download as ZIP** — packages all converted samples, works in any browser

**Print sample list**
Generates a printable A5 landscape reference sheet for each card: slot numbers, sample names, a notes field, and the date. Save as PDF from the browser's print dialog and keep it with your card archives.

***

## Browser compatibility

| Feature | Chrome / Edge | Brave | Firefox / Safari |
|---|---|---|---|
| Convert & ZIP download | Yes | Yes | Yes |
| Save directly to card or folder | Yes | Enable in `brave://flags` | No |

The File System Access API (required for direct card/folder writing) is a Chrome/Edge feature. Firefox and Safari users can use the ZIP download instead.

***

## Run locally

If you prefer to run the tool offline or want to contribute:

```bash
git clone https://github.com/Aircoholic/es1-sample-manager.git
cd es1-sample-manager
npm install
npm run dev
```

Then open [http://localhost:5173/es1-sample-manager/](http://localhost:5173/es1-sample-manager/) in Chrome or Edge.

Node.js 18 or later is required.

***

## About the ES-1

The Korg ES-1 (2000–2003) is a groove sampler/sequencer that records and plays back samples from SmartMedia cards. It samples at 32kHz and supports up to 100 user samples per card. Despite its age, it remains popular for its distinctive lo-fi character, intuitive step sequencer, and the way its 12-bit D/A converter colors the sound.

***

## License

MIT — free to use, modify and distribute. See [LICENSE](LICENSE).