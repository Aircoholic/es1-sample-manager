<script>
  import { get }         from 'svelte/store';
  import { stagingSlots, updateStagingSlot, clearStaging, clearDoneSlots } from '../lib/stagingStore.js';
  import { addSlot }     from '../lib/slotStore.js';
  import { processAudio } from '../lib/processor.js';
  import StagingItem     from './StagingItem.svelte';
  import { FFmpeg }      from '@ffmpeg/ffmpeg';
  import { fetchFile }   from '@ffmpeg/util';

  const ffmpeg = new FFmpeg();
  let converting = false;
  let progressText = '';

  function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  async function convertAll() {
    const pending = get(stagingSlots).filter(s => s.status === 'pending');
    if (!pending.length) return;

    if (!ffmpeg.loaded) {
      progressText = 'Loading ffmpeg…';
      await ffmpeg.load();
    }

    converting = true;

    for (let i = 0; i < pending.length; i++) {
      const slot = pending[i];
      progressText = `${i + 1} / ${pending.length}`;
      updateStagingSlot(slot.id, { status: 'converting' });
      await sleep(10);

      try {
        const channels = slot.stereo ? 2 : 1;
        const ext      = slot.file.name.slice(slot.file.name.lastIndexOf('.'));
        await ffmpeg.writeFile('input' + ext, await fetchFile(slot.file));

        const args = ['-i', 'input' + ext, '-ar', '32000', '-ac', String(channels), '-sample_fmt', 's16'];
        if (slot.trimStart > 0) args.push('-ss', String(slot.trimStart));
        if (slot.trimEnd !== null && slot.trimEnd < slot.duration) {
          args.push('-t', String(slot.trimEnd - slot.trimStart));
        }
        args.push('output.wav');
        await ffmpeg.exec(args);

        const rawData = await ffmpeg.readFile('output.wav');
        const copied  = new Uint8Array(rawData.buffer).slice().buffer;

        let blob;

        if (slot.normalize || slot.dcOffset || slot.highpassBoost) {
          const rawBlob    = new Blob([copied], { type: 'audio/wav' });
          const ctx        = new AudioContext({ sampleRate: 32000 });
          const audioBuffer = await ctx.decodeAudioData(await rawBlob.arrayBuffer());
          await ctx.close();

          const processed   = await processAudio(audioBuffer, {
            normalize:     slot.normalize,
            removeDcOffset: slot.dcOffset,
            highpassBoost:  slot.highpassBoost,
          });

          const nCh      = processed.numberOfChannels;
          const nSmp     = processed.length;
          const channels2 = Array.from({ length: nCh }, (_, c) => processed.getChannelData(c));
          const pcm      = new Int16Array(nSmp * nCh);

          for (let j = 0; j < nSmp; j++) {
            for (let c = 0; c < nCh; c++) {
              const v = channels2[c][j];
              pcm[j * nCh + c] = Math.max(-32768, Math.min(32767, v < 0 ? v * 32768 : v * 32767));
            }
          }

          await ffmpeg.writeFile('pcm.raw', new Uint8Array(pcm.buffer));
          await ffmpeg.exec([
            '-f', 's16le', '-ar', '32000', '-ac', String(nCh),
            '-i', 'pcm.raw', '-f', 'wav', 'proc.wav',
          ]);
          const procData = await ffmpeg.readFile('proc.wav');
          blob = new Blob([new Uint8Array(procData.buffer).slice()], { type: 'audio/wav' });
          await ffmpeg.deleteFile('pcm.raw');
          await ffmpeg.deleteFile('proc.wav');
        } else {
          blob = new Blob([copied], { type: 'audio/wav' });
        }

        addSlot({ label: slot.name, audioUrl: URL.createObjectURL(blob), blob });
        updateStagingSlot(slot.id, { status: 'done' });
      } catch (e) {
        console.error('Convert error:', e);
        updateStagingSlot(slot.id, { status: 'error' });
      }

      await sleep(20);
    }

    converting = false;
    progressText = '';
  }
</script>

{#if $stagingSlots.length > 0}
  <section class="staging-section" aria-label="Conversion queue">

    <div class="staging-header">
      <h2 class="staging-title">
        <span class="section-label">QUEUE</span>
        <span class="count">{$stagingSlots.length}</span>
      </h2>
      <div class="header-actions">
        {#if $stagingSlots.some(s => s.status === 'done')}
          <button class="btn-ghost" onclick={clearDoneSlots}>Clear done</button>
        {/if}
        <button class="btn-ghost" onclick={clearStaging}>Clear all</button>
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
        disabled={converting || $stagingSlots.every(s => s.status !== 'pending')}
      >
        {#if converting}
          <span class="spin-icon" aria-hidden="true">◌</span>
          Converting {progressText}…
        {:else}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.5" stroke-linecap="round"
               aria-hidden="true">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
          Convert all
          <span class="pending-count">
            ({$stagingSlots.filter(s => s.status === 'pending').length})
          </span>
        {/if}
      </button>
    </div>
  </section>
{/if}

<style>
  .staging-section {
    margin-top: var(--sp6);
    display: flex;
    flex-direction: column;
    gap: var(--sp4);
  }

  .staging-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: var(--sp2);
  }

  .staging-title {
    display: flex;
    align-items: baseline;
    gap: var(--sp2);
    font-size: 0;  /* suppress default size, set per-span */
  }

  /* Uses the global .section-label */
  .count {
    font-family: var(--mono);
    font-size: var(--ts);
    color: var(--tf);
    font-weight: 400;
  }

  .header-actions { display: flex; gap: var(--sp2); }

  .btn-ghost {
    font-size: var(--tx);
    color: var(--tf);
    border: 1px solid var(--b0);
    border-radius: var(--r2);
    padding: 4px var(--sp3);
    background: transparent;
    transition: color var(--tf2), border-color var(--tf2), background var(--tf2);
  }
  .btn-ghost:hover {
    color: var(--t);
    border-color: var(--b1);
    background: var(--s3);
  }

  .hint {
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tf);
    margin: calc(var(--sp2) * -1) 0 0;
  }

  /* Convert bar */
  .convert-bar {
    display: flex;
    justify-content: flex-end;
    padding-top: var(--sp2);
  }

  .btn-convert {
    display: inline-flex;
    align-items: center;
    gap: var(--sp2);
    padding: var(--sp2) var(--sp6);
    font-family: var(--mono);
    font-size: var(--ts);
    font-weight: 600;
    letter-spacing: 0.04em;
    background: #3ddc5c;
    color: #091407;
    border: 1px solid #3ddc5c;
    border-radius: var(--r2);
    
    transition: background var(--tf2), border-color var(--tf2), box-shadow var(--tf2), transform var(--tf2);
  }
  .btn-convert:hover:not(:disabled) {
    background: #52e870;
    border-color: #52e870;
    
    transform: translateY(-1px);
  }
  .btn-convert:active:not(:disabled) { transform: translateY(0); }
  .btn-convert:disabled {
    opacity: 0.35;
    cursor: not-allowed;
    box-shadow: none;
  }

  .pending-count {
    font-weight: 400;
    opacity: 0.7;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  .spin-icon {
    display: inline-block;
    animation: spin 1s linear infinite;
    opacity: 0.7;
  }
</style>
