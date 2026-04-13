<script>
  import { get }                     from 'svelte/store';
  import { slots }                   from '../lib/slotStore.js';
  import { exportAsZip }             from '../lib/zipExporter.js';
  import { writeToDirectory }        from '../lib/fileSystemWriter.js';
  import { exportAndDownloadES1 }    from '../lib/es1Exporter.js';

  const hasFileSystemAccess = 'showDirectoryPicker' in window;
  const isBrave             = typeof navigator.brave !== 'undefined';

  let busy        = false;
  let message     = '';
  let msgIsError  = false;
  let showProgress = false;
  let progressPct  = 0;
  let progressText = '';

  let showPrintModal = false;
  let cardName  = '';
  let cardNotes = '';

  function setMsg(text, isErr = false) {
    message = text; msgIsError = isErr;
    if (!isErr) setTimeout(() => { if (message === text) message = ''; }, 5000);
  }

  function setBusy(on, label = '') {
    busy = on; showProgress = on;
    if (!on) { progressPct = 0; progressText = ''; }
    else progressText = label;
  }

  function handleProgress({ phase, slot, total, pct }) {
    progressPct = pct;
    if (phase === 'decode')    progressText = `Decoding ${slot} / ${total}…`;
    else if (phase === 'encode') progressText = `Encoding ${slot} / ${total} — ${pct} %`;
    else if (phase === 'done') progressText = 'Done';
  }

  // ── Export .ES1 ──────────────────────────────────────────
  async function handleES1() {
    const s = get(slots);
    if (!s.filter(sl => sl?.blob instanceof Blob).length) {
      setMsg('No converted samples — convert first.', true); return;
    }
    setBusy(true, 'Preparing…');
    try {
      await exportAndDownloadES1(handleProgress);
      setMsg(`BACKUP.ES1 downloaded.`);
    } catch (e) {
      setMsg(e.message, true);
    }
    setBusy(false);
  }

  // ── ZIP ───────────────────────────────────────────────────
  async function handleZip() {
    const s = get(slots);
    if (!s.length) return;
    setBusy(true, 'Building ZIP…');
    try {
      await exportAsZip(s);
      setMsg(`ZIP downloaded (${s.length} sample${s.length > 1 ? 's' : ''}).`);
    } catch (e) {
      setMsg(e.message, true);
    }
    setBusy(false);
  }

  // ── Save to folder / card ────────────────────────────────
  async function handleDirectory(mode) {
    if (!hasFileSystemAccess) return;
    const s = get(slots);
    if (!s.length) return;
    setBusy(true, 'Choose folder…');
    try {
      const count = await writeToDirectory(s, (done, total) => {
        progressPct  = Math.round(done / total * 100);
        progressText = `${done} / ${total} files written…`;
      });
      setMsg(`${count} file${count > 1 ? 's' : ''} saved ${mode === 'card' ? 'to card' : 'to folder'}.`);
    } catch (e) {
      setMsg(e.name === 'AbortError' ? 'Cancelled.' : e.message, e.name !== 'AbortError');
    }
    setBusy(false);
  }

  // ── Print ────────────────────────────────────────────────
  function printSampleList() {
    const s = get(slots);
    const ROWS = 34;
    const rows = Array.from({ length: ROWS }, (_, i) => {
      const cells = [0, 1, 2].map(col => {
        const idx  = i + col * ROWS;
        const slot = s[idx];
        return { num: String(idx).padStart(2, '0'), name: slot?.label ?? '' };
      });
      return `<tr class="${i % 2 === 0 ? 'e' : 'o'}">${
        cells.map((c, ci) =>
          `<td class="n${ci > 0 ? ' sep' : ''}">${c.num}</td><td class="nm">${c.name}</td>`
        ).join('')
      }</tr>`;
    }).join('');

    const date = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>ES-1 · ${cardName || 'Sample List'}</title>
<style>
  @page{size:A5 landscape;margin:0}*{box-sizing:border-box;margin:0;padding:0}
  html,body{width:210mm;height:148mm;overflow:hidden;background:#fff;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#111}
  .page{width:210mm;height:148mm;padding:6mm 8mm 5mm;display:flex;flex-direction:column}
  header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:.4pt solid #aaa;padding-bottom:1.5mm;margin-bottom:2mm;flex-shrink:0}
  .title{font-size:10.5pt;font-weight:bold}.meta{font-size:5.5pt;color:#777;text-align:right;line-height:1.5}
  .wrap{flex:1;overflow:hidden}
  table{width:100%;border-collapse:collapse}
  thead th{font-size:5pt;text-transform:uppercase;letter-spacing:.4px;color:#888;border-bottom:.4pt solid #ccc;padding:0 1.2mm .8mm;text-align:left}
  td{padding:.42mm 1.2mm;border-bottom:.2pt solid #eee}
  td.n{font-family:'Courier New',monospace;font-size:6pt;color:#999;width:14pt}
  td.nm{font-size:6.5pt}
  td.sep,th.sep{border-left:.5pt solid #ddd;padding-left:2.5mm}
  tr.e{background:#f7f7f7}tr.o{background:#fff}
  footer{flex-shrink:0;border-top:.4pt solid #ddd;padding-top:1.5mm;margin-top:1.5mm;display:flex;justify-content:space-between;align-items:flex-end}
  .notes-label{font-size:5pt;text-transform:uppercase;letter-spacing:.4px;color:#bbb;margin-bottom:.4mm}
  .notes-text{font-size:6pt;color:#444;line-height:1.4;white-space:pre-wrap;max-width:150mm}
  .gen{font-size:5pt;color:#ccc;text-align:right}
</style></head><body><div class="page">
<header><div class="title">ES-1 · ${cardName || 'Unnamed Card'}</div><div class="meta">Korg ES-1 · SmartMedia Sample List<br>${date}</div></header>
<div class="wrap"><table>
<thead><tr><th class="n">#</th><th>Name</th><th class="n sep">#</th><th>Name</th><th class="n sep">#</th><th>Name</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<footer>
<div><div class="notes-label">Notes</div><div class="notes-text">${cardNotes}</div></div>
<div class="gen">ES-1 Sample Manager</div>
</footer></div><script>window.onload=()=>window.print();<\/script></body></html>`;

    const win = window.open('', '_blank');
    win.document.write(html);
    win.document.close();
    showPrintModal = false;
  }

  $: browserHint = (isBrave && !hasFileSystemAccess)
    ? 'Brave: enable File System Access API in brave://flags for direct card/folder export.'
    : !hasFileSystemAccess
      ? 'Save to Card / Folder requires Chrome or Edge 86+.'
      : '';
</script>

<div class="export-bar" role="region" aria-label="Export">

  <div class="export-header">
    <span class="section-label">EXPORT</span>
  </div>

  <div class="export-buttons">

    <!-- Primary: .ES1 backup file -->
    <button class="btn btn-es1" onclick={handleES1} disabled={busy} title="Build .ES1 backup file (ADPCM encoded)">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Export .ES1
    </button>

    <!-- Save to SmartMedia card -->
    <button
      class="btn btn-primary"
      onclick={() => handleDirectory('card')}
      disabled={busy || !hasFileSystemAccess}
      class:unavailable={!hasFileSystemAccess}
      title={hasFileSystemAccess ? 'Write WAVs to SmartMedia card root' : 'Requires Chrome / Edge 86+'}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <rect x="2" y="6" width="20" height="14" rx="2"/>
        <path d="M8 6V3h8v3"/>
        <circle cx="12" cy="13" r="2" fill="currentColor" stroke="none"/>
      </svg>
      Save to Card
    </button>

    <!-- Save to folder -->
    <button
      class="btn btn-secondary"
      onclick={() => handleDirectory('folder')}
      disabled={busy || !hasFileSystemAccess}
      class:unavailable={!hasFileSystemAccess}
      title={hasFileSystemAccess ? 'Save WAVs to any folder' : 'Requires Chrome / Edge 86+'}
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      Save to Folder
    </button>

    <!-- ZIP download -->
    <button class="btn btn-secondary" onclick={handleZip} disabled={busy}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/>
        <line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download ZIP
    </button>

    <!-- Print sample list -->
    <button class="btn btn-ghost" onclick={() => { if (get(slots).length) showPrintModal = true; }} disabled={busy}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <polyline points="6 9 6 2 18 2 18 9"/>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
        <rect x="6" y="14" width="12" height="8"/>
      </svg>
      Print List
    </button>

  </div>

  <!-- Progress bar -->
  {#if showProgress}
    <div class="progress-wrap" role="progressbar" aria-valuenow={progressPct} aria-valuemin="0" aria-valuemax="100">
      <div class="progress-header">
        <span class="progress-text">{progressText}</span>
        <span class="progress-pct">{progressPct} %</span>
      </div>
      <div class="progress-track">
        <div class="progress-fill" style="width: {progressPct}%"></div>
      </div>
    </div>
  {/if}

  <!-- Browser compatibility hint -->
  {#if browserHint}
    <p class="hint-row">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <circle cx="12" cy="16" r="0.5" fill="currentColor"/>
      </svg>
      {browserHint}
    </p>
  {/if}

  <!-- Feedback message -->
  {#if message}
    <p class="msg-row" class:msg-error={msgIsError} role="status">
      {message}
    </p>
  {/if}

</div>


<!-- ── Print modal ──────────────────────────────────────────── -->
{#if showPrintModal}
  <div
    class="backdrop"
    role="dialog"
    aria-modal="true"
    aria-label="Print sample list"
    onclick={() => showPrintModal = false}
  >
    <div class="modal" onclick={(e) => e.stopPropagation()}>
      <div class="modal-header">
        <div class="modal-title-row">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <polyline points="6 9 6 2 18 2 18 9"/>
            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
            <rect x="6" y="14" width="12" height="8"/>
          </svg>
          <h2 class="modal-title">Print Sample List</h2>
        </div>
        <button class="modal-close" onclick={() => showPrintModal = false} aria-label="Close">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="1" y1="1" x2="13" y2="13"/>
            <line x1="13" y1="1" x2="1" y2="13"/>
          </svg>
        </button>
      </div>

      <p class="modal-desc">
        Opens a print-ready A5 landscape sheet.
        Use <em>Save as PDF</em> in the browser print dialog.
      </p>

      <div class="modal-fields">
        <div class="field">
          <label class="field-label" for="print-card-name">Card / collection name</label>
          <input id="print-card-name" class="field-input" type="text"
                 bind:value={cardName} placeholder="e.g. Drums Vol. 1"
                 autofocus autocomplete="off" />
        </div>
        <div class="field">
          <label class="field-label" for="print-notes">
            Notes <span class="field-opt">(optional)</span>
          </label>
          <textarea id="print-notes" class="field-input field-textarea"
                    bind:value={cardNotes}
                    placeholder="e.g. All samples 32 kHz mono · kicks normalised"
                    rows="3"></textarea>
        </div>
      </div>

      <div class="modal-footer">
        <button class="modal-btn modal-cancel" onclick={() => showPrintModal = false}>Cancel</button>
        <button class="modal-btn modal-confirm" onclick={printSampleList}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true">
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
    margin-top: var(--sp8);
    padding-top: var(--sp6);
    border-top: 1px solid var(--b0);
    display: flex;
    flex-direction: column;
    gap: var(--sp3);
  }

  .export-header { margin-bottom: var(--sp1); }

  .export-buttons {
    display: flex;
    flex-wrap: wrap;
    gap: var(--sp2);
  }

  /* Shared button base */
  .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--sp2);
    padding: var(--sp2) var(--sp4);
    font-family: var(--mono);
    font-size: var(--ts);
    font-weight: 500;
    letter-spacing: 0.04em;
    border-radius: var(--r2);
    border: 1px solid transparent;
    white-space: nowrap;
    transition: background var(--tf2), border-color var(--tf2), color var(--tf2),
                box-shadow var(--tf2), transform var(--tf2);
  }
  .btn:active:not(:disabled) { transform: translateY(1px); }
  .btn:disabled               { opacity: 0.35; cursor: not-allowed; }
  .btn.unavailable            { opacity: 0.25; cursor: not-allowed; }

  /* .ES1 — amber, primary action */
  .btn-es1 {
    background: var(--amber);
    color: #1a0d00;
    border-color: var(--amber);
    box-shadow: 0 2px 8px rgba(224,122,0,0.28);
    font-weight: 700;
  }
  .btn-es1:hover:not(:disabled) {
    background: var(--amber-bright);
    border-color: var(--amber-bright);
    box-shadow: 0 3px 14px rgba(224,122,0,0.4);
    transform: translateY(-1px);
  }

  /* Save to Card — green */
  .btn-primary {
    background: var(--green);
    color: #091407;
    border-color: var(--green);
    box-shadow: 0 2px 8px rgba(90,191,60,0.22);
    font-weight: 600;
  }
  .btn-primary:hover:not(:disabled):not(.unavailable) {
    background: var(--green-bright);
    border-color: var(--green-bright);
    box-shadow: 0 3px 14px rgba(90,191,60,0.32);
    transform: translateY(-1px);
  }

  /* Secondary actions */
  .btn-secondary {
    background: var(--s2);
    color: var(--t);
    border-color: var(--b1);
  }
  .btn-secondary:hover:not(:disabled):not(.unavailable) {
    background: var(--s4);
    border-color: var(--b2);
    color: var(--tb);
  }

  /* Ghost */
  .btn-ghost {
    background: transparent;
    color: var(--tm);
    border-color: var(--b0);
  }
  .btn-ghost:hover:not(:disabled) {
    background: var(--s2);
    border-color: var(--b1);
    color: var(--t);
  }

  /* Progress */
  .progress-wrap {
    background: var(--s2);
    border: 1px solid var(--b1);
    border-radius: var(--r2);
    padding: var(--sp3) var(--sp4);
    display: flex;
    flex-direction: column;
    gap: var(--sp2);
  }
  .progress-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .progress-text, .progress-pct {
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tm);
    letter-spacing: 0.04em;
  }
  .progress-pct { min-width: 3.5ch; text-align: right; }
  .progress-track {
    height: 3px;
    background: var(--s4);
    border-radius: 99px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    background: var(--amber);
    border-radius: 99px;
    transition: width 100ms ease-out;
    min-width: 3px;
  }

  /* Hint / messages */
  .hint-row {
    display: flex;
    align-items: center;
    gap: 5px;
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tf);
    background: color-mix(in oklch, #664400 25%, var(--s2));
    border: 1px solid rgba(180,130,0,0.15);
    border-radius: var(--r2);
    padding: var(--sp2) var(--sp3);
  }
  .msg-row {
    font-family: var(--mono);
    font-size: var(--ts);
    color: var(--tg);
    padding: var(--sp1) 0;
    letter-spacing: 0.04em;
  }
  .msg-row.msg-error { color: var(--tr); }

  /* ── Modal ───────────────────────────────────────────────── */
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
    padding: var(--sp4);
  }
  .modal {
    background: var(--s2);
    border: 1px solid var(--b1);
    border-radius: var(--r4);
    padding: var(--sp6);
    width: 100%;
    max-width: 420px;
    box-shadow: 0 24px 64px rgba(0,0,0,0.65), 0 0 0 1px rgba(255,255,255,0.04);
    display: flex;
    flex-direction: column;
    gap: var(--sp4);
  }
  .modal-header  { display: flex; align-items: center; justify-content: space-between; }
  .modal-title-row { display: flex; align-items: center; gap: var(--sp2); color: var(--tb); }
  .modal-title   { font-size: var(--tl); font-weight: 600; color: var(--tb); }
  .modal-close {
    width: 26px; height: 26px;
    display: flex; align-items: center; justify-content: center;
    color: var(--tf);
    border-radius: var(--r1);
    transition: color var(--tf2), background var(--tf2);
  }
  .modal-close:hover { color: var(--t); background: var(--s4); }

  .modal-desc { font-size: var(--ts); color: var(--tm); line-height: 1.55; }
  .modal-desc em { font-style: normal; color: var(--t); font-weight: 500; }

  .modal-fields { display: flex; flex-direction: column; gap: var(--sp4); }
  .field { display: flex; flex-direction: column; gap: var(--sp2); }
  .field-label {
    font-family: var(--mono);
    font-size: var(--tx);
    font-weight: 600;
    color: var(--tm);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .field-opt { font-weight: 400; color: var(--tf); text-transform: none; letter-spacing: 0; }
  .field-input {
    background: var(--s1);
    border: 1px solid var(--b1);
    border-radius: var(--r2);
    padding: var(--sp3);
    font-size: var(--ts);
    color: var(--tb);
    width: 100%;
    transition: border-color var(--tf2);
  }
  .field-input::placeholder { color: var(--tf); }
  .field-input:focus { outline: none; border-color: var(--green-dim); }
  .field-textarea { resize: vertical; line-height: 1.5; min-height: 68px; font-family: var(--sans); }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: var(--sp2);
    padding-top: var(--sp2);
    border-top: 1px solid var(--b0);
  }
  .modal-btn {
    display: inline-flex;
    align-items: center;
    gap: var(--sp2);
    padding: var(--sp2) var(--sp4);
    font-family: var(--mono);
    font-size: var(--ts);
    font-weight: 500;
    border-radius: var(--r2);
    border: 1px solid transparent;
    transition: background var(--tf2), border-color var(--tf2), color var(--tf2), transform var(--tf2);
  }
  .modal-btn:active { transform: translateY(1px); }
  .modal-cancel {
    background: transparent;
    color: var(--tm);
    border-color: var(--b0);
  }
  .modal-cancel:hover { background: var(--s3); border-color: var(--b1); color: var(--t); }
  .modal-confirm {
    background: var(--green);
    color: #091407;
    border-color: var(--green);
    font-weight: 600;
    box-shadow: 0 2px 8px rgba(90,191,60,0.22);
  }
  .modal-confirm:hover {
    background: var(--green-bright);
    border-color: var(--green-bright);
    box-shadow: 0 3px 12px rgba(90,191,60,0.32);
    transform: translateY(-1px);
  }
</style>
