import { writable } from 'svelte/store';

export const stagingSlots = writable([]);

export function addToStaging(file) {
  stagingSlots.update(slots => [...slots, {
    id: crypto.randomUUID(),
    file,
    name: file.name.replace(/\.[^.]+$/, ''),
    normalize: false,
    dcOffset: false,
    highpassBoost: false,
    stereo: false,
    trimStart: 0,    // in Sekunden
    trimEnd: null,   // null = bis zum Ende
    duration: null,  // wird nach AudioContext-Analyse gesetzt
    waveformData: null, // Float32Array für die Anzeige
    status: 'pending', // pending | converting | done | error
  }]);
}

export function updateStagingSlot(id, changes) {
  stagingSlots.update(slots =>
    slots.map(s => s.id === id ? { ...s, ...changes } : s)
  );
}

export function removeStagingSlot(id) {
  stagingSlots.update(slots => slots.filter(s => s.id !== id));
}

export function clearStaging() {
  stagingSlots.set([]);
}