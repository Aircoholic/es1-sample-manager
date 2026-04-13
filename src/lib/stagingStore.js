import { writable } from 'svelte/store';

/** @typedef {{ status: 'pending'|'converting'|'done'|'error' }} StagingSlot */

export const stagingSlots = writable(/** @type {StagingSlot[]} */ ([]));

export function addToStaging(file) {
  stagingSlots.update(s => [...s, {
    id:            crypto.randomUUID(),
    file,
    name:          file.name.replace(/\.[^.]+$/, ''),
    normalize:     false,
    dcOffset:      false,
    highpassBoost: false,
    stereo:        false,
    trimStart:     0,
    trimEnd:       null,     // null = full length
    duration:      null,     // set after analysis
    waveformData:  null,     // Float32Array peaks
    rawSamples:    null,     // full Float32Array for zero-crossing
    sampleRate:    null,
    status:        'pending',
  }]);
}

export function updateStagingSlot(id, changes) {
  stagingSlots.update(s =>
    s.map(slot => slot.id === id ? { ...slot, ...changes } : slot)
  );
}

export function removeStagingSlot(id) {
  stagingSlots.update(s => s.filter(slot => slot.id !== id));
}

export function clearStaging() {
  stagingSlots.set([]);
}

export function clearDoneSlots() {
  stagingSlots.update(s => s.filter(slot => slot.status !== 'done'));
}
