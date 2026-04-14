<script>
  import { get }                      from 'svelte/store';
  import { slots }                    from '../lib/slotStore.js';
  import { exportAsZip }              from '../lib/zipExporter.js';
  import { writeToDirectory }         from '../lib/fileSystemWriter.js';
  import { exportAndDownloadES1 }     from '../lib/es1Exporter.js';

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
  let cardName    = '';
  let cardNotes   = '';

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

  function onProgress({ phase, slot, total, pct, warning: w }) {
    if (w) warning = w;
    progPct = pct ?? progPct;
    if (phase === 'check')    progText = 'Checking capacity…';
    else if (phase === 'decode') progText = `Decoding ${slot} / ${total}…`;
    else if (phase === 'encode') progText = `Encoding ${slot} / ${total} — ${pct} %`;
    else if (phase === 'done')   progText = `${slot} sample${slot!==1?'s':''} written.`;
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

  function printList() {
    const s = get(slots);
    const ROWS = 34;
    const rows = Array.from({length:ROWS}, (_,i) => {
      const cells = [0,1,2].map(col => {
        const idx = i + col*ROWS;
        return { n: String(idx).padStart(2,'0'), nm: s[idx]?.label ?? '' };
      });
      return `<tr class="${i%2===0?'e':'o'}">${cells.map((c,ci)=>
        `<td class="n${ci>0?' sep':''}">${c.n}</td><td class="nm">${c.nm}</td>`
      ).join('')}</tr>`;
    }).join('');
    const date = new Date().toLocaleDateString('en-GB',{year:'numeric',month:'long',day:'numeric'});
    const html = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>ES-1 · ${cardName||'Sample List'}</title>
<style>@page{size:A5 landscape;margin:0}*{box-sizing:border-box;margin:0;padding:0}
html,body{width:210mm;height:148mm;overflow:hidden;background:#fff;font-family:'Helvetica Neue',sans-serif;color:#111}
.page{width:210mm;height:148mm;padding:6mm 8mm 5mm;display:flex;flex-direction:column}
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
</style></head><body><div class="page">
<header><div class="title">ES-1 · ${cardName||'Unnamed Card'}</div><div class="meta">Korg ES-1 · SmartMedia Sample List<br>${date}</div></header>
<div class="wrap"><table><thead><tr><th class="n">#</th><th>Name</th><th class="n sep">#</th><th>Name</th><th class="n sep">#</th><th>Name</th></tr></thead>
<tbody>${rows}</tbody></table></div>
<footer><div><div class="nl">Notes</div><div class="nt">${cardNotes}</div></div><div class="gen">ES-1 Sample Manager</div></footer>
</div><script>window.onload=()=>window.print();<\/script></body></html>`;
    const win = window.open('','_blank');
    win.document.write(html); win.document.close();
    showPrint = false;
  }

  $: hint = (isBrave && !hasFS)
    ? 'Brave: enable File System Access API in brave://flags for card/folder export.'
    : !hasFS ? 'Save to Card / Folder requires Chrome or Edge 86+.' : '';
</script>

<div class="bar">
  <div class="bar-hdr"><span class="section-label">EXPORT</span></div>

  <div class="btns">
    <button class="btn es1-btn" onclick={handleES1} disabled={busy}
            title="Build .ES1 backup file (ADPCM encoded — copy to SmartMedia card)">
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>
      </svg>
      Export .ES1
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
