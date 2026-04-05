<script>
  import { addToStaging } from './lib/stagingStore.js';
  import { analyzeFile } from './lib/waveform.js';
  import { updateStagingSlot } from './lib/stagingStore.js';
  import StagingList from './components/StagingList.svelte';
  import SlotList from './components/SlotList.svelte';
  import ExportBar from './components/ExportBar.svelte';

  let dropping = false;
  let statusMsg = '';

  async function handleDrop(e) {
    e.preventDefault();
    dropping = false;
    const files = [...e.dataTransfer.files].filter(
      f => f.type.startsWith('audio/') || /\.(wav|mp3|aiff?|flac|ogg|m4a)$/i.test(f.name)
    );
    if (!files.length) return;

    statusMsg = `Analysing ${files.length} file${files.length > 1 ? 's' : ''}…`;

    for (const file of files) addToStaging(file);

    for (const file of files) {
      try {
        const { duration, peaks, rawSamples, sampleRate } = await analyzeFile(file);
        import('./lib/stagingStore.js').then(({ stagingSlots }) => {
          stagingSlots.update(slots => {
            const match = [...slots].reverse().find(s => s.file.name === file.name && s.waveformData === null);
            if (match) {
              return slots.map(s => s.id === match.id
                ? { ...s, duration, waveformData: peaks, trimEnd: duration, rawSamples, sampleRate }
                : s
              );
            }
            return slots;
          });
        });
      } catch (err) {
        console.warn('Analysis failed:', file.name, err);
      }
    }

    statusMsg = `${files.length} sample${files.length > 1 ? 's' : ''} queued.`;
  }
</script>

<div class="app-shell">
  <!-- Header -->
  <header class="app-header">
    <div class="header-logo">
      <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-label="ES-1 Logo">
        <rect width="28" height="28" rx="5" fill="#1a1a1e"/>
        <rect x="3" y="3" width="22" height="22" rx="3" fill="#252529" stroke="rgba(90,191,60,0.3)" stroke-width="0.75"/>
        <!-- speaker dots grid -->
        <circle cx="8" cy="8"   r="1.5" fill="#5abf3c"/>
        <circle cx="14" cy="8"  r="1.5" fill="#5abf3c" opacity="0.7"/>
        <circle cx="20" cy="8"  r="1.5" fill="#5abf3c" opacity="0.4"/>
        <circle cx="8" cy="14"  r="1.5" fill="#5abf3c" opacity="0.7"/>
        <circle cx="14" cy="14" r="2"   fill="#5abf3c"/>
        <circle cx="20" cy="14" r="1.5" fill="#5abf3c" opacity="0.7"/>
        <circle cx="8" cy="20"  r="1.5" fill="#5abf3c" opacity="0.4"/>
        <circle cx="14" cy="20" r="1.5" fill="#5abf3c" opacity="0.7"/>
        <circle cx="20" cy="20" r="1.5" fill="#5abf3c"/>
      </svg>
      <div class="header-title">
        <span class="header-brand">ES-1</span>
        <span class="header-sub">Sample Manager</span>
      </div>
    </div>
    <div class="header-badge">
      <span class="led led-green"></span>
      <span class="header-status">READY</span>
    </div>
  </header>

  <main class="app-main">
    <!-- Drop Zone -->
    <div
      class="dropzone"
      class:active={dropping}
      ondrop={handleDrop}
      ondragover={(e) => { e.preventDefault(); dropping = true; }}
      ondragleave={() => dropping = false}
      role="region"
      aria-label="Audio file drop zone"
    >
      <div class="dropzone-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V5l12-2v13"/>
          <circle cx="6" cy="18" r="3"/>
          <circle cx="18" cy="16" r="3"/>
        </svg>
      </div>
      <p class="dropzone-text">Drop audio files here</p>
      <p class="dropzone-hint">WAV · MP3 · AIFF · FLAC · multiple files at once</p>
    </div>

    {#if statusMsg}
      <div class="status-bar">
        <span class="led led-green led-sm"></span>
        {statusMsg}
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
    padding: 0 var(--sp-5) var(--sp-12);
  }

  /* Header */
  .app-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp-5) 0 var(--sp-6);
    border-bottom: 1px solid var(--border-subtle);
    margin-bottom: var(--sp-8);
  }

  .header-logo {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
  }

  .header-title {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .header-brand {
    font-family: var(--font-mono);
    font-size: var(--text-xl);
    font-weight: 600;
    color: var(--es-green);
    letter-spacing: 0.04em;
    line-height: 1;
  }

  .header-sub {
    font-size: var(--text-xs);
    color: var(--text-muted);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .header-badge {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    padding: var(--sp-2) var(--sp-3);
  }

  .header-status {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-muted);
    letter-spacing: 0.12em;
  }

  /* LED */
  .led {
    display: inline-block;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  .led-green {
    background: var(--es-green);
    box-shadow: 0 0 6px var(--es-green), 0 0 12px rgba(90,191,60,0.4);
    animation: led-pulse 2.4s ease-in-out infinite;
  }

  .led-sm {
    width: 6px;
    height: 6px;
  }

  @keyframes led-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  /* Dropzone */
  .dropzone {
    border: 1.5px dashed var(--border-default);
    border-radius: var(--r-xl);
    padding: var(--sp-10) var(--sp-6);
    text-align: center;
    cursor: default;
    transition: background var(--t-base), border-color var(--t-base);
    background: var(--surface-1);
    margin-bottom: var(--sp-4);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp-2);
  }

  .dropzone:hover {
    border-color: var(--border-green);
    background: color-mix(in oklch, var(--es-green) 4%, var(--surface-1));
  }

  .dropzone.active {
    border-color: var(--es-green);
    background: var(--es-green-glow);
    border-style: solid;
    box-shadow: 0 0 0 1px var(--es-green-dim), inset 0 0 24px rgba(90,191,60,0.06);
  }

  .dropzone-icon {
    color: var(--text-faint);
    transition: color var(--t-base);
    margin-bottom: var(--sp-1);
  }

  .dropzone:hover .dropzone-icon,
  .dropzone.active .dropzone-icon {
    color: var(--es-green-dim);
  }

  .dropzone-text {
    font-size: var(--text-base);
    font-weight: 500;
    color: var(--text-muted);
  }

  .dropzone-hint {
    font-size: var(--text-xs);
    color: var(--text-faint);
    letter-spacing: 0.03em;
  }

  /* Status bar */
  .status-bar {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: var(--text-sm);
    color: var(--text-muted);
    padding: var(--sp-2) var(--sp-3);
    margin-bottom: var(--sp-2);
  }
</style>
