<script>
  import { slots, removeSlot, updateLabel, reorderSlots } from '../lib/slotStore.js';
  let dragFrom = null;
</script>

{#if $slots.length === 0}
  <p class="empty">No samples loaded yet.</p>
{:else}
  <ul>
    {#each $slots as slot, i}
      <li
        draggable="true"
        ondragstart={() => dragFrom = i}
        ondragover={(e) => e.preventDefault()}
        ondrop={() => { reorderSlots(dragFrom, i); dragFrom = null; }}
        class:dragging={dragFrom === i}
      >
        <span class="index">{String(i).padStart(2, '0')}</span>
        <input
          type="text"
          value={slot.label}
          oninput={(e) => updateLabel(i, e.target.value)}
          placeholder="Sample name…"
        />
        <audio controls src={slot.audioUrl}></audio>
        <button class="remove" onclick={() => removeSlot(i)}>✕</button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .empty {
    font-size: var(--text-sm);
    color: var(--text-faint);
    text-align: center;
    padding: var(--sp-8) 0;
    font-family: var(--font-mono);
  }

  ul {
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }

  li {
    display: grid;
    grid-template-columns: 32px 1fr auto auto;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-3);
    background: var(--surface-2);
    border: 1px solid var(--border-subtle);
    border-radius: var(--r-md);
    transition: border-color var(--t-fast), background var(--t-fast);
    cursor: grab;
  }

  li:hover { border-color: var(--border-default); }
  li.dragging { opacity: 0.4; border-color: var(--es-green-dim); background: var(--surface-3); }

  .index {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-faint);
    text-align: center;
    letter-spacing: 0.04em;
  }

  input[type="text"] {
    background: transparent;
    border: none;
    border-radius: var(--r-sm);
    padding: 3px var(--sp-2);
    font-size: var(--text-sm);
    color: var(--text-bright);
    width: 100%;
    transition: background var(--t-fast);
  }

  input[type="text"]::placeholder { color: var(--text-faint); }
  input[type="text"]:focus {
    outline: none;
    background: var(--surface-1);
  }

  audio {
    height: 28px;
    min-width: 140px;
    accent-color: var(--es-green);
    border-radius: var(--r-sm);
    background: var(--surface-1);
  }

  .remove {
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 11px;
    color: var(--text-faint);
    border-radius: var(--r-sm);
    transition: color var(--t-fast), background var(--t-fast);
  }

  .remove:hover {
    color: var(--es-red);
    background: var(--es-red-glow);
  }
</style>