const replacements = [
  [/\bI'm\b/gi, "i am"],
  [/\bim\b/gi, "i am"],
  [/\bdon't\b/gi, "do not"],
  [/\bdont\b/gi, "do not"],
  [/\bdoesnt\b/gi, "does not"],
  [/\bdidnt\b/gi, "did not"],
  [/\bcant\b/gi, "cannot"],
  [/\bcouldnt\b/gi, "could not"],
  [/\bwouldnt\b/gi, "would not"],
  [/\bshouldnt\b/gi, "should not"],
  [/\bisnt\b/gi, "is not"],
  [/\barent\b/gi, "are not"],
  [/\bwasnt\b/gi, "was not"],
  [/\bwerent\b/gi, "were not"],
  [/\bhavent\b/gi, "have not"],
  [/\bhasnt\b/gi, "has not"],
  [/\bhadnt\b/gi, "had not"],
  [/\bive\b/gi, "i have"],
  [/\byoure\b/gi, "you are"],
  [/\btheyre\b/gi, "they are"],
  [/\bweve\b/gi, "we have"],
  [/\btheyve\b/gi, "they have"],
  [/\byouve\b/gi, "you have"],
  [/\bit's\b/gi, "it is"],
  [/\bI've\b/gi, "i have"],
  [/\bwe're\b/gi, "we are"],
  [/\bdidn't\b/gi, "did not"],
  [/\bdoesn't\b/gi, "does not"],
  [/\bhaven't\b/gi, "have not"],
  [/\bcan't\b/gi, "cannot"],
  [/\bwon't\b/gi, "will not"],
  [/\bcan't\b/gi, "cannot"],
  [/\bcouldn't\b/gi, "could not"],
  [/\bwouldn't\b/gi, "would not"],
  [/\bshouldn't\b/gi, "should not"],
  [/\bisn't\b/gi, "is not"],
  [/\baren't\b/gi, "are not"],
  [/\bwasn't\b/gi, "was not"],
  [/\bweren't\b/gi, "were not"],
  [/\bhasn't\b/gi, "has not"],
  [/\bhadn't\b/gi, "had not"],
  [/\byou're\b/gi, "you are"],
  [/\bthey're\b/gi, "they are"],
  [/\bwe've\b/gi, "we have"],
  [/\bthey've\b/gi, "they have"],
  [/\byou've\b/gi, "you have"],
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

  const source = tokens(exercise.sentence);
  const submitted = tokens(answer);
  const exactSource = String(answer).trim().toLocaleLowerCase("en-US").replace(/[’‘]/gu, "'");
  const exactOriginal = String(exercise.sentence).trim().toLocaleLowerCase("en-US").replace(/[’‘]/gu, "'");
  if (exactSource === exactOriginal) {
    return { verdict: "incorrect", corrected, feedback: "incorrect" };
  }

  const accepted = [exercise.answer, ...(exercise.accepted ?? [])];
  if (accepted.some((candidate) => normalize(candidate) === normalize(answer))) {
    return { verdict: "correct", corrected, feedback: "correct" };
  }
  if (sameTokens(source, submitted)) return { verdict: "incorrect", corrected, feedback: "incorrect" };

  const target = tokens(exercise.answer);
  let start = 0;
  while (start < source.length && start < target.length && source[start] === target[start]) start += 1;
  const region = diffRegion(source, target, start);
  const sourceRegion = source.slice(start, region.endSource + 1);
  const fixed = target.slice(start, region.endTarget + 1);
  const leftAnchor = start > 0 ? target[start - 1] : null;
  const rightAnchor = region.endTarget + 1 < target.length ? target[region.endTarget + 1] : null;
  const correctedInContext = hasRegionWithAnchors(submitted, fixed, leftAnchor, rightAnchor);
  const mistakenInContext = hasRegionWithAnchors(submitted, sourceRegion, leftAnchor, rightAnchor);
  const verdict = correctedInContext && !mistakenInContext ? "almost" : "incorrect";
  return { verdict, corrected, feedback: verdict };
}

function diffRegion(source, target, start) {
  let endTarget = target.length - 1;
  let endSource = source.length - 1;
  while (endSource >= start && endTarget >= start && source[endSource] === target[endTarget]) {
    endSource -= 1;
    endTarget -= 1;
  }
  return { endSource, endTarget };
}

function sameTokens(left, right) {
  return left.length === right.length && left.every((word, index) => word === right[index]);
}

function hasRegionWithAnchors(sentence, region, leftAnchor, rightAnchor) {
  if (!leftAnchor && !rightAnchor) return region.length > 0 && containsTokens(sentence, region);
  if (!region.length && leftAnchor && rightAnchor) return containsTokens(sentence, [leftAnchor, rightAnchor]);
  const pattern = [
    ...(leftAnchor ? [leftAnchor] : []),
    ...region,
    ...(rightAnchor ? [rightAnchor] : []),
  ];
  return containsTokens(sentence, pattern);
}

function containsTokens(sentence, pattern) {
  for (let start = 0; start <= sentence.length - pattern.length; start += 1) {
    if (pattern.every((word, offset) => sentence[start + offset] === word)) return true;
  }
  return false;
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

function shuffled(items, random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function prepareRound(exercises, random) {
  return shuffled(exercises, random).map((exercise) => exercise.kind === "choose"
    ? { ...exercise, options: shuffled(exercise.options ?? [], random) }
    : exercise);
}

/** Build a quick, focused, or mistakes-only practice round. */
export function buildRound({ mode, lessons, key, ruleId, size, weights = {}, lessonWeights = {}, missedIds = [], recentIds = [], personalTargets = [], random = Math.random }) {
  const lesson = (lessons ?? []).find((item) => item.key === key);
  if (mode === "mine") {
    const personal = (personalTargets ?? []).slice(0, 3);
    if (!Object.values(weights).some((count) => count > 0) && !Object.values(lessonWeights).some((count) => count > 0)) return personal;
    let fixed = [];
    if (!Object.values(weights).some((count) => count > 0)) {
      const topLessons = Object.entries(lessonWeights).filter(([, count]) => count > 0).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const totalWeight = topLessons.reduce((sum, [, count]) => sum + count, 0);
      const allocations = topLessons.map(([lessonKey, count]) => ({ lessonKey, count: Math.floor(10 * count / totalWeight), remainder: (10 * count) % totalWeight }));
      let remaining = 10 - allocations.reduce((sum, item) => sum + item.count, 0);
      for (const item of [...allocations].sort((a, b) => b.remainder - a.remainder)) {
        if (remaining-- <= 0) break;
        item.count += 1;
      }
      for (const { lessonKey, count } of allocations) {
        const pool = (lessons ?? []).find((item) => item.key === lessonKey)?.exercises ?? [];
        fixed.push(...pick(pool, Math.min(count, 10 - fixed.length), {}, missedIds, recentIds, random));
      }
    } else {
      const topRules = Object.entries(weights)
        .filter(([, count]) => count > 0)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id);
      const pool = (lessons ?? []).flatMap((item) => item.exercises ?? []).filter((item) => topRules.includes(item.ruleId));
      for (const id of topRules) {
        fixed.push(...pick(pool.filter((item) => item.ruleId === id), Math.min(3, 10 - fixed.length), weights, missedIds, recentIds, random));
      }
    }
    fixed = fixed.slice(0, Math.max(0, 10 - personal.length));
    return [...personal, ...prepareRound(fixed, random)];
  }
  if (!lesson) return [];

  let pool = lesson.exercises ?? [];
  if (ruleId) pool = pool.filter((item) => item.ruleId === ruleId);
  const target = mode === "quick" ? 5 : Math.max(1, Math.min(size ?? 10, 20));
  const allowReuse = mode === "focused" || (mode === "quick" && Boolean(ruleId));
  return prepareRound(pick(pool, mode === "focused" && ruleId ? Math.min(target, pool.length) : target, weights, missedIds, recentIds, random, allowReuse), random);
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
