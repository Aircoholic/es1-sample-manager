<script>
  import { get }                      from 'svelte/store';
  import { slots }                    from '../lib/slotStore.js';
  import { exportAsZip }              from '../lib/zipExporter.js';
  import { writeToDirectory }         from '../lib/fileSystemWriter.js';
  import { exportAndDownloadES1,
           exportAllSplitES1 }        from '../lib/es1Exporter.js';
  import { measureSlots, packBackups } from '../lib/es1Capacity.js';
  import CapacityMeter                from './CapacityMeter.svelte';

  const hasFS    = 'showDirectoryPicker' in window;
  const isBrave  = typeof navigator.brave !== 'undefined';

  let busy        = false;
  let msg         = '';
  let msgErr      = false;
  let warning     = '';
  let showProg    = false;
  let progPct     = 0;
  let progText    = '';
  let showPrint   = false;
  let showName    = false;
  let cardName    = '';
  let cardNotes   = '';
  let exportName  = '';

  // Turn a user-entered name into a safe filename stem (letters, digits, -, _).
  function sanitizeName(name) {
    const cleaned = (name || '').trim()
      .replace(/[^\w\-]+/g, '_')   // non-word → underscore
      .replace(/_+/g, '_')          // collapse repeats
      .replace(/^_+|_+$/g, '');     // trim edges
    return cleaned || 'BACKUP';
  }

  function setMsg(text, isErr = false) {
    msg = text; msgErr = isErr;
    if (!isErr) setTimeout(() => { if (msg === text) msg = ''; }, 6000);
  }

  function startBusy(label = '') {
    busy = true; showProg = true; progPct = 0; progText = label; warning = '';
  }

  function endBusy() {
    busy = false; showProg = false;
  }

  function onProgress({ phase, slot, total, pct, warning: w, file, fileCount }) {
    if (w) warning = w;
    progPct = pct ?? progPct;
    const fileTag = (fileCount && fileCount > 1) ? `File ${file}/${fileCount} · ` : '';
    if (phase === 'check')         progText = 'Checking capacity…';
    else if (phase === 'file-start') progText = `${fileTag}Starting…`;
    else if (phase === 'decode')   progText = `${fileTag}Decoding ${slot} / ${total}…`;
    else if (phase === 'encode')   progText = `${fileTag}Encoding ${slot} / ${total} — ${pct} %`;
    else if (phase === 'download') progText = 'Saving…';
    else if (phase === 'done')     progText = `${slot} sample${slot!==1?'s':''} written.`;
  }

  function openSplitDialog() {
    const active = get(slots).filter(s => s?.blob instanceof Blob);
    if (!active.length) { setMsg('No converted samples — convert first.', true); return; }
    exportName = cardName || '';
    showName = true;
  }

  async function handleES1Split() {
    showName = false;
    const base = sanitizeName(exportName);
    startBusy('Preparing…');
    try {
      const { written, fileCount } = await exportAllSplitES1(onProgress, base);
      setMsg(fileCount > 1
        ? `${fileCount} backups downloaded (${written} samples total).`
        : `${base}.ES1 downloaded (${written} sample${written!==1?'s':''}).`);
    } catch (e) {
      setMsg(e.message, true);
    }
    endBusy();
  }

  async function handleES1() {
    const active = get(slots).filter(s => s?.blob instanceof Blob);
    if (!active.length) { setMsg('No converted samples — convert first.', true); return; }
    startBusy('Preparing…');
    try {
      await exportAndDownloadES1(onProgress);
      const n = get(slots).filter(s => s?.blob instanceof Blob).length;
      setMsg(`BACKUP.ES1 downloaded (${Math.min(n, 100)} slot${n!==1?'s':''}).`);
    } catch (e) {
      setMsg(e.message, true);
    }
    endBusy();
  }

  async function handleZip() {
    const s = get(slots);
    if (!s.length) return;
    startBusy('Building ZIP…');
    try {
      await exportAsZip(s);
      setMsg(`ZIP downloaded (${s.length} sample${s.length!==1?'s':''}).`);
    } catch (e) { setMsg(e.message, true); }
    endBusy();
  }

  async function handleDir(mode) {
    if (!hasFS) return;
    const s = get(slots);
    if (!s.length) return;
    startBusy('Choose folder…');
    try {
      const n = await writeToDirectory(s, (done, total) => {
        progPct  = Math.round(done/total*100);
        progText = `${done} / ${total} files…`;
      });
      setMsg(`${n} file${n!==1?'s':''} saved ${mode==='card'?'to card':'to folder'}.`);
    } catch (e) {
      setMsg(e.name === 'AbortError' ? 'Cancelled.' : e.message, e.name !== 'AbortError');
    }
    endBusy();
  }

  // Build the three-column table rows for one backup's slot labels.
  function buildRows(labels) {
    const ROWS = 34;
    return Array.from({ length: ROWS }, (_, i) => {
      const cells = [0, 1, 2].map(col => {
        const idx = i + col * ROWS;
        return { n: String(idx).padStart(2, '0'), nm: idx < labels.length ? labels[idx] : '' };
      });
      return `<tr class="${i % 2 === 0 ? 'e' : 'o'}">${cells.map((c, ci) =>
        `<td class="n${ci > 0 ? ' sep' : ''}">${escapeHtml(c.n)}</td><td class="nm">${escapeHtml(c.nm)}</td>`
      ).join('')}</tr>`;
    }).join('');
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  async function printList() {
    showPrint = false;
    const list = get(slots);

    // Use the SAME packing the .ES1 export uses, so the printed sheet matches
    // exactly what lands on each backup.
    const measured = await measureSlots(list);
    const backups  = measured.length ? packBackups(measured) : [{ slots: [] }];
    const multi    = backups.length > 1;

    const date  = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'long', day: 'numeric' });
    const baseName = cardName || 'Unnamed Card';

    const pages = backups.map((backup, bi) => {
      const labels = backup.slots.map(m => m.label ?? '');
      const rows   = buildRows(labels);
      const title  = multi ? `${baseName} · ${bi + 1}/${backups.length}` : baseName;
      const fileTag = multi
        ? `<br>${escapeHtml(sanitizeName(cardName))}_${bi + 1}.ES1`
        : '';
      return `<div class="page">
<header><div class="title">ES-1 · ${escapeHtml(title)}</div><div class="meta">Korg ES-1 · SmartMedia Sample List<br>${date}${fileTag}</div></header>
<div class="wrap"><table><thead><tr><th class="n">#</th><th>Name</th><th class="n sep">#</th><th>Name</th><th class="n sep">#</th><th>Name</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<footer><div><div class="nl">Notes</div><div class="nt">${escapeHtml(cardNotes)}</div></div><div class="gen">ES-1 Sample Manager</div></footer>
</div>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>ES-1 · ${escapeHtml(baseName)}</title>
<style>@page{size:A5 landscape;margin:0}*{box-sizing:border-box;margin:0;padding:0}
html,body{width:210mm;background:#fff;font-family:'Helvetica Neue',sans-serif;color:#111}
.page{width:210mm;height:148mm;overflow:hidden;padding:6mm 8mm 5mm;display:flex;flex-direction:column;page-break-after:always}
.page:last-child{page-break-after:auto}
header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:.4pt solid #aaa;padding-bottom:1.5mm;margin-bottom:2mm;flex-shrink:0}
.title{font-size:10.5pt;font-weight:bold}.meta{font-size:5.5pt;color:#777;text-align:right;line-height:1.5}
.wrap{flex:1;overflow:hidden}table{width:100%;border-collapse:collapse}
thead th{font-size:5pt;text-transform:uppercase;letter-spacing:.4px;color:#888;border-bottom:.4pt solid #ccc;padding:0 1.2mm .8mm;text-align:left}
td{padding:.42mm 1.2mm;border-bottom:.2pt solid #eee}
td.n{font-family:'Courier New',monospace;font-size:6pt;color:#999;width:14pt}td.nm{font-size:6.5pt}
td.sep,th.sep{border-left:.5pt solid #ddd;padding-left:2.5mm}
tr.e{background:#f7f7f7}tr.o{background:#fff}
footer{flex-shrink:0;border-top:.4pt solid #ddd;padding-top:1.5mm;margin-top:1.5mm;display:flex;justify-content:space-between;align-items:flex-end}
.nl{font-size:5pt;text-transform:uppercase;letter-spacing:.4px;color:#bbb;margin-bottom:.4mm}
.nt{font-size:6pt;color:#444;line-height:1.4;white-space:pre-wrap;max-width:150mm}
.gen{font-size:5pt;color:#ccc;text-align:right}
</style></head><body>${pages}<script>window.onload=()=>window.print();<\/script></body></html>`;
    const win = window.open('', '_blank');
    win.document.write(html); win.document.close();
  }

  $: hint = (isBrave && !hasFS)
    ? 'Brave: enable File System Access API in brave://flags for card/folder export.'
    : !hasFS ? 'Save to Card / Folder requires Chrome or Edge 86+.' : '';
</script>

<div class="bar">
  <div class="bar-hdr"><span class="section-label">EXPORT</span></div>

  <CapacityMeter />

  <div class="btns">
    <button class="btn es1-btn" onclick={handleES1} disabled={busy}
            title="Build one .ES1 backup file (fills up to ~98 s of audio)">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Export .ES1
    </button>

    <button class="btn es1-split-btn" onclick={openSplitDialog} disabled={busy}
            title="Export every sample, split across as many .ES1 backups as needed">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
        <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
      </svg>
      Export All (split)
    </button>

    <button class="btn green-btn" onclick={()=>handleDir('card')}
            disabled={busy||!hasFS} class:dim={!hasFS}
            title={hasFS?'Write WAVs to SmartMedia card root':'Requires Chrome / Edge 86+'}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <rect x="2" y="6" width="20" height="14" rx="2"/><path d="M8 6V3h8v3"/>
        <circle cx="12" cy="13" r="2" fill="currentColor" stroke="none"/>
      </svg>
      Save to Card
    </button>

    <button class="btn mid-btn" onclick={()=>handleDir('folder')}
            disabled={busy||!hasFS} class:dim={!hasFS}
            title={hasFS?'Save WAVs to any folder':'Requires Chrome / Edge 86+'}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
      </svg>
      Save to Folder
    </button>

    <button class="btn mid-btn" onclick={handleZip} disabled={busy}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Download ZIP
    </button>

    <button class="btn ghost-btn" onclick={()=>{if(get(slots).length)showPrint=true;}} disabled={busy}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <polyline points="6 9 6 2 18 2 18 9"/>
        <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/>
        <rect x="6" y="14" width="12" height="8"/>
      </svg>
      Print List
    </button>
  </div>

  {#if showProg}
    <div class="prog" role="progressbar" aria-valuenow={progPct} aria-valuemin="0" aria-valuemax="100">
      <div class="prog-hdr">
        <span class="prog-text">{progText}</span>
        <span class="prog-pct">{progPct} %</span>
      </div>
      <div class="prog-track"><div class="prog-fill" style="width:{progPct}%"></div></div>
    </div>
  {/if}

  {#if warning}
    <div class="warn-row">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>
      {warning}
    </div>
  {/if}

  {#if hint}
    <p class="hint-row">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/>
        <circle cx="12" cy="16" r="0.5" fill="currentColor"/>
      </svg>
      {hint}
    </p>
  {/if}

  {#if msg}
    <p class="msg" class:msg-err={msgErr} role="status">{msg}</p>
  {/if}
</div>

{#if showPrint}
  <div class="backdrop" role="dialog" aria-modal="true" onclick={()=>showPrint=false}>
    <div class="modal" onclick={(e)=>e.stopPropagation()}>
      <div class="modal-hdr">
        <h2 class="modal-title">Print Sample List</h2>
        <button class="modal-x" onclick={()=>showPrint=false} aria-label="Close">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/>
          </svg>
        </button>
      </div>
      <p class="modal-desc">Opens a print-ready A5 landscape sheet. Use <em>Save as PDF</em> in the browser print dialog.</p>
      <div class="fields">
        <div class="field">
          <label class="flabel" for="pcn">Card / collection name</label>
          <input id="pcn" class="finput" type="text" bind:value={cardName}
                 placeholder="e.g. Drums Vol. 1" autofocus autocomplete="off"/>
        </div>
        <div class="field">
          <label class="flabel" for="pnotes">Notes <span class="fopt">(optional)</span></label>
          <textarea id="pnotes" class="finput ftarea" bind:value={cardNotes}
                    placeholder="e.g. All samples 32 kHz mono" rows="3"></textarea>
        </div>
      </div>
      <div class="modal-foot">
        <button class="mbtn mcancel" onclick={()=>showPrint=false}>Cancel</button>
        <button class="mbtn mconfirm" onclick={printList}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round">
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

{#if showName}
  <div class="backdrop" role="dialog" aria-modal="true" onclick={()=>showName=false}>
    <div class="modal" onclick={(e)=>e.stopPropagation()}>
      <div class="modal-hdr">
        <h2 class="modal-title">Export All Samples</h2>
        <button class="modal-x" onclick={()=>showName=false} aria-label="Close">
          <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="1" y1="1" x2="13" y2="13"/><line x1="13" y1="1" x2="1" y2="13"/>
          </svg>
        </button>
      </div>
      <p class="modal-desc">Splits all converted samples across as many <em>.ES1</em> backups as needed (~98 s of audio each). Files are numbered <em>NAME_1.ES1</em>, <em>NAME_2.ES1</em>, … when more than one is required.</p>
      <div class="fields">
        <div class="field">
          <label class="flabel" for="exn">Backup name</label>
          <input id="exn" class="finput" type="text" bind:value={exportName}
                 placeholder="e.g. Drums Vol 1" autofocus autocomplete="off"
                 onkeydown={(e)=>{if(e.key==='Enter')handleES1Split();}}/>
        </div>
      </div>
      <div class="modal-foot">
        <button class="mbtn mcancel" onclick={()=>showName=false}>Cancel</button>
        <button class="mbtn mconfirm" onclick={handleES1Split}>
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/>
            <rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>
          </svg>
          Export
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .bar {
    margin-top: var(--sp8);
    padding-top: var(--sp6);
    border-top: 1px solid var(--b0);
    display: flex;
    flex-direction: column;
    gap: var(--sp3);
  }
  .bar-hdr { margin-bottom: var(--sp1); }

  .btns { display: flex; flex-wrap: wrap; gap: var(--sp2); }

  .btn {
    display: inline-flex;
    align-items: center;
    gap: var(--sp2);
    padding: 7px var(--sp4);
    font-family: var(--mono);
    font-size: var(--ts);
    font-weight: 500;
    letter-spacing: 0.04em;
    border-radius: var(--r2);
    border: 1px solid transparent;
    white-space: nowrap;
    transition: background var(--tf2), border-color var(--tf2), color var(--tf2), transform var(--tf2);
  }
  .btn:active:not(:disabled) { transform: translateY(1px); }
  .btn:disabled               { opacity: 0.35; cursor: not-allowed; }
  .btn.dim                    { opacity: 0.22; cursor: not-allowed; }

  /* .ES1 — amber, primary action */
  .es1-btn {
    background: var(--a);
    color: #180d01;
    border-color: var(--a);
    font-weight: 700;
  }
  .es1-btn:hover:not(:disabled) {
    background: #f08820;
    border-color: #f08820;
    transform: translateY(-1px);
  }

  /* .ES1 split — amber outline, secondary to the primary export */
  .es1-split-btn {
    background: rgba(224,122,26,0.10);
    color: var(--a);
    border-color: rgba(224,122,26,0.45);
    font-weight: 600;
  }
  .es1-split-btn:hover:not(:disabled) {
    background: rgba(224,122,26,0.18);
    border-color: var(--a);
    transform: translateY(-1px);
  }

  /* Save to Card — green */
  .green-btn {
    background: var(--g);
    color: #061209;
    border-color: var(--g);
    font-weight: 600;
  }
  .green-btn:hover:not(:disabled):not(.dim) {
    background: #52e870;
    border-color: #52e870;
    transform: translateY(-1px);
  }

  /* Secondary */
  .mid-btn {
    background: var(--s3);
    color: var(--t);
    border-color: var(--b1);
  }
  .mid-btn:hover:not(:disabled):not(.dim) {
    background: var(--s4);
    border-color: var(--b2);
    color: var(--tb);
  }

  /* Ghost */
  .ghost-btn {
    background: transparent;
    color: var(--tm);
    border-color: var(--b0);
  }
  .ghost-btn:hover:not(:disabled) {
    background: var(--s2);
    border-color: var(--b1);
    color: var(--t);
  }

  /* Progress */
  .prog {
    background: var(--s2);
    border: 1px solid var(--b1);
    border-radius: var(--r2);
    padding: var(--sp3) var(--sp4);
    display: flex;
    flex-direction: column;
    gap: var(--sp2);
  }
  .prog-hdr { display: flex; justify-content: space-between; align-items: center; }
  .prog-text, .prog-pct { font-family: var(--mono); font-size: var(--tx); color: var(--tm); letter-spacing: 0.04em; }
  .prog-pct { min-width: 3.5ch; text-align: right; }
  .prog-track { height: 3px; background: var(--s4); border-radius: 99px; overflow: hidden; }
  .prog-fill  { height: 100%; background: var(--a); border-radius: 99px; transition: width 80ms ease-out; min-width: 3px; }

  /* Warning */
  .warn-row {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-family: var(--mono);
    font-size: var(--tx);
    color: #c87010;
    background: rgba(224,122,26,0.08);
    border: 1px solid rgba(224,122,26,0.2);
    border-radius: var(--r2);
    padding: var(--sp2) var(--sp3);
    line-height: 1.55;
  }
  .warn-row svg { flex-shrink: 0; margin-top: 1px; }

  /* Hint */
  .hint-row {
    display: flex;
    align-items: center;
    gap: 5px;
    font-family: var(--mono);
    font-size: var(--tx);
    color: var(--tf);
    padding: var(--sp1) 0;
  }

  /* Message */
  .msg { font-family: var(--mono); font-size: var(--ts); color: var(--g); padding: var(--sp1) 0; letter-spacing: 0.04em; }
  .msg.msg-err { color: var(--r); }

  /* Modal */
  .backdrop {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.72);
    backdrop-filter: blur(3px);
    display: flex; align-items: center; justify-content: center;
    z-index: 100; padding: var(--sp4);
  }
  .modal {
    background: var(--s2);
    border: 1px solid var(--b2);
    border-radius: var(--r4);
    padding: var(--sp6);
    width: 100%; max-width: 420px;
    display: flex; flex-direction: column; gap: var(--sp4);
  }
  .modal-hdr { display: flex; align-items: center; justify-content: space-between; }
  .modal-title { font-size: var(--tl); font-weight: 500; color: var(--tb); }
  .modal-x {
    width: 26px; height: 26px;
    display: flex; align-items: center; justify-content: center;
    color: var(--tf); border-radius: var(--r1);
    transition: color var(--tf2), background var(--tf2);
  }
  .modal-x:hover { color: var(--t); background: var(--s4); }
  .modal-desc { font-size: var(--ts); color: var(--tm); line-height: 1.55; }
  .modal-desc em { font-style: normal; color: var(--t); font-weight: 500; }
  .fields { display: flex; flex-direction: column; gap: var(--sp4); }
  .field  { display: flex; flex-direction: column; gap: var(--sp2); }
  .flabel {
    font-family: var(--mono);
    font-size: var(--tx);
    font-weight: 600;
    color: var(--tm);
    letter-spacing: 0.1em;
    text-transform: uppercase;
  }
  .fopt { font-weight: 400; color: var(--tf); text-transform: none; letter-spacing: 0; }
  .finput {
    background: var(--s1); border: 1px solid var(--b1);
    border-radius: var(--r2); padding: var(--sp3);
    font-size: var(--ts); color: var(--tb); width: 100%;
    transition: border-color var(--tf2);
  }
  .finput::placeholder { color: var(--tf); }
  .finput:focus { outline: none; border-color: var(--gd); }
  .ftarea { resize: vertical; min-height: 68px; line-height: 1.5; font-family: var(--sans); }
  .modal-foot {
    display: flex; justify-content: flex-end; gap: var(--sp2);
    padding-top: var(--sp2); border-top: 1px solid var(--b0);
  }
  .mbtn {
    display: inline-flex; align-items: center; gap: var(--sp2);
    padding: 7px var(--sp4);
    font-family: var(--mono); font-size: var(--ts); font-weight: 500;
    border-radius: var(--r2); border: 1px solid transparent;
    transition: background var(--tf2), border-color var(--tf2), color var(--tf2), transform var(--tf2);
  }
  .mbtn:active { transform: translateY(1px); }
  .mcancel { background: transparent; color: var(--tm); border-color: var(--b0); }
  .mcancel:hover { background: var(--s3); border-color: var(--b1); color: var(--t); }
  .mconfirm { background: var(--g); color: #061209; border-color: var(--g); font-weight: 600; }
  .mconfirm:hover { background: #52e870; border-color: #52e870; transform: translateY(-1px); }
</style>
