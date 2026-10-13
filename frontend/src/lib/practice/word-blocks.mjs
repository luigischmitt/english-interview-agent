const WORD = /[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*/gu;
const normalizeWords = (value) => value.toLowerCase().replace(/[’‘]/g, "'").match(WORD) ?? [];

/** Split a sentence into editable word blocks while preserving its exact original spelling and spacing. */
export function toBlocks(sentence) {
  const blocks = [];
  let match;
  WORD.lastIndex = 0;
  while ((match = WORD.exec(sentence))) {
    const start = match.index;
    const end = start + match[0].length;
    const next = new RegExp(WORD.source, "gu");
    next.lastIndex = end;
    const following = next.exec(sentence);
    const finish = following ? following.index : sentence.length;
    blocks.push({ id: blocks.length, text: match[0], trailing: sentence.slice(end, finish) });
  }
  return blocks;
}

/** Normalize edits and discard values that are equivalent to the source word. */
export function normalizeEdits(blocks, edits) {
  const normalized = {};
  const byId = new Map(blocks.map(({ id, text }) => [id, text]));
  for (const [rawId, rawValue] of Object.entries(edits)) {
    const id = Number(rawId);
    const value = String(rawValue).trim().replace(/\s+/gu, " ");
    const original = byId.get(id);
    if (original === undefined || value === original.trim().replace(/\s+/gu, " ")) continue;
    normalized[id] = value;
  }
  return normalized;
}

export function isOrderChanged(order, originalOrder = order.map((_, index) => index)) {
  return order.length !== originalOrder.length || order.some((id, index) => id !== originalOrder[index]);
}

/** Build row-aware insertion gaps from a static, DOM-order snapshot of chip rectangles. */
export function gapsFromRects(rects) {
  if (!rects.length) return [];
  const items = rects.map((rect, index) => ({ rect: { ...rect, right: rect.right ?? rect.left + rect.width, bottom: rect.bottom ?? rect.top + rect.height }, index }));
  const rows = [];
  for (const item of items) {
    let row = rows.find(({ items: rowItems }) => rowItems.some(({ rect }) => item.rect.top < rect.bottom && item.rect.bottom > rect.top));
    if (!row) { row = { top: item.rect.top, bottom: item.rect.bottom, items: [] }; rows.push(row); }
    row.top = Math.min(row.top, item.rect.top);
    row.bottom = Math.max(row.bottom, item.rect.bottom);
    row.items.push(item);
  }
  rows.sort((a, b) => a.top - b.top);
  const gaps = [];
  for (const row of rows) {
    row.items.sort((a, b) => a.rect.left - b.rect.left);
    const y = (row.top + row.bottom) / 2;
    const first = row.items[0];
    const last = row.items.at(-1);
    gaps.push({ index: first.index, x: first.rect.left, y });
    for (let index = 1; index < row.items.length; index += 1) {
      const previous = row.items[index - 1];
      const next = row.items[index];
      gaps.push({ index: next.index, x: (previous.rect.right + next.rect.left) / 2, y });
    }
    gaps.push({ index: last.index + 1, x: last.rect.right, y });
  }
  return gaps;
}

/** Find the closest gap, strongly preferring the row nearest the pointer vertically. */
export function nearestGap(gaps, x, y) {
  if (!gaps.length) return null;
  // Pick the row first (closest by vertical distance), then the closest gap inside that row.
  const rowY = [...new Set(gaps.map((gap) => gap.y))].reduce((best, value) => Math.abs(value - y) < Math.abs(best - y) ? value : best);
  return gaps.filter((gap) => gap.y === rowY).reduce((best, gap) => Math.abs(gap.x - x) < Math.abs(best.x - x) ? gap : best);
}

/** Convert a snapshot gap to insertion space after removing the dragged id. */
export function orderFromGap(order, draggedId, gapIndex) {
  const sourceIndex = order.indexOf(draggedId);
  if (sourceIndex < 0) return [...order];
  if (gapIndex === sourceIndex || gapIndex === sourceIndex + 1) return [...order];
  const next = order.filter((id) => id !== draggedId);
  const insertionIndex = order.slice(0, Math.max(0, Math.min(order.length, gapIndex))).filter((id) => id !== draggedId).length;
  next.splice(insertionIndex, 0, draggedId);
  return next;
}

/** Return the insertion slot after removing the dragged item, considering only the row under the pointer. */
export function insertionIndexFromRects(rects, x, y, draggedIndex = -1) {
  const items = rects.map((rect, index) => ({ rect: { ...rect, bottom: rect.bottom ?? rect.top + rect.height }, index })).filter(({ index }) => index !== draggedIndex);
  if (!items.length) return 0;
  const rows = [];
  for (const item of items) {
    let row = rows.find(({ items: rowItems }) => rowItems.some(({ rect }) => item.rect.top < rect.bottom && item.rect.bottom > rect.top));
    if (!row) { row = { top: item.rect.top, bottom: item.rect.bottom, items: [] }; rows.push(row); }
    row.top = Math.min(row.top, item.rect.top);
    row.bottom = Math.max(row.bottom, item.rect.bottom);
    row.items.push(item);
  }
  rows.sort((a, b) => a.top - b.top);
  if (y < rows[0].top) return 0;
  if (y > rows.at(-1).bottom) return items.length;
  const row = rows.find((item) => y >= item.top && y <= item.bottom)
    ?? rows.reduce((nearest, item) => {
      const distance = y < item.top ? item.top - y : y - item.bottom;
      const nearestDistance = y < nearest.top ? nearest.top - y : y - nearest.bottom;
      return distance < nearestDistance ? item : nearest;
    });
  row.items.sort((a, b) => a.rect.left - b.rect.left);
  // Slots are counted without the dragged chip, so map every rect index into that space.
  const ordered = items.slice().sort((a, b) => a.index - b.index);
  const slotOf = (rectIndex) => ordered.findIndex(({ index }) => index === rectIndex);
  const before = row.items.find(({ rect }) => x < rect.left + rect.width / 2);
  return before ? slotOf(before.index) : slotOf(row.items.at(-1).index) + 1;
}

/** Move an item to an insertion slot in the order with the item removed. */
export function reorder(order, draggedId, targetIndex) {
  const currentIndex = order.indexOf(draggedId);
  if (currentIndex < 0) return [...order];
  const next = order.filter((id) => id !== draggedId);
  next.splice(Math.max(0, Math.min(next.length, targetIndex)), 0, draggedId);
  return next;
}

/** Pure pointer interaction state for word dragging and click suppression. */
export function dragReducer(state, event) {
  const current = state ?? { order: [], dragging: null, placeholderIndex: null, openEditorFor: null, suppressClick: false };
  if (event.type === "pointerdown") return { ...current, openEditorFor: null, dragging: { id: event.id, x: event.x, y: event.y, startX: event.x, startY: event.y }, placeholderIndex: current.order.indexOf(event.id) };
  if (event.type === "move" && current.dragging) {
    const moved = current.dragging.moved || Math.hypot(event.x - current.dragging.startX, event.y - current.dragging.startY) > 4;
    return { ...current, dragging: { ...current.dragging, x: event.x, y: event.y, moved }, placeholderIndex: moved ? event.targetIndex : current.placeholderIndex };
  }
  if (event.type === "up" && current.dragging) {
    if (!current.dragging.moved) return { ...current, dragging: null, placeholderIndex: null, openEditorFor: current.dragging.id, suppressClick: false };
    const order = current.order.length ? reorder(current.order, current.dragging.id, current.placeholderIndex ?? current.order.indexOf(current.dragging.id)) : current.order;
    return { ...current, order, dragging: null, placeholderIndex: null, openEditorFor: null, suppressClick: true };
  }
  if (event.type === "cancel" && current.dragging) return { ...current, dragging: null, placeholderIndex: null, openEditorFor: null, suppressClick: false };
  if (event.type === "click") return current.suppressClick ? { ...current, suppressClick: false, openEditorFor: null } : current;
  return current;
}

/** Apply word edits, normalizing word spacing and retaining punctuation on edited blocks. */
export function applyEdits(blocks, edits, order = blocks.map(({ id }) => id)) {
  const output = [];
  const byId = new Map(blocks.map((block) => [block.id, block]));
  const finalBlockId = blocks.at(-1)?.id;
  const terminal = finalBlockId === undefined ? "" : (byId.get(finalBlockId).trailing.match(/\s*([.!?]+\s*)$/u)?.[1] ?? "").trim();
  for (const id of order) {
    const block = byId.get(id);
    if (!block) continue;
    const edited = Object.hasOwn(edits, block.id);
    const value = edited ? edits[block.id].trim() : block.text;
    const suffix = block.trailing.replace(/^\s+/, "").replace(id === finalBlockId ? /([.!?]+)\s*$/u : /$^/u, "");
    if (!value) {
      if (output.length && /[^\p{L}\p{N}'’]/u.test(suffix)) output[output.length - 1] += suffix;
      continue;
    }
    output.push(`${value}${suffix}`);
  }
  return `${output.join(" ")}${terminal}`.replace(/\s+([,.;:!?])/g, "$1").replace(/\s+/g, " ").trim();
}

function differingRegion(source, target) {
  const left = normalizeWords(source);
  const right = normalizeWords(target);
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start += 1;
  let leftEnd = left.length;
  let rightEnd = right.length;
  while (leftEnd > start && rightEnd > start && left[leftEnd - 1] === right[rightEnd - 1]) {
    leftEnd -= 1;
    rightEnd -= 1;
  }
  return { leftStart: start, leftEnd, rightStart: start, rightEnd };
}

export function mistakeRegion(exercise) {
  const diff = differingRegion(exercise.sentence, exercise.answer);
  const source = toBlocks(exercise.sentence);
  const target = toBlocks(exercise.answer);
  let sourceStart = diff.leftStart;
  let sourceEnd = diff.leftEnd;
  let targetStart = diff.rightStart;
  let targetEnd = diff.rightEnd;
  // An insertion has no source block to edit, so include its neighboring word as an anchor.
  if (sourceStart === sourceEnd && targetStart < targetEnd) {
    if (sourceStart < source.length) {
      sourceEnd += 1;
      targetEnd += 1;
    } else if (sourceStart > 0) {
      sourceStart -= 1;
      targetStart -= 1;
    }
  }
  return {
    blockIds: source.slice(sourceStart, sourceEnd).map(({ id }) => id),
    correct: target.slice(targetStart, targetEnd).map(({ text }) => text).join(" "),
    mistaken: source.slice(sourceStart, sourceEnd).map(({ text }) => text).join(" "),
  };
}

export function alternativesFor(exercise, lessons, random = Math.random) {
  const region = mistakeRegion(exercise);
  const normalizeChoice = (value) => value.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}'’]+/gu, " ").trim();
  const excluded = new Set([normalizeChoice(region.mistaken)]);
  if (Array.isArray(exercise.choices) && exercise.choices.length) {
    const values = [...new Set(exercise.choices.map((value) => String(value).trim()).filter((value) => (value || normalizeChoice(value) === normalizeChoice(region.correct)) && !excluded.has(normalizeChoice(value))))];
    for (let index = values.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.max(0, Math.min(0.999999999, Number(random()))) * (index + 1));
      [values[index], values[target]] = [values[target], values[index]];
    }
    return values.map((value) => ({ value, label: value || "remover a palavra" }));
  }
  const allLessons = lessons ?? [];
  const home = allLessons.find((item) => item.exercises?.some(({ id }) => id === exercise.id));
  const ruleExercises = allLessons.flatMap((item) => item.exercises ?? []).filter((item) => item.kind === "choose" && item.ruleId === exercise.ruleId);
  const candidates = ruleExercises.length ? ruleExercises.flatMap(({ options = [] }) => options) : (home?.exercises ?? []).filter((item) => item.kind === "choose").flatMap(({ options = [] }) => options);
  const correctWords = region.correct.trim() ? region.correct.trim().split(/\s+/u) : [];
  const mistakenWords = region.mistaken.trim() ? region.mistaken.trim().split(/\s+/u) : [];
  let sharedSuffix = 0;
  while (sharedSuffix < correctWords.length && sharedSuffix < mistakenWords.length
    && normalizeWords(correctWords.at(-1 - sharedSuffix))[0] === normalizeWords(mistakenWords.at(-1 - sharedSuffix))[0]) sharedSuffix += 1;
  const insertion = correctWords.length > mistakenWords.length && sharedSuffix > 0;
  const anchor = insertion ? correctWords.slice(-sharedSuffix).join(" ") : "";
  const expectedCount = insertion ? Math.max(1, correctWords.length - sharedSuffix) : correctWords.length;
  const singleWord = !insertion && (correctWords.length === 1 || mistakenWords.length === 1);
  const startsSentence = region.blockIds[0] === 0;
  const capitalize = (value) => startsSentence ? value.charAt(0).toLocaleUpperCase("en-US") + value.slice(1) : value;
  const normalize = (value) => value.toLocaleLowerCase("en-US");
  const placeholders = /\(|\)/u;
  const valid = candidates.map((raw) => String(raw).trim()).filter((candidate) => {
    if (!candidate || placeholders.test(candidate)) return false;
    const words = candidate.split(/\s+/u);
    return words.length === expectedCount && (!singleWord || words.length === 1);
  }).filter((candidate) => normalize(candidate) !== normalize(region.correct) && normalize(candidate) !== normalize(region.mistaken))
    .map((candidate) => capitalize(insertion ? `${candidate} ${anchor}` : candidate));
  const reserved = new Set([normalize(region.correct), normalize(region.mistaken)]);
  const distractors = [...new Map(valid.filter((value) => !reserved.has(normalize(value))).map((value) => [normalize(value), value])).values()];
  const values = [region.correct, ...distractors.slice(0, 2)];
  for (let index = values.length - 1; index > 0; index -= 1) {
    const raw = Number(random());
    const target = Math.floor(Math.max(0, Math.min(0.999999999, raw)) * (index + 1));
    [values[index], values[target]] = [values[target], values[index]];
  }
  return values.map((value) => ({ value, label: value || "remover a palavra" }));
}
