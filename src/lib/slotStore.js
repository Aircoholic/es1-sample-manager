import { writable } from 'svelte/store';

export const slots = writable([]);

export function addSlot(slot) {
  slots.update(s => [...s, slot]);
}

export function removeSlot(index) {
  slots.update(s => s.filter((_, i) => i !== index));
}

export function updateLabel(index, label) {
  slots.update(s =>
    s.map((slot, i) => i === index ? { ...slot, label } : slot)
  );
}

export function reorderSlots(from, to) {
  slots.update(s => {
    if (from === to || from < 0 || to < 0 || from >= s.length || to >= s.length) return s;
    const updated = [...s];
    const [moved] = updated.splice(from, 1);
    updated.splice(to, 0, moved);
    return updated;
  });
}

export function clearSlots() {
  slots.set([]);
}
