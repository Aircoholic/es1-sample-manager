<script>
  import { get } from 'svelte/store';
  import { stagingSlots, updateStagingSlot, clearStaging } from '../lib/stagingStore.js';
  import { addSlot } from '../lib/slotStore.js';
  import { processAudio } from '../lib/processor.js';
  import StagingItem from './StagingItem.svelte';
  import { FFmpeg } from '@ffmpeg/ffmpeg';
  import { fetchFile } from '@ffmpeg/util';


  const ffmpeg = new FFmpeg();
  let converting = false;
  let progress = '';


  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }


  async function convertAll() {
    const slots = get(stagingSlots);
    const pending = slots.filter(s => s.status === 'pending');
    if (!pending.length) return;


    if (!ffmpeg.loaded) {
      progress = 'Lade ffmpeg…';
      await ffmpeg.load();
    }


    converting = true;


    for (let i = 0; i < pending.length; i++) {
      const slot = pending[i];
      progress = `${i + 1} / ${pending.length}`;
      updateStagingSlot(slot.id, { status: 'converting' });
      await sleep(10);


      try {
        const channels = slot.stereo ? 2 : 1;
        const ext = slot.file.name.slice(slot.file.name.lastIndexOf('.'));
        await ffmpeg.writeFile('input' + ext, await fetchFile(slot.file));


        const ffmpegArgs = [
          '-i', 'input' + ext,
          '-ar', '32000',
          '-ac', String(channels),
          '-sample_fmt', 's16'
        ];


        if (slot.trimStart > 0) {
          ffmpegArgs.push('-ss', String(slot.trimStart));
        }
        if (slot.trimEnd !== null && slot.trimEnd < slot.duration) {
          const trimDuration = slot.trimEnd - slot.trimStart;
          ffmpegArgs.push('-t', String(trimDuration));
        }


        ffmpegArgs.push('output.wav');
        await ffmpeg.exec(ffmpegArgs);


        const ffmpegData = await ffmpeg.readFile('output.wav');
        const copied = new Uint8Array(ffmpegData.buffer).slice().buffer;


        let blob;


        if (slot.normalize || slot.dcOffset || slot.highpassBoost) {
          const rawBlob = new Blob([copied], { type: 'audio/wav' });
          const arrayBuffer = await rawBlob.arrayBuffer();
          const audioCtx = new AudioContext({ sampleRate: 32000 });
          const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
          await audioCtx.close();

          const processed = await processAudio(audioBuffer, {
            normalize: slot.normalize,
            removeDcOffset: slot.dcOffset,
            highpassBoost: slot.highpassBoost,
          });

          // PCM-Daten aus AudioBuffer extrahieren
          const numChannels = processed.numberOfChannels;
          const numSamples = processed.length;
          const pcmData = new Int16Array(numSamples * numChannels);

          // Channels einmal vorab lesen
          const channelData = [];
          for (let c = 0; c < numChannels; c++) {
            channelData.push(processed.getChannelData(c));
          }

          for (let j = 0; j < numSamples; j++) {
            for (let c = 0; c < numChannels; c++) {
              const s = channelData[c][j];
              pcmData[j * numChannels + c] = Math.max(-32768, Math.min(32767,
                s < 0 ? s * 32768 : s * 32767
              ));
            }
          }

          // ffmpeg wandelt rohe PCM-Daten in WAV um
          await ffmpeg.writeFile('pcm_input.raw', new Uint8Array(pcmData.buffer));
          await ffmpeg.exec([
            '-f', 's16le',
            '-ar', '32000',
            '-ac', String(numChannels),
            '-i', 'pcm_input.raw',
            '-f', 'wav',
            'processed_output.wav'
          ]);
          const processedData = await ffmpeg.readFile('processed_output.wav');
          blob = new Blob([new Uint8Array(processedData.buffer).slice()], { type: 'audio/wav' });
          await ffmpeg.deleteFile('pcm_input.raw');
          await ffmpeg.deleteFile('processed_output.wav');
        } else {
          blob = new Blob([copied], { type: 'audio/wav' });
        }


        addSlot({
          label: slot.name,
          audioUrl: URL.createObjectURL(blob),
          blob,
        });


        updateStagingSlot(slot.id, { status: 'done' });
      } catch (e) {
        console.error(e);
        updateStagingSlot(slot.id, { status: 'error' });
      }


      await sleep(20);
    }


    converting = false;
    progress = '';
  }


  function clearDone() {
    stagingSlots.update(slots => slots.filter(s => s.status !== 'done'));
  }
</script>

{#if $stagingSlots.length > 0}
  <div class="staging-section">
    <div class="staging-header">
      <h2>Queue <span class="count">({$stagingSlots.length})</span></h2>
      <div class="header-actions">
        {#if $stagingSlots.some(s => s.status === 'done')}
          <button class="btn-ghost" onclick={clearDone}>Remove done</button>
        {/if}
        <button class="btn-ghost" onclick={() => clearStaging()}>Remove all</button>
      </div>
    </div>


    <p class="hint">Set options per sample · then convert</p>


    {#each $stagingSlots as slot (slot.id)}
      <StagingItem {slot} />
    {/each}


    <div class="convert-bar">
      <button
        class="btn-convert"
        onclick={convertAll}
        disabled={converting || $stagingSlots.every(s => s.status === 'done')}
      >
        {#if converting}
          ⏳ Konvertiere {progress}…
        {:else}
          ⚡ Alle konvertieren ({$stagingSlots.filter(s => s.status === 'pending').length} ausstehend)
        {/if}
      </button>
    </div>
  </div>
{/if}

<style>
  .staging-section {
    margin-top: var(--sp-6);
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }

  .staging-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }

  .staging-header h2 {
    font-size: var(--text-base);
    font-weight: 600;
    color: var(--text-bright);
    margin: 0;
  }

  .count {
    font-family: var(--font-mono);
    font-size: var(--text-sm);
    color: var(--text-faint);
    font-weight: 400;
  }

  .header-actions {
    display: flex;
    gap: var(--sp-2);
  }

  .btn-ghost {
    font-size: var(--text-xs);
    color: var(--text-faint);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    padding: 4px var(--sp-3);
    background: transparent;
    transition: color var(--t-fast), border-color var(--t-fast), background var(--t-fast);
  }

  .btn-ghost:hover {
    color: var(--text);
    border-color: var(--border-default);
    background: var(--surface-3);
  }

  .hint {
    font-size: var(--text-xs);
    color: var(--text-faint);
    margin: calc(var(--sp-2) * -1) 0 0;
  }

  .convert-bar {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--sp-2);
  }

  .btn-convert {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-6);
    font-size: var(--text-sm);
    font-weight: 600;
    background: var(--es-green);
    color: #0d1a09;
    border: 1px solid var(--es-green);
    border-radius: var(--r-md);
    box-shadow: 0 2px 8px rgba(90,191,60,0.25);
    transition: background var(--t-fast), border-color var(--t-fast),
                box-shadow var(--t-fast), transform var(--t-fast);
  }

  .btn-convert:hover:not(:disabled) {
    background: var(--es-green-bright);
    border-color: var(--es-green-bright);
    box-shadow: 0 4px 14px rgba(90,191,60,0.35);
    transform: translateY(-1px);
  }

  .btn-convert:active:not(:disabled) { transform: translateY(0); }

  .btn-convert:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    box-shadow: none;
  }
</style>