export const hasFileSystemAccess = 'showDirectoryPicker' in window;

export async function writeToDirectory(slots) {
  const dirHandle = await window.showDirectoryPicker({ mode: 'readwrite' });

  for (let i = 0; i < slots.length; i++) {
    const slot = slots[i];
    if (!slot.blob) continue;
    const fileName = String(i).padStart(2, '0') + '.WAV';
    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(slot.blob);
    await writable.close();
  }

  return slots.length;
}
