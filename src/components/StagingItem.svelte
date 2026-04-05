<script>
  import { onDestroy } from 'svelte';
  import { updateStagingSlot, removeStagingSlot } from '../lib/stagingStore.js';
  import { drawWaveform, findZeroCrossing, findNextZeroCrossing } from '../lib/waveform.js';

  export let slot;

  let canvas;
  let audioCtx = null;
  let sourceNode = null;
  let isPlaying = false;
  let loopEnabled = false;
  let playheadRatio = null;
  let animFrameId = null;
  let playEndOffset = 0;
  let dragging = null;
  let activeMarker = null;
  let audioBufferCache = null;
  let audioCtxCache = null;

  $: if (canvas && slot.waveformData && !isPlaying) {
    drawWaveform(canvas, slot.waveformData, slot.duration, slot.trimStart, slot.trimEnd, null);
  }

  function restartSource() {
    if (!audioCtxCache || !audioBufferCache) return;
    const ctx = audioCtxCache;
    const currentStart = slot.trimStart ?? 0;
    const currentEnd = slot.trimEnd ?? slot.duration;
    playEndOffset = currentEnd;

    const src = ctx.createBufferSource();
    src.buffer = audioBufferCache;
    src.connect(ctx.destination);
    const startTime = ctx.currentTime;
    src.start(0, currentStart, currentEnd - currentStart);
    sourceNode = src;

    cancelAnimationFrame(animFrameId);
    animFrameId = requestAnimationFrame(() => animatePlayhead(ctx, startTime));

    src.onended = () => {
      if (loopEnabled && isPlaying) {
        restartSource();
      } else {
        isPlaying = false;
        playheadRatio = null;
        cancelAnimationFrame(animFrameId);
        drawWaveform(canvas, slot.waveformData, slot.duration, slot.trimStart, slot.trimEnd, null);
        ctx.close();
        audioCtx = null;
        audioCtxCache = null;
        audioBufferCache = null;
        sourceNode = null;
      }
    };
  }

  // ── Playhead Animation ───────────────────────────────────
  function animatePlayhead(ctx, startTime) {
    if (!isPlaying) return;
    const currentStart = slot.trimStart ?? 0;
    const currentEnd = slot.trimEnd ?? slot.duration;
    const elapsed = ctx.currentTime - startTime;
    const playDuration = currentEnd - currentStart;
    const loopedElapsed = loopEnabled ? elapsed % playDuration : Math.min(elapsed, playDuration);
    playheadRatio = (currentStart + loopedElapsed) / slot.duration;
    drawWaveform(canvas, slot.waveformData, slot.duration, slot.trimStart, slot.trimEnd, playheadRatio);
    animFrameId = requestAnimationFrame(() => animatePlayhead(ctx, startTime));
  }

  // ── Play / Pause ──────────────────────────────────────────
  async function togglePlay() {
    if (isPlaying) {
      stopPlayback();
      return;
    }

    const ctx = new AudioContext();
    audioCtx = ctx;
    audioCtxCache = ctx;

    const response = await fetch(URL.createObjectURL(slot.file));
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    audioBufferCache = audioBuffer;

    isPlaying = true;
    restartSource();
  }

  function stopPlayback() {
    cancelAnimationFrame(animFrameId);
    if (sourceNode) {
      sourceNode.onended = null;
      sourceNode.stop();
      sourceNode = null;
    }
    isPlaying = false;
    playheadRatio = null;
    if (canvas && slot.waveformData) {
      drawWaveform(canvas, slot.waveformData, slot.duration, slot.trimStart, slot.trimEnd, null);
    }
    audioCtx?.close();
    audioCtx = null;
    audioCtxCache = null;
    audioBufferCache = null;
  }

  // ── Nudging via Arrow Keys ────────────────────────────────
  function onMarkerKeydown(e) {
    if (!activeMarker || !slot.rawSamples) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();

    const direction = e.key === 'ArrowRight' ? 'forward' : 'backward';
    const current = activeMarker === 'start'
      ? (slot.trimStart ?? 0)
      : (slot.trimEnd ?? slot.duration);

    const newVal = findNextZeroCrossing(current, slot.rawSamples, slot.sampleRate, direction);

    if (activeMarker === 'start') {
      const val = Math.max(0, Math.min(newVal, (slot.trimEnd ?? slot.duration) - 0.01));
      updateStagingSlot(slot.id, { trimStart: val });
    } else {
      const val = Math.max(slot.trimStart + 0.01, Math.min(newVal, slot.duration));
      updateStagingSlot(slot.id, { trimEnd: val });
    }

    if (isPlaying && audioBufferCache && audioCtxCache) {
      if (sourceNode) { sourceNode.onended = null; sourceNode.stop(); sourceNode = null; }
      restartSource();
    }
  }

  // ── Drag Trimming ─────────────────────────────────────────
  function getTimeFromMouseX(e) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    return (x / rect.width) * slot.duration;
  }

  function onMouseDown(e) {
    if (!slot.waveformData) return;
    const startRatio = slot.trimStart / slot.duration;
    const endRatio = (slot.trimEnd ?? slot.duration) / slot.duration;
    const rect = canvas.getBoundingClientRect();
    const clickRatio = (e.clientX - rect.left) / rect.width;

    const distStart = Math.abs(clickRatio - startRatio);
    const distEnd = Math.abs(clickRatio - endRatio);
    dragging = distStart < distEnd ? 'start' : 'end';

    activeMarker = dragging;
    window.removeEventListener('keydown', onMarkerKeydown);
    window.addEventListener('keydown', onMarkerKeydown);

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  }

  function onMouseMove(e) {
    if (!dragging) return;
    let t = getTimeFromMouseX(e);

    if (slot.rawSamples && slot.sampleRate) {
      t = findZeroCrossing(t, slot.rawSamples, slot.sampleRate);
    }

    if (dragging === 'start') {
      const val = Math.max(0, Math.min(t, (slot.trimEnd ?? slot.duration) - 0.01));
      updateStagingSlot(slot.id, { trimStart: val });
    } else {
      const val = Math.max(slot.trimStart + 0.01, Math.min(t, slot.duration));
      updateStagingSlot(slot.id, { trimEnd: val });
    }
  }

  function onMouseUp() {
    dragging = null;
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);

    if (isPlaying && audioBufferCache && audioCtxCache) {
      if (sourceNode) { sourceNode.onended = null; sourceNode.stop(); sourceNode = null; }
      restartSource();
    }
  }

  // ── Input Handlers ────────────────────────────────────────
  function onNameInput(e) {
    updateStagingSlot(slot.id, { name: e.target.value });
  }

  function onTrimStartInput(e) {
    let val = parseFloat(e.target.value) || 0;
    if (slot.rawSamples && slot.sampleRate) {
      val = findZeroCrossing(val, slot.rawSamples, slot.sampleRate);
    }
    val = Math.min(val, (slot.trimEnd ?? slot.duration) - 0.01);
    updateStagingSlot(slot.id, { trimStart: val });
  }

  function onTrimEndInput(e) {
    const raw = parseFloat(e.target.value);
    let val = isNaN(raw) ? null : Math.max(raw, slot.trimStart + 0.01);
    if (val !== null && slot.rawSamples && slot.sampleRate) {
      val = findZeroCrossing(val, slot.rawSamples, slot.sampleRate);
    }
    updateStagingSlot(slot.id, { trimEnd: val });
  }

  function toggle(key) {
    updateStagingSlot(slot.id, { [key]: !slot[key] });
  }

  function remove() {
    stopPlayback();
    removeStagingSlot(slot.id);
  }

  onDestroy(() => {
    stopPlayback();
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('keydown', onMarkerKeydown);
  });

  $: displayDuration = slot.duration ? slot.duration.toFixed(2) + 's' : '…';
  $: trimEndDisplay = (slot.trimEnd ?? slot.duration ?? 0).toFixed(2);
</script>

<div class="staging-item" class:converting={slot.status === 'converting'} class:done={slot.status === 'done'}>

  <div class="item-header">
    <input class="name-input" type="text" value={slot.name} oninput={onNameInput} />
    <span class="duration">{displayDuration}</span>
    {#if slot.status === 'converting'}
      <span class="badge converting">⏳</span>
    {:else if slot.status === 'done'}
      <span class="badge done">✅</span>
    {:else if slot.status === 'error'}
      <span class="badge error">❌</span>
    {/if}
    <button class="remove-btn" onclick={remove} title="Remove">✕</button>
  </div>

  {#if slot.waveformData}
    <div class="waveform-wrap">
      <canvas
        bind:this={canvas}
        width="700"
        height="60"
        onmousedown={onMouseDown}
        style="cursor: {dragging ? 'grabbing' : 'ew-resize'}"
      ></canvas>
    </div>

        <div class="trim-row">
      <button class="play-btn" onclick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
        {isPlaying ? '⏸' : '▶'}
      </button>
      <button
        class="loop-btn"
        class:active={loopEnabled}
        onclick={() => loopEnabled = !loopEnabled}
        title="Loop on/off"
      >🔁</button>
      <label
        class:marker-active={activeMarker === 'start'}
        onclick={() => { activeMarker = 'start'; window.removeEventListener('keydown', onMarkerKeydown); window.addEventListener('keydown', onMarkerKeydown); }}
      >
        <span class="marker-dot" style="background: #4ade80; opacity: {activeMarker === 'start' ? 1 : 0.3}">▶</span>
        Start
        <input type="number" min="0" max={slot.duration} step="0.01"
          value={slot.trimStart.toFixed(2)} oninput={onTrimStartInput}
          onfocus={() => { activeMarker = 'start'; window.removeEventListener('keydown', onMarkerKeydown); window.addEventListener('keydown', onMarkerKeydown); }} />s
      </label>
      <label
        class:marker-active={activeMarker === 'end'}
        onclick={() => { activeMarker = 'end'; window.removeEventListener('keydown', onMarkerKeydown); window.addEventListener('keydown', onMarkerKeydown); }}
      >
        <span class="marker-dot" style="background: #f87171; opacity: {activeMarker === 'end' ? 1 : 0.3}">▶</span>
        End
        <input type="number" min="0" max={slot.duration} step="0.01"
          value={trimEndDisplay} oninput={onTrimEndInput}
          onfocus={() => { activeMarker = 'end'; window.removeEventListener('keydown', onMarkerKeydown); window.addEventListener('keydown', onMarkerKeydown); }} />s
      </label>
      {#if activeMarker}
        <span class="nudge-hint">← → to nudge</span>
      {/if}
    </div>
  {:else}
    <div class="waveform-placeholder">Analyzing…</div>
  {/if}

  <div class="options-row">
    <label class="opt" title="Boost loudest point to -1 dBFS">
      <input type="checkbox" checked={slot.normalize} onchange={() => toggle('normalize')} />
      Normalize
    </label>
    <label class="opt" title="Remove DC offset">
      <input type="checkbox" checked={slot.dcOffset} onchange={() => toggle('dcOffset')} />
      DC Offset
    </label>
    <label class="opt" title="+4dB high shelf boost from 4kHz">
      <input type="checkbox" checked={slot.highpassBoost} onchange={() => toggle('highpassBoost')} />
      Hi Boost
    </label>
    <label class="opt" title="Stereo uses 2 slots on the ES-1">
      <input type="checkbox" checked={slot.stereo} onchange={() => toggle('stereo')} />
      Stereo (2 slots)
    </label>
  </div>

</div>

<style>
  .staging-item {
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-lg);
    padding: var(--sp-3) var(--sp-4);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
    transition: border-color var(--t-fast);
  }

  .staging-item.done {
    border-color: var(--border-green);
    background: color-mix(in oklch, var(--es-green) 3%, var(--surface-2));
  }

  .staging-item.converting {
    border-color: rgba(90,191,60,0.2);
  }

  /* Header row */
  .item-header {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
  }

  .name-input {
    flex: 1;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    padding: var(--sp-2) var(--sp-3);
    font-size: var(--text-sm);
    font-weight: 500;
    color: var(--text-bright);
    min-width: 0;
    transition: border-color var(--t-fast), background var(--t-fast);
  }

  .name-input::placeholder { color: var(--text-faint); }

  .name-input:focus {
    outline: none;
    border-color: var(--es-green-dim);
    background: var(--surface-2);
  }

  .duration {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-muted);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .badge {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    padding: 1px 7px;
    border-radius: var(--r-sm);
    flex-shrink: 0;
    letter-spacing: 0.04em;
  }

  .badge.done {
    color: var(--es-green);
    background: var(--es-green-glow);
    border: 1px solid var(--border-green);
  }

  .badge.converting {
    color: var(--es-green-dim);
    background: rgba(58,125,40,0.12);
  }

  .badge.error {
    color: var(--es-red);
    background: var(--es-red-glow);
    border: 1px solid var(--border-red);
  }

  .remove-btn {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: var(--text-faint);
    border-radius: var(--r-sm);
    flex-shrink: 0;
    transition: color var(--t-fast), background var(--t-fast);
  }

  .remove-btn:hover {
    color: var(--es-red);
    background: var(--es-red-glow);
  }

  /* Waveform */
  .waveform-wrap {
    border-radius: var(--r-sm);
    overflow: hidden;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
  }

  .waveform-wrap canvas {
    display: block;
    width: 100%;
    height: 60px;
  }

  .waveform-placeholder {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: var(--text-xs);
    color: var(--text-faint);
    padding: var(--sp-3) 0;
  }

  /* Trim row */
  .trim-row {
    display: flex;
    align-items: center;
    gap: var(--sp-3);
    flex-wrap: wrap;
  }

  .play-btn {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    background: var(--surface-4);
    border: 1px solid var(--border-default);
    color: var(--text);
    flex-shrink: 0;
    transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
  }

  .play-btn:hover {
    background: var(--surface-raised);
    border-color: var(--es-green-dim);
    color: var(--es-green);
  }

  .loop-btn {
    font-size: 13px;
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-sm);
    border: 1px solid transparent;
    color: var(--text-faint);
    flex-shrink: 0;
    transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast);
  }

  .loop-btn:hover { color: var(--text-muted); }

  .loop-btn.active {
    background: var(--es-green-glow);
    border-color: var(--border-green);
    color: var(--es-green);
  }

  label {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-xs);
    color: var(--text-muted);
    cursor: pointer;
  }

  label.marker-active {
    color: var(--es-green);
  }

  .marker-dot {
    font-size: 8px;
    flex-shrink: 0;
  }

  label input[type="number"] {
    width: 58px;
    background: var(--surface-1);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-sm);
    padding: 3px 6px;
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-bright);
    text-align: right;
    transition: border-color var(--t-fast);
    -moz-appearance: textfield;
  }

  label input[type="number"]::-webkit-inner-spin-button { display: none; }

  label input[type="number"]:focus {
    outline: none;
    border-color: var(--es-green-dim);
  }

  .nudge-hint {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    color: var(--text-faint);
    margin-left: auto;
  }

  /* Options row */
  .options-row {
    display: flex;
    gap: var(--sp-4);
    flex-wrap: wrap;
    padding-top: var(--sp-2);
    border-top: 1px solid var(--border-subtle);
  }

  .opt {
    display: flex;
    align-items: center;
    gap: var(--sp-2);
    font-size: var(--text-xs);
    color: var(--text-muted);
    cursor: pointer;
    user-select: none;
  }

  .opt input[type="checkbox"] {
    width: 14px;
    height: 14px;
    accent-color: var(--es-green);
    cursor: pointer;
  }

  .opt:hover { color: var(--text); }
</style>