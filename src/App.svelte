<script>
  import { addToStaging, stagingSlots } from './lib/stagingStore.js';
  import { analyzeFile }                from './lib/waveform.js';
  import StagingList                    from './components/StagingList.svelte';
  import SlotList                       from './components/SlotList.svelte';
  import ExportBar                      from './components/ExportBar.svelte';

  let dropping = false;
  let statusMsg = '';
  let statusTimer;

  const AUDIO_EXTS = /\.(wav|mp3|aiff?|flac|ogg|m4a)$/i;

  async function handleDrop(e) {
    e.preventDefault();
    dropping = false;
    const files = [...e.dataTransfer.files].filter(
      f => f.type.startsWith('audio/') || AUDIO_EXTS.test(f.name)
    );
    if (!files.length) return;
    clearTimeout(statusTimer);
    statusMsg = `Queuing ${files.length} file${files.length > 1 ? 's' : ''}…`;
    files.forEach(addToStaging);
    for (const file of files) {
      analyzeFile(file)
        .then(({ duration, peaks, rawSamples, sampleRate }) => {
          stagingSlots.update(all => {
            const match = [...all].reverse().find(s => s.file.name === file.name && s.waveformData === null);
            if (!match) return all;
            return all.map(s => s.id === match.id
              ? { ...s, duration, waveformData: peaks, trimEnd: duration, rawSamples, sampleRate }
              : s);
          });
        })
        .catch(err => console.warn('Analysis failed:', file.name, err));
    }
    statusMsg = `${files.length} sample${files.length > 1 ? 's' : ''} queued.`;
    statusTimer = setTimeout(() => { statusMsg = ''; }, 4000);
  }
</script>

<div class="shell">
  <header class="hdr">
    <div class="hdr-l">
      <div class="logo" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
          <rect width="28" height="28" rx="5" fill="#18181f"/>
          <rect x="2.5" y="2.5" width="23" height="23" rx="3.5" fill="#1e1e27" stroke="rgba(61,220,92,0.15)" stroke-width="0.75"/>
          {#each [7,14,21] as cy}{#each [7,14,21] as cx}
            <circle cx={cx} cy={cy} r="1.6" fill="#3ddc5c" opacity={cx===14&&cy===14?'1':cx===7&&cy===7?'0.85':'0.3'}/>
          {/each}{/each}
        </svg>
      </div>
      <div class="names">
        <span class="brand">ES-1</span>
        <span class="sub">SAMPLE MANAGER</span>
      </div>
    </div>
    <div class="badge">
      <span class="led led-green"></span>
      <span class="badge-t">READY</span>
    </div>
  </header>

  <main>
    <div
      class="dz"
      class:dz-on={dropping}
      role="region"
      aria-label="Audio file drop zone"
      ondrop={handleDrop}
      ondragover={(e)=>{e.preventDefault();dropping=true;}}
      ondragleave={()=>dropping=false}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" class="dz-ico">
        <path d="M9 18V5l12-2v13"/>
        <circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
      </svg>
      <p class="dz-main">Drop audio files here</p>
      <p class="dz-hint">WAV · MP3 · AIFF · FLAC · multiple files</p>
    </div>
    {#if statusMsg}
      <div class="status" role="status">
        <span class="led led-green"></span>{statusMsg}
      </div>
    {/if}
    <StagingList />
    <SlotList />
    <ExportBar />
  </main>
</div>

<style>
  :global(html), :global(body), :global(#app) {
    background: #0d0d10 !important;
    min-height: 100dvh;
  }

  .shell {
    background: #0d0d10;
    min-height: 100dvh;
    max-width: 860px;
    margin: 0 auto;
    padding: 0 var(--sp5) var(--sp12);
  }

  .hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--sp6) 0;
    border-bottom: 1px solid var(--b0);
    margin-bottom: var(--sp8);
  }
  .hdr-l { display: flex; align-items: center; gap: var(--sp3); }
  .logo   { flex-shrink: 0; }
  .names  { display: flex; flex-direction: column; gap: 1px; }
  .brand  {
    font-family: var(--mono);
    font-size: var(--txl);
    font-weight: 600;
    color: var(--g);
    letter-spacing: 0.06em;
    line-height: 1;
  }
  .sub {
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tm);
    letter-spacing: 0.14em;
  }
  .badge {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    background: var(--s2);
    border: 1px solid var(--b1);
    border-radius: var(--r2);
    padding: 5px var(--sp3);
  }
  .badge-t {
    font-family: var(--mono);
    font-size: var(--tx);
    font-weight: 600;
    color: var(--tm);
    letter-spacing: 0.14em;
  }

  .dz {
    background: var(--s1);
    border: 1px solid var(--b1);
    border-radius: var(--r3);
    padding: var(--sp10) var(--sp6);
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--sp2);
    cursor: default;
    transition: background var(--tb3), border-color var(--tb3);
    margin-bottom: var(--sp4);
  }
  .dz:hover        { border-color: var(--b2); background: var(--s2); }
  .dz.dz-on        { border-color: var(--gd); background: var(--gg); }
  .dz-ico          { color: var(--tf); margin-bottom: var(--sp1); transition: color var(--tb3); }
  .dz:hover .dz-ico, .dz.dz-on .dz-ico { color: var(--gd); }
  .dz-main         { font-size: var(--tb2); font-weight: 500; color: var(--tm); }
  .dz-hint         { font-family: var(--mono); font-size: var(--tx); color: var(--tf); letter-spacing: 0.04em; }

  .status {
    display: flex;
    align-items: center;
    gap: var(--sp2);
    font-family: var(--mono);
    font-size: var(--ts);
    color: var(--tm);
    padding: var(--sp2) 0 var(--sp1);
  }
</style>
