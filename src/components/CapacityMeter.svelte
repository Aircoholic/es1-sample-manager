<script>
  /**
   * CapacityMeter — live preview of how the converted samples pack into one or
   * more .ES1 backups. Updates reactively as samples are added/removed/edited.
   *
   * Shows:
   *   - a segmented bar (one fill block per backup, scaled to that backup's fill)
   *   - "X.X s / 98.3 s" for the current backup
   *   - a hint when the set spills into multiple backups
   */
  import { slots }                          from '../lib/slotStore.js';
  import { summarize, CAPACITY_SECONDS }    from '../lib/es1Capacity.js';

  let info = null;     // result of summarize()
  let token = 0;       // guards against out-of-order async updates

  // Recompute whenever the slots store changes.
  $: recompute($slots);

  async function recompute(list) {
    const mine = ++token;
    const hasAudio = list.some(s => s?.blob instanceof Blob);
    if (!hasAudio) { info = null; return; }
    const result = await summarize(list);
    if (mine === token) info = result;   // ignore stale results
  }

  // Byte-based fill ratio — matches the packing logic exactly. When the set
  // spills into multiple backups, the first one is full by definition.
  $: firstPct = info ? (overflow ? 1 : info.firstBackupFillRatio) : 0;
  $: nearFull = firstPct > 0.85;
  $: overflow = info && info.backupCount > 1;
</script>

{#if info}
  <div class="meter" class:overflow>
    <div class="meter-hdr">
      <span class="meter-label">
        {overflow ? `BACKUP 1 / ${info.backupCount}` : 'BACKUP CAPACITY'}
      </span>
      <span class="meter-val" class:warn={nearFull || overflow}>
        {info.firstBackupSeconds.toFixed(1)}s / {CAPACITY_SECONDS.toFixed(0)}s
      </span>
    </div>

    <div class="track">
      <div
        class="fill"
        class:near={nearFull}
        class:over={overflow}
        style="width:{(firstPct * 100).toFixed(1)}%"
      ></div>
    </div>

    <div class="meter-foot">
      <span class="foot-slots">
        {info.slotCount} sample{info.slotCount !== 1 ? 's' : ''} ·
        {info.totalSeconds.toFixed(1)}s total
      </span>
      {#if overflow}
        <span class="foot-split">
          needs {info.backupCount} backups
        </span>
      {:else}
        <span class="foot-room">
          {(CAPACITY_SECONDS - info.firstBackupSeconds).toFixed(1)}s free
        </span>
      {/if}
    </div>
  </div>
{/if}

<style>
  .meter {
    background: var(--s2);
    border: 1px solid var(--b1);
    border-radius: var(--r2);
    padding: var(--sp3) var(--sp4);
    display: flex;
    flex-direction: column;
    gap: var(--sp2);
  }
  .meter.overflow { border-color: rgba(224,122,26,0.35); }

  .meter-hdr { display: flex; justify-content: space-between; align-items: baseline; }
  .meter-label {
    font-family: var(--mono);
    font-size: var(--tx);
    font-weight: 600;
    letter-spacing: 0.1em;
    color: var(--tm);
  }
  .meter-val {
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tm);
    letter-spacing: 0.04em;
  }
  .meter-val.warn { color: #c87010; }

  .track {
    height: 5px;
    background: var(--s4);
    border-radius: 99px;
    overflow: hidden;
  }
  .fill {
    height: 100%;
    background: var(--g);
    border-radius: 99px;
    transition: width 160ms ease-out, background 200ms;
    min-width: 2px;
  }
  .fill.near { background: var(--a); }
  .fill.over { background: #e07a1a; }

  .meter-foot {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-family: var(--mono);
    font-size: var(--tx);
    letter-spacing: 0.03em;
  }
  .foot-slots { color: var(--tf); }
  .foot-room  { color: var(--tf); }
  .foot-split { color: #c87010; font-weight: 600; }
</style>
