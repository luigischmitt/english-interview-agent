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
