import JSZip from 'jszip';

export async function exportAsZip(slots) {
  const zip = new JSZip();

  slots.forEach((slot, i) => {
    if (!slot.blob) return;
    const fileName = String(i).padStart(2, '0') + '.WAV';
    zip.file(fileName, slot.blob);
  });

  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'es1-samples.zip';
  a.click();
  URL.revokeObjectURL(url);
}
