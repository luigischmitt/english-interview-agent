const replacements = [
  [/\bI'm\b/gi, "i am"],
  [/\bdon't\b/gi, "do not"],
  [/\bit's\b/gi, "it is"],
  [/\bI've\b/gi, "i have"],
  [/\bwe're\b/gi, "we are"],
  [/\bdidn't\b/gi, "did not"],
  [/\bdoesn't\b/gi, "does not"],
  [/\bhaven't\b/gi, "have not"],
  [/\bcan't\b/gi, "cannot"],
  [/\bwon't\b/gi, "will not"],
];

function normalize(value) {
  let normalized = value.toLowerCase().replace(/[’‘]/g, "'");
  for (const [pattern, replacement] of replacements) normalized = normalized.replace(pattern, replacement);
  return normalized.replace(/[\p{P}]/gu, " ").replace(/\s+/g, " ").trim();
}

function tokens(value) {
  return normalize(value).split(" ").filter(Boolean);
}

/** Grade a practice answer locally without making an AI request. */
export function gradeLocally(exercise, answer) {
  const corrected = exercise.kind === "choose" ? exercise.sentence.replace("___", exercise.answer) : exercise.answer;
  if (exercise.kind === "choose") {
    const correct = answer.trim() === exercise.answer;
    return { verdict: correct ? "correct" : "incorrect", corrected, feedback: correct ? "correct" : "incorrect" };
  }

  const accepted = [exercise.answer, ...(exercise.accepted ?? [])];
  if (accepted.some((candidate) => normalize(candidate) === normalize(answer))) {
    return { verdict: "correct", corrected, feedback: "correct" };
  }

  const source = tokens(exercise.sentence);
  const target = tokens(exercise.answer);
  let start = 0;
  while (start < source.length && start < target.length && source[start] === target[start]) start += 1;
  const region = diffRegion(source, target, start);
  const fixed = target.slice(start, region.endTarget + 1);
  const submitted = tokens(answer);
  let matches = false;
  for (let index = 0; index <= submitted.length - fixed.length; index += 1) {
    if (fixed.length && fixed.every((word, offset) => submitted[index + offset] === word)) matches = true;
  }
  const verdict = matches ? "almost" : "incorrect";
  return { verdict, corrected, feedback: verdict };
}

function diffRegion(source, target, start) {
  let endTarget = target.length - 1;
  let sourceIndex = source.length - 1;
  while (sourceIndex >= start && endTarget >= start && source[sourceIndex] === target[endTarget]) {
    sourceIndex -= 1;
    endTarget -= 1;
  }
  return { endTarget };
}

function weightedOrder(items, weights, random) {
  return items
    .map((item) => ({ item, score: Math.pow(Math.max(random(), 1e-12), 1 / Math.max(1, weights[item.ruleId] ?? 1)) }))
    .sort((a, b) => b.score - a.score)
    .map(({ item }) => item);
}

function pick(pool, size, weights, missed, recent, random, allowReuse = false) {
  const ordered = weightedOrder(pool, weights ?? {}, random);
  const miss = new Set(missed ?? []);
  const recentSet = new Set(recent ?? []);
  const preferred = ordered.filter((item) => miss.has(item.id));
  const fresh = ordered.filter((item) => !miss.has(item.id) && !recentSet.has(item.id));
  const old = ordered.filter((item) => !miss.has(item.id) && recentSet.has(item.id));
  const items = [...preferred, ...fresh, ...old];
  const output = [];
  const used = new Set();
  const perRule = new Set();
  const chooseTarget = Math.round(size * 0.6);

  for (const item of items) {
    if (output.length >= size) break;
    const chooseCount = output.filter((entry) => entry.kind === "choose").length;
    const otherCount = output.length - chooseCount;
    if (perRule.has(item.ruleId) || (item.kind === "choose" ? chooseCount >= chooseTarget : otherCount >= size - chooseTarget)) continue;
    output.push(item);
    used.add(item.id);
    perRule.add(item.ruleId);
  }
  for (const item of items) {
    if (output.length >= size) break;
    if (used.has(item.id)) continue;
    output.push(item);
    used.add(item.id);
  }
  if (allowReuse && output.length < size && items.length) {
    while (output.length < size) output.push(items[output.length % items.length]);
  }
  return output;
}

/** Build a quick, focused, or mistakes-only practice round. */
export function buildRound({ mode, lessons, key, ruleId, size, weights = {}, missedIds = [], recentIds = [], random = Math.random }) {
  const lesson = (lessons ?? []).find((item) => item.key === key);
  if (mode === "mine") {
    if (!Object.values(weights).some((count) => count > 0)) return [];
    const topRules = Object.entries(weights)
      .filter(([, count]) => count > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id]) => id);
    const pool = (lessons ?? []).flatMap((item) => item.exercises ?? []).filter((item) => topRules.includes(item.ruleId));
    const result = [];
    for (const id of topRules) {
      result.push(...pick(pool.filter((item) => item.ruleId === id), Math.min(3, 10 - result.length), weights, missedIds, recentIds, random));
    }
    return result.slice(0, 10);
  }
  if (!lesson) return [];

  let pool = lesson.exercises ?? [];
  if (ruleId) pool = pool.filter((item) => item.ruleId === ruleId);
  const target = mode === "quick" ? 5 : Math.max(1, Math.min(size ?? 10, 20));
  const allowReuse = mode === "focused" || (mode === "quick" && Boolean(ruleId));
  return pick(pool, mode === "focused" && ruleId ? Math.min(target, pool.length) : target, weights, missedIds, recentIds, random, allowReuse);
}

/** Add each missed exercise once to the end of a focused round. */
export function requeueMissed(round, results) {
  const added = new Set();
  const missed = round.filter((exercise, index) => {
    if (results[index]?.verdict === "correct" || added.has(exercise.id)) return false;
    added.add(exercise.id);
    return true;
  });
  return [...round, ...missed];
}
