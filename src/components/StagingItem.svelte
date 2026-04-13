<script>
  import { onDestroy } from 'svelte';
  import { updateStagingSlot, removeStagingSlot } from '../lib/stagingStore.js';
  import { drawWaveform, findZeroCrossing, findNextZeroCrossing } from '../lib/waveform.js';

  export let slot;

  let canvas;
  let isPlaying         = false;
  let loopEnabled       = false;
  let playheadRatio     = null;
  let activeMarker      = null;
  let dragging          = null;
  let animFrameId       = null;
  let sourceNode        = null;
  let audioCtxCache     = null;
  let audioBufferCache  = null;

  // ── Reactive waveform draw ────────────────────────────────
  $: if (canvas && slot.waveformData && !isPlaying) {
    drawWaveform(canvas, slot.waveformData, slot.duration, slot.trimStart, slot.trimEnd, null);
  }

  // ── Playback ──────────────────────────────────────────────
  function makeSource(ctx) {
    const start = slot.trimStart ?? 0;
    const end   = slot.trimEnd   ?? slot.duration;
    const src   = ctx.createBufferSource();
    src.buffer  = audioBufferCache;
    src.connect(ctx.destination);
    src.start(0, start, end - start);
    sourceNode = src;

    const t0 = ctx.currentTime;
    cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(() => animatePlayhead(ctx, t0, start, end));

    src.onended = () => {
      if (loopEnabled && isPlaying) {
        makeSource(ctx);
      } else {
        stopPlayback();
      }
    };
  }

  function animatePlayhead(ctx, t0, start, end) {
    if (!isPlaying) return;
    const elapsed  = ctx.currentTime - t0;
    const duration = end - start;
    const looped   = loopEnabled ? elapsed % duration : Math.min(elapsed, duration);
    playheadRatio  = (start + looped) / slot.duration;
    drawWaveform(canvas, slot.waveformData, slot.duration, slot.trimStart, slot.trimEnd, playheadRatio);
    animFrameId = requestAnimationFrame(() => animatePlayhead(ctx, t0, start, end));
  }

  async function togglePlay() {
    if (isPlaying) { stopPlayback(); return; }

    const ctx = new AudioContext();
    audioCtxCache = ctx;

    const ab = await fetch(URL.createObjectURL(slot.file))
      .then(r => r.arrayBuffer());
    audioBufferCache = await ctx.decodeAudioData(ab);

    isPlaying = true;
    makeSource(ctx);
  }

  function stopPlayback() {
    cancelAnimationFrame(animFrameId);
    if (sourceNode) {
      sourceNode.onended = null;
      try { sourceNode.stop(); } catch {}
      sourceNode = null;
    }
    isPlaying    = false;
    playheadRatio = null;
    if (canvas && slot.waveformData) {
      drawWaveform(canvas, slot.waveformData, slot.duration, slot.trimStart, slot.trimEnd, null);
    }
    audioCtxCache?.close();
    audioCtxCache    = null;
    audioBufferCache = null;
  }

  // ── Arrow-key nudge ───────────────────────────────────────
  function onMarkerKeydown(e) {
    if (!activeMarker || !slot.rawSamples) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const dir     = e.key === 'ArrowRight' ? 'forward' : 'backward';
    const current = activeMarker === 'start'
      ? (slot.trimStart ?? 0)
      : (slot.trimEnd   ?? slot.duration);
    const next = findNextZeroCrossing(current, slot.rawSamples, slot.sampleRate, dir);
    applyMarker(activeMarker, next);
  }

  function applyMarker(which, raw) {
    if (which === 'start') {
      const val = Math.max(0, Math.min(raw, (slot.trimEnd ?? slot.duration) - 0.001));
      updateStagingSlot(slot.id, { trimStart: val });
    } else {
      const val = Math.max((slot.trimStart ?? 0) + 0.001, Math.min(raw, slot.duration));
      updateStagingSlot(slot.id, { trimEnd: val });
    }
    if (isPlaying && audioBufferCache && audioCtxCache) {
      if (sourceNode) { sourceNode.onended = null; try { sourceNode.stop(); } catch {} sourceNode = null; }
      makeSource(audioCtxCache);
    }
  }

  // ── Drag trim ─────────────────────────────────────────────
  function timeFromMouse(e) {
    const rect = canvas.getBoundingClientRect();
    return (Math.max(0, Math.min(e.clientX - rect.left, rect.width)) / rect.width) * slot.duration;
  }

  function onMouseDown(e) {
    if (!slot.waveformData) return;
    const startR = slot.trimStart / slot.duration;
    const endR   = (slot.trimEnd ?? slot.duration) / slot.duration;
    const click  = (e.clientX - canvas.getBoundingClientRect().left) / canvas.getBoundingClientRect().width;
    dragging = Math.abs(click - startR) < Math.abs(click - endR) ? 'start' : 'end';
    activeMarker = dragging;
    window.removeEventListener('keydown', onMarkerKeydown);
    window.addEventListener('keydown', onMarkerKeydown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup',  onMouseUp);
  }

  function onMouseMove(e) {
    if (!dragging) return;
    let t = timeFromMouse(e);
    if (slot.rawSamples) t = findZeroCrossing(t, slot.rawSamples, slot.sampleRate);
    applyMarker(dragging, t);
  }

  function onMouseUp() {
    dragging = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup',   onMouseUp);
  }

  function setMarker(which) {
    activeMarker = which;
    window.removeEventListener('keydown', onMarkerKeydown);
    window.addEventListener('keydown', onMarkerKeydown);
  }

  function toggle(key) { updateStagingSlot(slot.id, { [key]: !slot[key] }); }
  function remove() { stopPlayback(); removeStagingSlot(slot.id); }

  onDestroy(() => {
    stopPlayback();
    window.removeEventListener('mousemove',  onMouseMove);
    window.removeEventListener('mouseup',    onMouseUp);
    window.removeEventListener('keydown',    onMarkerKeydown);
  });

  $: displayDur    = slot.duration ? slot.duration.toFixed(2) + ' s' : '…';
  $: trimEndDisp   = (slot.trimEnd ?? slot.duration ?? 0).toFixed(3);
</script>

<div
  class="staging-item"
  class:is-converting={slot.status === 'converting'}
  class:is-done={slot.status === 'done'}
  class:is-error={slot.status === 'error'}
>
  <!-- Header row -->
  <div class="item-header">
    <input
      class="name-input"
      type="text"
      value={slot.name}
      oninput={(e) => updateStagingSlot(slot.id, { name: e.target.value })}
      placeholder="Sample name"
      aria-label="Sample name"
    />
    <span class="duration">{displayDur}</span>

    <!-- Status badge (SVG only — no emoji) -->
    {#if slot.status === 'converting'}
      <span class="badge badge-converting" aria-label="Converting">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
        </svg>
        CONV
      </span>
    {:else if slot.status === 'done'}
      <span class="badge badge-done" aria-label="Done">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <polyline points="20 6 9 17 4 12"/>
        </svg>
        OK
      </span>
    {:else if slot.status === 'error'}
      <span class="badge badge-error" aria-label="Error">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
          <line x1="18" y1="6" x2="6"  y2="18"/>
          <line x1="6"  y1="6" x2="18" y2="18"/>
        </svg>
        ERR
      </span>
    {/if}

    <button class="remove-btn" onclick={remove} aria-label="Remove sample" title="Remove">
      <svg width="11" height="11" viewBox="0 0 14 14" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <line x1="1" y1="1" x2="13" y2="13"/>
        <line x1="13" y1="1" x2="1" y2="13"/>
      </svg>
    </button>
  </div>

  <!-- Waveform -->
  {#if slot.waveformData}
    <div class="waveform-wrap">
      <canvas
        bind:this={canvas}
        width="700"
        height="60"
        onmousedown={onMouseDown}
        style="cursor: {dragging ? 'grabbing' : 'ew-resize'}"
        aria-label="Waveform with trim markers"
      ></canvas>
    </div>

    <!-- Transport + Trim controls -->
    <div class="trim-row">
      <button
        class="play-btn"
        class:active={isPlaying}
        onclick={togglePlay}
        aria-label={isPlaying ? 'Pause' : 'Play'}
        title={isPlaying ? 'Pause' : 'Play'}
      >
        {#if isPlaying}
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <rect x="6"  y="4" width="4" height="16"/>
            <rect x="14" y="4" width="4" height="16"/>
          </svg>
        {:else}
          <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <polygon points="5 3 19 12 5 21 5 3"/>
          </svg>
        {/if}
      </button>

      <button
        class="loop-btn"
        class:active={loopEnabled}
        onclick={() => loopEnabled = !loopEnabled}
        aria-label="Toggle loop"
        title="Loop"
      >
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <polyline points="17 1 21 5 17 9"/>
          <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
          <polyline points="7 23 3 19 7 15"/>
          <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
        </svg>
      </button>

      <!-- Start marker -->
      <label
        class="marker-label"
        class:active={activeMarker === 'start'}
        onclick={() => setMarker('start')}
        title="Start trim point (click then use ← → to nudge)"
      >
        <span class="marker-pip start-pip" aria-hidden="true"></span>
        <span class="marker-key">IN</span>
        <input
          type="number"
          min="0"
          max={slot.duration}
          step="0.001"
          value={slot.trimStart.toFixed(3)}
          oninput={(e) => {
            let v = parseFloat(e.target.value) || 0;
            if (slot.rawSamples) v = findZeroCrossing(v, slot.rawSamples, slot.sampleRate);
            v = Math.max(0, Math.min(v, (slot.trimEnd ?? slot.duration) - 0.001));
            updateStagingSlot(slot.id, { trimStart: v });
          }}
          onfocus={() => setMarker('start')}
          aria-label="Trim start"
        />
        <span class="unit">s</span>
      </label>

      <!-- End marker -->
      <label
        class="marker-label"
        class:active={activeMarker === 'end'}
        onclick={() => setMarker('end')}
        title="End trim point (click then use ← → to nudge)"
      >
        <span class="marker-pip end-pip" aria-hidden="true"></span>
        <span class="marker-key">OUT</span>
        <input
          type="number"
          min="0"
          max={slot.duration}
          step="0.001"
          value={trimEndDisp}
          oninput={(e) => {
            const raw = parseFloat(e.target.value);
            let v = isNaN(raw) ? null : Math.max(raw, (slot.trimStart ?? 0) + 0.001);
            if (v !== null && slot.rawSamples) v = findZeroCrossing(v, slot.rawSamples, slot.sampleRate);
            updateStagingSlot(slot.id, { trimEnd: v });
          }}
          onfocus={() => setMarker('end')}
          aria-label="Trim end"
        />
        <span class="unit">s</span>
      </label>

      {#if activeMarker}
        <span class="nudge-hint" aria-live="polite">← → nudge</span>
      {/if}
    </div>

  {:else}
    <div class="waveform-placeholder" role="status">
      <span class="scanning-dot" aria-hidden="true"></span>
      Analyzing…
    </div>
  {/if}

  <!-- Options -->
  <div class="options-row">
    {#each [
      { key: 'normalize',     label: 'Normalize',    tip: 'Peak-normalize to −1 dBFS' },
      { key: 'dcOffset',      label: 'DC Offset',    tip: 'Remove DC offset (highpass @ 5 Hz)' },
      { key: 'highpassBoost', label: 'Hi Boost',     tip: '+4 dB shelf from 4 kHz' },
      { key: 'stereo',        label: 'Stereo',       tip: 'Stereo uses 2 slots on ES-1' },
    ] as opt}
      <label class="opt" title={opt.tip}>
        <input type="checkbox" checked={slot[opt.key]} onchange={() => toggle(opt.key)} />
        {opt.label}
      </label>
    {/each}
  </div>
</div>

<style>
  .staging-item {
    background: var(--s2);
    border: 1px solid var(--b0);
    border-radius: var(--r3);
    padding: var(--sp3) var(--sp4);
    display: flex;
    flex-direction: column;
    gap: var(--sp3);
    transition: border-color var(--tf2);
  }
  .staging-item.is-done  { border-color: rgba(90,191,60,0.2); background: color-mix(in oklch, #5abf3c 2.5%, var(--s2)); }
  .staging-item.is-converting { border-color: rgba(90,191,60,0.12); }
  .staging-item.is-error { border-color: rgba(217,64,64,0.25); }

  /* Header */
  .item-header { display: flex; align-items: center; gap: var(--sp2); }

  .name-input {
    flex: 1;
    background: var(--s1);
    border: 1px solid var(--b0);
    border-radius: var(--r1);
    padding: var(--sp1) var(--sp3);
    font-size: var(--ts);
    font-weight: 500;
    color: var(--tb);
    min-width: 0;
    transition: border-color var(--tf2), background var(--tf2);
  }
  .name-input::placeholder { color: var(--tf); }
  .name-input:focus { outline: none; border-color: var(--green-dim); background: var(--s3); }

  .duration {
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tm);
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* Status badges */
  .badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-family: var(--mono);
    font-size: 10px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: var(--r1);
    letter-spacing: 0.08em;
    flex-shrink: 0;
  }
  .badge-done {
    color: var(--tg);
    background: rgba(90,191,60,0.1);
    border: 1px solid rgba(90,191,60,0.25);
  }
  .badge-converting {
    color: var(--green-dim);
    background: rgba(58,125,40,0.1);
  }
  .badge-error {
    color: var(--tr);
    background: rgba(217,64,64,0.1);
    border: 1px solid rgba(217,64,64,0.25);
  }

  .remove-btn {
    width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    color: var(--tf);
    border-radius: var(--r1);
    flex-shrink: 0;
    transition: color var(--tf2), background var(--tf2);
  }
  .remove-btn:hover { color: var(--tr); background: rgba(217,64,64,0.1); }

  /* Waveform */
  .waveform-wrap {
    border-radius: var(--r1);
    overflow: hidden;
    background: var(--s1);
    border: 1px solid var(--b0);
  }
  .waveform-wrap canvas { display: block; width: 100%; height: 60px; }

  .waveform-placeholder {
    display: flex; align-items: center; gap: var(--sp2);
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tf);
    padding: var(--sp3) 0;
  }

  @keyframes scan { 0%,100%{opacity:0.2} 50%{opacity:1} }
  .scanning-dot {
    display: inline-block;
    width: 5px; height: 5px;
    border-radius: 50%;
    background: var(--green-dim);
    animation: scan 1.2s ease-in-out infinite;
  }

  /* Trim row */
  .trim-row {
    display: flex;
    align-items: center;
    gap: var(--sp3);
    flex-wrap: wrap;
  }

  .play-btn {
    width: 30px; height: 30px;
    border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    background: var(--s4);
    border: 1px solid var(--b1);
    color: var(--t);
    flex-shrink: 0;
    transition: background var(--tf2), border-color var(--tf2), color var(--tf2);
  }
  .play-btn:hover  { border-color: var(--green-dim); color: var(--tg); }
  .play-btn.active { background: var(--green-glow); border-color: rgba(90,191,60,0.4); color: var(--tg); }

  .loop-btn {
    width: 26px; height: 26px;
    display: flex; align-items: center; justify-content: center;
    border-radius: var(--r1);
    border: 1px solid transparent;
    color: var(--tf);
    flex-shrink: 0;
    transition: background var(--tf2), border-color var(--tf2), color var(--tf2);
  }
  .loop-btn:hover { color: var(--tm); }
  .loop-btn.active { background: var(--green-glow); border-color: rgba(90,191,60,0.3); color: var(--tg); }

  .marker-label {
    display: flex; align-items: center; gap: 5px;
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tm);
    cursor: pointer;
    user-select: none;
    transition: color var(--tf2);
  }
  .marker-label.active { color: var(--tb); }

  .marker-pip {
    display: inline-block;
    width: 5px; height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .start-pip { background: var(--green); }
  .end-pip   { background: var(--amber); }

  .marker-key {
    font-weight: 600;
    letter-spacing: 0.08em;
    color: var(--tm);
  }
  .marker-label.active .marker-key { color: var(--tb); }

  .marker-label input[type="number"] {
    width: 62px;
    background: var(--s1);
    border: 1px solid var(--b0);
    border-radius: var(--r1);
    padding: 3px 6px;
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tb);
    text-align: right;
    transition: border-color var(--tf2);
    -moz-appearance: textfield;
  }
  .marker-label input[type="number"]::-webkit-inner-spin-button { display: none; }
  .marker-label input[type="number"]:focus { outline: none; border-color: var(--green-dim); }

  .unit { font-size: var(--tx); color: var(--tf); }

  .nudge-hint {
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tf);
    margin-left: auto;
    letter-spacing: 0.04em;
  }

  /* Options */
  .options-row {
    display: flex;
    gap: var(--sp4);
    flex-wrap: wrap;
    padding-top: var(--sp2);
    border-top: 1px solid var(--b0);
  }
  .opt {
    display: flex; align-items: center; gap: var(--sp2);
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tm);
    cursor: pointer;
    user-select: none;
    letter-spacing: 0.04em;
    transition: color var(--tf2);
  }
  .opt:hover { color: var(--t); }
  .opt input[type="checkbox"] {
    width: 13px; height: 13px;
    accent-color: var(--green);
    cursor: pointer;
  }
</style>
