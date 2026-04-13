<script>
  import { addToStaging, updateStagingSlot, stagingSlots } from './lib/stagingStore.js';
  import { analyzeFile } from './lib/waveform.js';
  import StagingList from './components/StagingList.svelte';
  import SlotList    from './components/SlotList.svelte';
  import ExportBar   from './components/ExportBar.svelte';

  let dropping = false;
  let statusMsg = '';

  const AUDIO_EXTS = /\.(wav|mp3|aiff?|flac|ogg|m4a)$/i;

  async function handleDrop(e) {
    e.preventDefault();
    dropping = false;

    const files = [...e.dataTransfer.files].filter(
      f => f.type.startsWith('audio/') || AUDIO_EXTS.test(f.name)
    );
    if (!files.length) return;

    statusMsg = `Queuing ${files.length} file${files.length > 1 ? 's' : ''}…`;
    files.forEach(addToStaging);

    // Analyse in Hintergrund (non-blocking)
    for (const file of files) {
      analyzeFile(file)
        .then(({ duration, peaks, rawSamples, sampleRate }) => {
          stagingSlots.update(all => {
            const match = [...all].reverse().find(
              s => s.file.name === file.name && s.waveformData === null
            );
            if (!match) return all;
            return all.map(s =>
              s.id === match.id
                ? { ...s, duration, waveformData: peaks, trimEnd: duration, rawSamples, sampleRate }
                : s
            );
          });
        })
        .catch(err => console.warn('Analysis failed:', file.name, err));
    }

    statusMsg = `${files.length} sample${files.length > 1 ? 's' : ''} queued.`;
    setTimeout(() => { statusMsg = ''; }, 4000);
  }
</script>

<div class="app-shell">

  <header class="app-header">
    <div class="header-left">
      <!-- ES-1 style 3×3 LED grid logo -->
      <div class="header-logo" aria-hidden="true">
        <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
          <rect width="26" height="26" rx="4" fill="#14141c"/>
          <rect x="2.5" y="2.5" width="21" height="21" rx="2.5" fill="#1a1a28" stroke="rgba(90,191,60,0.2)" stroke-width="0.5"/>
          {#each [7,13,19] as cy}
            {#each [7,13,19] as cx}
              <circle
                cx={cx} cy={cy} r="1.4"
                fill="#5abf3c"
                opacity={cx === 13 && cy === 13 ? '1' : cx === 7 && cy === 7 ? '0.9' : '0.4'}
              />
            {/each}
          {/each}
        </svg>
      </div>
      <div class="header-titles">
        <span class="header-brand">ES-1</span>
        <span class="header-sub">SAMPLE MANAGER</span>
      </div>
    </div>

    <div class="header-right">
      <div class="header-badge">
        <span class="led led-green" aria-hidden="true"></span>
        <span class="badge-label">READY</span>
      </div>
    </div>
  </header>

  <main class="app-main">

    <!-- Drop zone -->
    <div
      class="dropzone"
      class:active={dropping}
      role="region"
      aria-label="Audio file drop zone"
      ondrop={handleDrop}
      ondragover={(e) => { e.preventDefault(); dropping = true; }}
      ondragleave={() => dropping = false}
    >
      <svg class="dz-icon" width="28" height="28" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"
           aria-hidden="true">
        <path d="M9 18V5l12-2v13"/>
        <circle cx="6" cy="18" r="3"/>
        <circle cx="18" cy="16" r="3"/>
      </svg>
      <p class="dz-text">Drop audio files here</p>
      <p class="dz-hint">WAV · MP3 · AIFF · FLAC · multiple files at once</p>
    </div>

    {#if statusMsg}
      <div class="status-row" role="status">
        <span class="led led-green" aria-hidden="true"></span>
        <span>{statusMsg}</span>
      </div>
    {/if}

    <StagingList />
    <SlotList />
    <ExportBar />

  </main>
</div>

<style>
  .app-shell {
    max-width: 860px;
    margin: 0 auto;
    padding: 0 var(--sp5) var(--sp12);
  }

  /* ── Header ─────────────────────────────────────────── */
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp5) 0 var(--sp6);
    border-bottom: 1px solid var(--b0);
    margin-bottom: var(--sp8);
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: var(--sp3);
  }
  .header-logo { flex-shrink: 0; }
  .header-titles {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .header-brand {
    font-family: var(--mono);
    font-size: var(--txl);
    font-weight: 600;
    color: var(--tg);
    letter-spacing: 0.06em;
    line-height: 1;
  }
  .header-sub {
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tm);
    letter-spacing: 0.14em;
  }
  .header-right { display: flex; align-items: center; }
  .header-badge {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    background: var(--s1);
    border: 1px solid var(--b1);
    border-radius: var(--r2);
    padding: var(--sp1) var(--sp3);
  }
  .badge-label {
    font-family: var(--mono);
    font-size: var(--tx);
    font-weight: 600;
    color: var(--tm);
    letter-spacing: 0.14em;
  }

  /* ── Drop Zone ───────────────────────────────────────── */
  .dropzone {
    border: 1.5px dashed var(--b1);
    border-radius: var(--r4);
    padding: var(--sp10) var(--sp6);
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp2);
    background: var(--s1);
    margin-bottom: var(--sp4);
    transition: background var(--tb3), border-color var(--tb3), box-shadow var(--tb3);
    cursor: default;
  }
  .dropzone:hover {
    border-color: var(--green-dim);
    background: color-mix(in oklch, #5abf3c 4%, var(--s1));
  }
  .dropzone.active {
    border-color: var(--green);
    border-style: solid;
    background: var(--green-glow);
    box-shadow: 0 0 0 1px var(--green-dim), inset 0 0 30px rgba(90,191,60,0.05);
  }
  .dz-icon {
    color: var(--tf);
    margin-bottom: var(--sp1);
    transition: color var(--tb3);
  }
  .dropzone:hover .dz-icon,
  .dropzone.active .dz-icon { color: var(--green-dim); }
  .dz-text {
    font-size: var(--tb2);
    font-weight: 500;
    color: var(--tm);
  }
  .dz-hint {
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tf);
    letter-spacing: 0.04em;
  }

  /* ── Status ──────────────────────────────────────────── */
  .status-row {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    font-family: var(--mono);
    font-size: var(--ts);
    color: var(--tm);
    padding: var(--sp2) var(--sp3);
    margin-bottom: var(--sp2);
  }
</style>
