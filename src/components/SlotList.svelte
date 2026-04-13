<script>
  import { slots, removeSlot, updateLabel, reorderSlots, clearSlots } from '../lib/slotStore.js';

  let dragFrom = null;
</script>

<section class="slot-section" aria-label="Sample slots">

  <div class="slot-header">
    <span class="section-label">SLOTS</span>
    {#if $slots.length > 0}
      <span class="slot-count">{$slots.length} / 100</span>
      <button class="btn-ghost" onclick={clearSlots}>Clear all</button>
    {/if}
  </div>

  {#if $slots.length === 0}
    <p class="empty-state">No samples loaded yet.</p>
  {:else}
    <ul class="slot-list" aria-label="Sample slot list">
      {#each $slots as slot, i}
        <li
          class="slot-row"
          class:drag-active={dragFrom === i}
          draggable="true"
          ondragstart={() => dragFrom = i}
          ondragover={(e) => e.preventDefault()}
          ondrop={() => { if (dragFrom !== null) { reorderSlots(dragFrom, i); dragFrom = null; } }}
          ondragend={() => dragFrom = null}
          aria-label={`Slot ${String(i).padStart(2,'0')}: ${slot.label || 'unnamed'}`}
        >
          <span class="drag-handle" aria-hidden="true">
            <svg width="8" height="12" viewBox="0 0 8 12" fill="currentColor">
              <circle cx="2" cy="2"  r="1.2"/>
              <circle cx="6" cy="2"  r="1.2"/>
              <circle cx="2" cy="6"  r="1.2"/>
              <circle cx="6" cy="6"  r="1.2"/>
              <circle cx="2" cy="10" r="1.2"/>
              <circle cx="6" cy="10" r="1.2"/>
            </svg>
          </span>

          <span class="slot-index">{String(i).padStart(2, '0')}</span>

          <input
            type="text"
            class="label-input"
            value={slot.label}
            oninput={(e) => updateLabel(i, e.target.value)}
            placeholder="Sample name"
            aria-label="Sample name for slot {i}"
          />

          <audio
            class="slot-audio"
            controls
            src={slot.audioUrl}
            preload="none"
            aria-label="Preview slot {i}"
          ></audio>

          <button
            class="remove-btn"
            onclick={() => removeSlot(i)}
            aria-label="Remove slot {i}"
            title="Remove"
          >
            <svg width="10" height="10" viewBox="0 0 14 14" fill="none"
                 stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <line x1="1" y1="1" x2="13" y2="13"/>
              <line x1="13" y1="1" x2="1" y2="13"/>
            </svg>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .slot-section {
    margin-top: var(--sp8);
  }

  .slot-header {
    display: flex;
    align-items: center;
    gap: var(--sp3);
    margin-bottom: var(--sp3);
  }

  .slot-count {
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tf);
    margin-left: auto;
  }

  .btn-ghost {
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tf);
    border: 1px solid var(--b0);
    border-radius: var(--r2);
    padding: 3px var(--sp3);
    background: transparent;
    transition: color var(--tf2), border-color var(--tf2), background var(--tf2);
  }
  .btn-ghost:hover {
    color: var(--t);
    border-color: var(--b1);
    background: var(--s3);
  }

  .empty-state {
    font-family: var(--mono);
    font-size: var(--ts);
    color: var(--tf);
    text-align: center;
    padding: var(--sp8) 0;
    letter-spacing: 0.04em;
  }

  .slot-list {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .slot-row {
    display: grid;
    grid-template-columns: 14px 28px 1fr auto auto;
    align-items: center;
    gap: var(--sp2);
    padding: 5px var(--sp3);
    background: var(--s2);
    border: 1px solid var(--b0);
    border-radius: var(--r2);
    cursor: grab;
    transition: border-color var(--tf2), background var(--tf2), opacity var(--tf2);
  }
  .slot-row:hover       { border-color: var(--b1); }
  .slot-row.drag-active { opacity: 0.35; border-color: var(--green-dim); }

  .drag-handle {
    color: var(--tf);
    opacity: 0.5;
    cursor: grab;
  }

  .slot-index {
    font-family: var(--mono);
    font-size: var(--tx);
    font-weight: 600;
    color: var(--tf);
    text-align: center;
    letter-spacing: 0.06em;
  }

  .label-input {
    background: transparent;
    border: none;
    border-radius: var(--r1);
    padding: 3px var(--sp2);
    font-size: var(--ts);
    color: var(--tb);
    width: 100%;
    transition: background var(--tf2);
  }
  .label-input::placeholder { color: var(--tf); }
  .label-input:focus { outline: none; background: var(--s1); }

  .slot-audio {
    height: 26px;
    min-width: 130px;
    accent-color: var(--green);
    border-radius: var(--r1);
    background: var(--s1);
  }

  .remove-btn {
    width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
    color: var(--tf);
    border-radius: var(--r1);
    transition: color var(--tf2), background var(--tf2);
  }
  .remove-btn:hover { color: var(--tr); background: rgba(217,64,64,0.1); }
</style>
