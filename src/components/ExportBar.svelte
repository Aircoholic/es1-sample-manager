<script>
  import { get } from 'svelte/store';
  import { slots } from '../lib/slotStore.js';
  import { exportAsZip } from '../lib/zipExporter.js';
  import { writeToDirectory } from '../lib/fileSystemWriter.js';
  import { exportAsES1 } from '../lib/es1Exporter.js';

  const isBrave = navigator.brave !== undefined;
  const hasFileSystemAccess = 'showDirectoryPicker' in window;

  let exporting = false;
  let message = '';

  let showProgress = false;
  let progressLabel = '';
  let progressPct = 0;

  let showPdfModal = false;
  let cardName = '';
  let cardNotes = '';

  function getBrowserHint() {
    if (isBrave && !hasFileSystemAccess)
      return 'Brave detected: enable "File System Access API" in brave://flags for card/folder export.';
    if (!hasFileSystemAccess)
      return 'Your browser does not support direct folder access. Use Brave (with API enabled) or Chrome.';
    return '';
  }

  async function handleES1() {
    const s = get(slots);
    const active = s.filter(sl => sl.audioBuffer != null);
    if (!active.length) { message = 'Keine konvertierten Samples.'; return; }
    exporting = true;
    showProgress = true;
    progressPct = 0;
    message = '';
    try {
      await exportAsES1(s, 'es1-samples.es1', ({ slot, totalSlots, frame, totalFrames, phase }) => {
        const slotBase  = slot / totalSlots;
        const slotShare = 1   / totalSlots;
        const framePct  = totalFrames > 0 ? frame / totalFrames : 0;
        if (phase === 'resample') {
          progressPct   = Math.round((slotBase + slotShare * 0.1) * 100);
          progressLabel = `Sample ${slot + 1} / ${totalSlots} — Resample…`;
        } else if (phase === 'encode') {
          progressPct   = Math.round((slotBase + slotShare * (0.1 + 0.9 * framePct)) * 100);
          progressLabel = `Sample ${slot + 1} / ${totalSlots} — Encode ${Math.round(framePct * 100)} %`;
        } else {
          progressPct   = 100;
          progressLabel = 'Fertig!';
        }
      });
      message = `✓ ${active.length} Sample(s) als .es1 exportiert.`;
    } catch (e) {
      message = `Error: ${e.message}`;
    }
    showProgress = false;
    exporting = false;
  }

  async function handleZip() {
    const s = get(slots);
    if (!s.length) return;
    exporting = true;
    showProgress = true;
    progressPct = 0;
    progressLabel = 'ZIP wird erstellt…';
    message = '';
    await exportAsZip(s);
    progressPct = 100;
    progressLabel = 'Fertig!';
    message = `✓ ZIP mit ${s.length} Sample(s) heruntergeladen.`;
    showProgress = false;
    exporting = false;
  }

  async function handleDirectory(mode) {
    if (!hasFileSystemAccess) return;
    const s = get(slots);
    if (!s.length) return;
    exporting = true;
    showProgress = true;
    progressPct = 0;
    progressLabel = 'Ordner auswählen…';
    message = '';
    try {
      const count = await writeToDirectory(s, (done, total) => {
        progressPct   = Math.round(done / total * 100);
        progressLabel = `${done} / ${total} Dateien gespeichert…`;
      });
      progressPct = 100;
      message = `✓ ${count} Sample(s) ${mode === 'card' ? 'auf SmartMedia-Karte' : 'im Ordner'} gespeichert.`;
    } catch (e) {
      message = e.name === 'AbortError' ? 'Abgebrochen.' : `Error: ${e.message}`;
    }
    showProgress = false;
    exporting = false;
  }

  function openPdfModal() {
    const s = get(slots);
    if (!s.length) return;
    showPdfModal = true;
  }

  function printSampleList() {
    const s = get(slots);
    const ROWS = 34;
    const rows = Array.from({ length: ROWS }, (_, i) => {
      const c1 = s[i], c2 = s[i + ROWS], c3 = s[i + ROWS * 2];
      const n1 = String(i).padStart(2,'0');
      const n2 = String(i + ROWS).padStart(2,'0');
      const n3 = String(i + ROWS * 2).padStart(2,'0');
      return `<tr class="${i % 2 === 0 ? 'e' : 'o'}">
        <td class="n">${n1}</td><td class="nm">${c1 ? (c1.label || '') : ''}</td>
        <td class="n sep">${n2}</td><td class="nm">${c2 ? (c2.label || '') : ''}</td>
        <td class="n sep">${n3}</td><td class="nm">${c3 ? (c3.label || '') : ''}</td>
      </tr>`;
    }).join('');
    const now = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>ES-1 · ${cardName || 'Sample List'}</title>
<style>
  @page { size: A5 landscape; margin: 0; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 210mm; height: 148mm; overflow: hidden; background: #fff; }
  .page { width: 210mm; height: 148mm; padding: 6mm 8mm 5mm; display: flex; flex-direction: column; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #111; }
  header { display: flex; justify-content: space-between; align-items: flex-end; border-bottom: .4pt solid #aaa; padding-bottom: 1.5mm; margin-bottom: 2mm; flex-shrink: 0; }
  .card-name { font-size: 10.5pt; font-weight: bold; }
  .meta { font-size: 5.5pt; color: #777; text-align: right; line-height: 1.5; }
  .table-wrap { flex: 1; overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  thead th { font-size: 5pt; text-transform: uppercase; letter-spacing: .4px; color: #888; border-bottom: .4pt solid #ccc; padding: 0 1.2mm .8mm; text-align: left; }
  th.n, td.n { width: 14pt; }
  td { padding: .42mm 1.2mm; border-bottom: .2pt solid #eee; }
  td.n { font-family: 'Courier New', monospace; font-size: 6pt; color: #999; }
  td.nm { font-size: 6.5pt; }
  td.sep, th.sep { border-left: .5pt solid #ddd; padding-left: 2.5mm; }
  tr.e { background: #f7f7f7; } tr.o { background: #fff; }
  footer { flex-shrink: 0; border-top: .4pt solid #ddd; padding-top: 1.5mm; margin-top: 1.5mm; display: flex; justify-content: space-between; align-items: flex-end; }
  .notes-label { font-size: 5pt; text-transform: uppercase; letter-spacing: .4px; color: #bbb; margin-bottom: .4mm; }
  .notes-text { font-size: 6pt; color: #444; line-height: 1.4; white-space: pre-wrap; max-width: 150mm; }
  .generated { font-size: 5pt; color: #ccc; text-align: right; white-space: nowrap; }
</style></head><body><div class="page">
  <header>
    <div class="card-name">ES-1 · ${cardName || 'Unnamed Card'}</div>
    <div class="meta">Korg ES-1 · SmartMedia Sample List<br>${now}</div>
  </header>
  <div class="table-wrap"><table>
    <thead><tr>
      <th class="n">#</th><th>Sample Name</th>
      <th class="n sep">#</th><th>Sample Name</th>
      <th class="n sep">#</th><th>Sample Name</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table></div>
  <footer>
    <div><div class="notes-label">Notes</div><div class="notes-text">${cardNotes || ''}</div></div>
    <div class="generated">Generated with ES-1 Sample Manager</div>
  </footer>
</div><script>window.onload = () => window.print();<\/script></body></html>`;
    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    showPdfModal = false;
  }

  $: browserHint = getBrowserHint();
</script>

<!-- ── Export Bar ── -->
<div class="export-bar">
  <div class="export-header">
    <span class="section-label">EXPORT</span>
  </div>

  <div class="export-buttons">

    <button
      class="export-btn btn-es1"
      onclick={handleES1}
      disabled={exporting}
      title="Erzeugt eine .es1-Datei zum Kopieren auf die SmartMedia-Karte"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="6" width="20" height="14" rx="2"/>
        <path d="M8 6V3h8v3"/>
        <circle cx="12" cy="13" r="2" fill="currentColor" stroke="none"/>
      </svg>
      Export .es1
    </button>

    <button
      class="export-btn btn-primary"
      onclick={() => handleDirectory('card')}
      disabled={exporting || !hasFileSystemAccess}
      class:unavailable={!hasFileSystemAccess}
      title={!hasFileSystemAccess ? 'Requires Chrome / Edge 86+' : 'Save directly to SmartMedia card root'}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="2" y="6" width="20" height="14" rx="2"/>
        <path d="M14 2H8v4h8V2h-2z"/>
        <rect x="8" y="10" width="2" height="4" rx="1" fill="currentColor" stroke="none"/>
        <rect x="12" y="10" width="2" height="4" rx="1" fill="currentColor" stroke="none"/>
      </svg>
      Save to Card
    </button>

    <button
      class="export-btn btn-secondary"
      onclick={() => handleDirectory('folder')}
      disabled={exporting || !hasFileSystemAccess}
      class:unavailable={!hasFileSystemAccess}
      title={!hasFileSystemAccess ? 'Requires Chrome / Edge 86+' : 'Save to any folder'}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      Save to Folder
    </button>

    <button
      class="export-btn btn-secondary"
      onclick={handleZip}
      disabled={exporting}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download ZIP
    </button>

    <button
      class="export-btn btn-ghost"
      onclick={openPdfModal}
      disabled={exporting}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 6 2 18 2 18 9"/>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
        <rect x="6" y="14" width="12" height="8"/>
      </svg>
      Print Sample List
    </button>

  </div>

  {#if showProgress}
    <div class="progress-wrap" role="progressbar" aria-valuenow={progressPct} aria-valuemin="0" aria-valuemax="100">
      <div class="progress-header">
        <span class="progress-label">{progressLabel}</span>
        <span class="progress-pct">{progressPct} %</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: {progressPct}%"></div>
      </div>
    </div>
  {/if}

  {#if browserHint}
    <p class="export-hint">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      {browserHint}
    </p>
  {/if}

  {#if message}
    <p class="export-message" class:msg-error={message.startsWith('Error')}>
      {message}
    </p>
  {/if}
</div>

{#if showPdfModal}
  <div class="modal-backdrop" onclick={() => showPdfModal = false} role="dialog" aria-modal="true" aria-label="Print Sample List">
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <div class="modal-title-row">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 6 2 18 2 18 9"/>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
          <h2 class="modal-title">Print Sample List</h2>
        </div>
        <button class="modal-close" onclick={() => showPdfModal = false} aria-label="Close">
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M1 1l12 12M13 1L1 13"/>
          </svg>
        </button>
      </div>
      <p class="modal-desc">Opens a print-ready A5 landscape sheet — use <em>Save as PDF</em> in the browser print dialog.</p>
      <div class="modal-fields">
        <div class="field">
          <label class="field-label" for="pdf-card-name">Card / Collection Name</label>
          <input id="pdf-card-name" class="field-input" type="text" bind:value={cardName} placeholder="e.g. Drums Vol. 1" autofocus autocomplete="off" />
        </div>
        <div class="field">
          <label class="field-label" for="pdf-notes">
            Notes <span class="field-optional">(optional)</span>
          </label>
          <textarea id="pdf-notes" class="field-input field-textarea" bind:value={cardNotes} placeholder="e.g. All samples at 44.1kHz · Kicks normalized" rows="3"></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="modal-btn modal-cancel" onclick={() => showPdfModal = false}>Cancel</button>
        <button class="modal-btn modal-print" onclick={printSampleList}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 6 2 18 2 18 9"/>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
          Open Print Dialog
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .export-bar {
    margin-top: var(--sp-8);
    padding-top: var(--sp-6);
    border-top: 1px solid var(--border-subtle);
    display: flex;
    flex-direction: column;
    gap: var(--sp-3);
  }
  .export-header { margin-bottom: var(--sp-1); }
  .section-label {
    font-family: var(--font-mono);
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-muted);
    letter-spacing: 0.1em;
  }
  .export-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp-2);
  }
  .export-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-4);
    font-size: var(--text-sm);
    font-weight: 500;
    border-radius: var(--r-md);
    border: 1px solid transparent;
    white-space: nowrap;
    transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast), box-shadow var(--t-fast), transform var(--t-fast);
  }
  .export-btn:active:not(:disabled) { transform: translateY(1px); }
  .export-btn:disabled { opacity: 0.38; cursor: not-allowed; }
  .export-btn.unavailable { opacity: 0.3; cursor: not-allowed; }

  .btn-es1 {
    background: var(--es-orange, #e06a00);
    color: #fff;
    border-color: var(--es-orange, #e06a00);
    box-shadow: 0 2px 8px rgba(224, 106, 0, 0.30);
    font-weight: 700;
  }
  .btn-es1:hover:not(:disabled) {
    background: #ff7a00;
    border-color: #ff7a00;
    box-shadow: 0 3px 12px rgba(224, 106, 0, 0.45);
    transform: translateY(-1px);
  }
  .btn-primary {
    background: var(--es-green);
    color: #0d1a09;
    border-color: var(--es-green);
    box-shadow: 0 2px 8px rgba(90, 191, 60, 0.25);
    font-weight: 600;
  }
  .btn-primary:hover:not(:disabled):not(.unavailable) {
    background: var(--es-green-bright);
    border-color: var(--es-green-bright);
    box-shadow: 0 3px 12px rgba(90, 191, 60, 0.35);
    transform: translateY(-1px);
  }
  .btn-secondary {
    background: var(--surface-2);
    color: var(--text);
    border-color: var(--border-default);
  }
  .btn-secondary:hover:not(:disabled):not(.unavailable) {
    background: var(--surface-3);
    border-color: var(--border-strong);
    color: var(--text-bright);
  }
  .btn-ghost {
    background: transparent;
    color: var(--text-muted);
    border-color: var(--border-subtle);
  }
  .btn-ghost:hover:not(:disabled) {
    background: var(--surface-2);
    border-color: var(--border-default);
    color: var(--text);
  }

  .progress-wrap {
    background: var(--surface-2);
    border: 1px solid var(--border-default);
    border-radius: var(--r-md);
    padding: var(--sp-3) var(--sp-4);
    display: flex;
    flex-direction: column;
    gap: var(--sp-2);
  }
  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .progress-label {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    color: var(--text-muted);
  }
  .progress-pct {
    font-size: var(--text-xs);
    font-family: var(--font-mono);
    color: var(--text-faint);
    min-width: 3ch;
    text-align: right;
  }
  .progress-track {
    width: 100%;
    height: 4px;
    background: var(--surface-4, var(--surface-3));
    border-radius: 9999px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--es-orange, #e06a00);
    border-radius: 9999px;
    transition: width 120ms ease-out;
    min-width: 4px;
  }

  .export-hint {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: var(--text-xs);
    color: var(--text-faint);
    background: color-mix(in oklch, #664400 30%, var(--surface-2));
    border: 1px solid rgba(180, 130, 0, 0.2);
    border-radius: var(--r-md);
    padding: var(--sp-2) var(--sp-3);
  }
  .export-message {
    font-size: var(--text-sm);
    color: var(--es-green);
    font-family: var(--font-mono);
    padding: var(--sp-1) 0;
  }
  .export-message.msg-error { color: var(--es-red); }

  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.65);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: var(--sp-4);
  }
  .modal {
    background: var(--surface-2);
    border: 1px solid var(--border-default);
    border-radius: var(--r-xl);
    padding: var(--sp-6);
    width: 100%;
    max-width: 420px;
    box-shadow: 0 24px 64px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.04);
    display: flex;
    flex-direction: column;
    gap: var(--sp-4);
  }
  .modal-header { display: flex; align-items: center; justify-content: space-between; }
  .modal-title-row { display: flex; align-items: center; gap: var(--sp-2); color: var(--text-bright); }
  .modal-title { font-size: var(--text-lg); font-weight: 600; color: var(--text-bright); }
  .modal-close {
    width: 28px;
    height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-faint);
    border-radius: var(--r-sm);
    transition: color var(--t-fast), background var(--t-fast);
  }
  .modal-close:hover { color: var(--text); background: var(--surface-4); }
  .modal-desc { font-size: var(--text-sm); color: var(--text-muted); line-height: 1.55; }
  .modal-desc em { font-style: normal; color: var(--text); font-weight: 500; }
  .modal-fields { display: flex; flex-direction: column; gap: var(--sp-4); }
  .field { display: flex; flex-direction: column; gap: var(--sp-2); }
  .field-label {
    font-size: var(--text-xs);
    font-weight: 600;
    color: var(--text-muted);
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .field-optional { font-weight: 400; color: var(--text-faint); text-transform: none; letter-spacing: 0; }
  .field-input {
    background: var(--surface-1);
    border: 1px solid var(--border-default);
    border-radius: var(--r-md);
    padding: var(--sp-3);
    font-size: var(--text-sm);
    color: var(--text-bright);
    transition: border-color var(--t-fast), background var(--t-fast);
    width: 100%;
  }
  .field-input::placeholder { color: var(--text-faint); }
  .field-input:focus { outline: none; border-color: var(--es-green-dim); background: var(--surface-2); }
  .field-textarea { resize: vertical; line-height: 1.5; min-height: 70px; font-family: var(--font-body); }
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp-2);
    padding-top: var(--sp-2);
    border-top: 1px solid var(--border-subtle);
  }
  .modal-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--sp-2);
    padding: var(--sp-2) var(--sp-4);
    font-size: var(--text-sm);
    font-weight: 500;
    border-radius: var(--r-md);
    border: 1px solid transparent;
    transition: background var(--t-fast), border-color var(--t-fast), color var(--t-fast), transform var(--t-fast);
  }
  .modal-btn:active { transform: translateY(1px); }
  .modal-cancel {
    background: transparent;
    color: var(--text-muted);
    border-color: var(--border-subtle);
  }
  .modal-cancel:hover { background: var(--surface-3); border-color: var(--border-default); color: var(--text); }
  .modal-print {
    background: var(--es-green);
    color: #0d1a09;
    border-color: var(--es-green);
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(90, 191, 60, 0.25);
  }
  .modal-print:hover {
    background: var(--es-green-bright);
    border-color: var(--es-green-bright);
    box-shadow: 0 3px 12px rgba(90, 191, 60, 0.35);
    transform: translateY(-1px);
  }
</style>
