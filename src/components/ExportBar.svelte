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

  // ── Progress State ──
  let showProgress = false;
  let progressLabel = '';   // z.B. "Sample 3 / 8 — Encode…"
  let progressPct = 0;      // 0–100

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

  // ── ES-1 Export ──
  async function handleES1() {
    const s = get(slots);
    const active = s.filter(sl => sl.audioBuffer != null);
    if (!active.length) { message = 'Keine konvertierten Samples.'; return; }

    exporting = true;
    showProgress = true;
    progressPct = 0;
    message = '';

    try {
      await exportAsES1(
        s,
        'es1-samples.es1',
        ({ slot, totalSlots, frame, totalFrames, phase }) => {
          // Gesamt-Fortschritt: jeder Slot = 1 Einheit, aufgeteilt in Resample + Encode
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
        }
      );
      message = `✓ ${active.length} Sample(s) als .es1 exportiert.`;
    } catch (e) {
      message = `Error: ${e.message}`;
    }

    showProgress = false;
    exporting = false;
  }

  // ── ZIP Export ──
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

  // ── Directory Export ──
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
      const n1 = String(i).padStart(2,'0'), n2 = String(i+ROWS).padStart(2,'0'), n3 = String(i+ROWS*2).padStart(2,'0');
      return `<tr class="${i%2===0?'e':'o'}">
        <td class="n">${n1}</td><td class="nm">${c1?(c1.label||''):''}</td>
        <td class="n sep">${n2}</td><td class="nm">${c2?(c2.label||''):''}</td>
        <td class="n sep">${n3}</td><td class="nm">${c3?(c3.label||''):''}</td>
      </tr>`;
    }).join('');
    const now = new Date().toLocaleDateString('en-GB',{year:'numeric',month:'long',day:'numeric'});
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<title>ES-1 · ${cardName||'Sample List'}</title>
<style>
  @page{size:A5 landscape;margin:0}*{box-sizing:border-box;margin:0;padding:0}
  html,body{width:210mm;height:148mm;overflow:hidden;background:#fff}
  .page{width:210mm;height:148mm;padding:6mm 8mm 5mm;display:flex;flex-direction:column;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;color:#111}
  header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:.4pt solid #aaa;padding-bottom:1.5mm;margin-bottom:2mm;flex-shrink:0}
  .card-name{font-size:10.5pt;font-weight:bold}.meta{font-size:5.5pt;color:#777;text-align:right;line-height:1.5}
  .table-wrap{flex:1;overflow:hidden}table{width:100%;border-collapse:collapse}
  thead th{font-size:5pt;text-transform:uppercase;letter-spacing:.4px;color:#888;border-bottom:.4pt solid #ccc;padding:0 1.2mm .8mm;text-align:left}
  th.n,td.n{width:14pt}td{padding:.42mm 1.2mm;border-bottom:.2pt solid #eee}
  td.n{font-family:'Courier New',monospace;font-size:6pt;color:#999}td.nm{font-size:6.5pt}
  td.sep,th.sep{border-left:.5pt solid #ddd;padding-left:2.5mm}
  tr.e{background:#f7f7f7}tr.o{background:#fff}
  footer{flex-shrink:0;border-top:.4pt solid #ddd;padding-top:1.5mm;margin-top:1.5mm;display:flex;justify-content:space-between;align-items:flex-end}
  .notes-label{font-size:5pt;text-transform:uppercase;letter-spacing:.4px;color:#bbb;margin-bottom:.4mm}
  .notes-text{font-size:6pt;color:#444;line-height:1.4;white-space:pre-wrap;max-width:150mm}
  .generated{font-size:5pt;color:#ccc;text-align:right;white-space:nowrap}
</style></head><body><div class="page">
  <header><div class="card-name">ES-1 · ${cardName||'Unnamed Card'}</div>
    <div class="meta">Korg ES-1 · SmartMedia Sample List<br>${now}</div></header>
  <div class="table-wrap"><table>
    <thead><tr><th class="n">#</th><th>Sample Name</th><th class="n sep">#</th><th>Sample Name</th><th class="n sep">#</th><th>Sample Name</th></tr></thead>
    <tbody>${rows}</tbody></table></div>
  <footer><div><div class="notes-label">Notes</div><div class="notes-text">${cardNotes||''}</div></div>
    <div class="generated">Generated with ES-1 Sample Manager</div></footer>
</div><script>window.onload=()=>window.print();<\/script></body></html>`;
    const win = window.open('','_blank');
    win.document.write(html); win.document.close();
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
        <path d="M8 6V3h8v3"/><circle cx="12" cy="13" r="2" fill="currentColor" stroke="none"/>
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

  <!-- ── Progress Bar ── -->
  {#if showProgress}
    <div class="progress-wrap" role="progressbar" aria-valuenow={progressPct} aria-valuemin="0" aria-valuemax="100">
      <div class