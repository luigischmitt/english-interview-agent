export function recordCandidateStatus(statuses, latestByEpoch, { speechEpoch, revision, status }, currentSpeechEpoch) {
  if (!Number.isSafeInteger(speechEpoch) || speechEpoch < 0 || speechEpoch !== currentSpeechEpoch) return false;
  const latest = latestByEpoch.get(speechEpoch) ?? 0;
  if (!Number.isSafeInteger(revision) || revision < latest) return false;
  const key = `${speechEpoch}:${revision}`;
  const existing = statuses.get(key);
  const terminal = (value) => value === "COVERED" || value === "INVALID" || value === "NONE";
  if (revision === latest && existing !== undefined) {
    if (terminal(existing) || existing === status) return false;
  }
  latestByEpoch.set(speechEpoch, revision);
  statuses.set(key, status);
  return true;
}

export function candidateStatusFor(statuses, latestByEpoch, speechEpoch, revision, currentSpeechEpoch) {
  if (speechEpoch !== currentSpeechEpoch) return undefined;
  const latestRevision = latestByEpoch.get(speechEpoch) ?? 0;
  const latestStatus = statuses.get(`${speechEpoch}:${latestRevision}`);
  if (latestStatus === "NONE" && latestRevision >= revision) return "NONE";
  return statuses.get(`${speechEpoch}:${revision}`);
}

export function canUseCurrentEpochCandidate({ value, finalTranscript, currentTurnId, currentSpeechEpoch, featureEnabled, compatibility }) {
  if (!value || value.turnId !== currentTurnId || value.speechEpoch !== currentSpeechEpoch) return false;
  if (compatibility === "COVERED" || compatibility === "INVALID") return false;
  // NONE speaks only about follow-up candidates; an exact-transcript NEXT preparation stays usable.
  if (compatibility === "NONE" && value.decision?.decision === "FOLLOW_UP") return false;
  if (String(value.transcript ?? "").trim() === String(finalTranscript ?? "").trim()) return true;
  return featureEnabled === true
    && value.decision?.decision === "FOLLOW_UP"
    && typeof value.anchor === "string"
    && value.anchor.length > 0
    && containsNormalizedPhrase(finalTranscript, value.anchor)
    && compatibility === "OPEN";
}

function containsNormalizedPhrase(haystack, needle) {
  const normalize = (value) => String(value ?? "").normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? [];
  const source = normalize(haystack);
  const phrase = normalize(needle);
  return phrase.length > 0 && phrase.length <= source.length && source.some((_, index) => phrase.every((word, offset) => source[index + offset] === word));
}

export async function waitForFirstChunk(speechReady, timeoutMs = 400, timers = globalThis) {
  const [ready] = await waitForFirstChunks([speechReady], timeoutMs, timers);
  return ready;
}

export async function waitForFirstChunks(speechReadiness, timeoutMs = 400, timers = globalThis) {
  const results = speechReadiness.map(() => false);
  const readyPromises = speechReadiness.map((speechReady, index) => Promise.resolve(speechReady).then((value) => { results[index] = value === true; }, () => {}));
  if (results.length === 0) return results;
  let timeoutId;
  const timeout = new Promise((resolve) => { timeoutId = timers.setTimeout(() => resolve("timeout"), timeoutMs); });
  await Promise.race([Promise.all(readyPromises).then(() => "ready"), timeout]);
  timers.clearTimeout(timeoutId);
  return results;
}

/**
 * The frontend resolved a revision to "no follow-up candidate" (analysis said NONE, failed, or yielded a fixed question):
 * record a local terminal NONE for it and discard retained FOLLOW_UP preparations of older revisions in the same epoch.
 */
export function applyFollowUpCandidateClear({ registry, statuses, latestByEpoch, speechEpoch, revision, currentSpeechEpoch }) {
  recordCandidateStatus(statuses, latestByEpoch, { speechEpoch, revision, status: "NONE" }, currentSpeechEpoch);
  return registry.discardWhere((value) => value?.decision?.decision === "FOLLOW_UP" && value.speechEpoch === speechEpoch && value.revision < revision);
}

/**
 * Bounded wait for a prepared turn's audio. A FOLLOW_UP waits only for its own speech; the unrelated adapted fixed-question
 * audio counts only when the chosen decision is NEXT.
 */
export async function waitForPreparedTurnAudio({ decision, speechReady, adaptedFixedQuestion, fixedQuestionAudioReady }, timeoutMs = 400, timers = globalThis) {
  const needsFixed = decision?.decision === "NEXT" && adaptedFixedQuestion === true;
  const readiness = await waitForFirstChunks(needsFixed ? [speechReady, fixedQuestionAudioReady] : [speechReady], timeoutMs, timers);
  return { firstChunkReady: readiness[0] === true, adaptedQuestionReady: needsFixed && readiness[1] === true };
}
