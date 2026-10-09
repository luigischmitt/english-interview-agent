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
  // A preparation from an earlier speech epoch survives pauses, but a preparation from a later epoch than the final one cannot exist.
  if (!value || value.turnId !== currentTurnId) return false;
  if (Number.isSafeInteger(currentSpeechEpoch) && value.speechEpoch > currentSpeechEpoch) return false;
  if (!Number.isSafeInteger(currentSpeechEpoch) && value.decision?.decision === "FOLLOW_UP" && String(value.transcript ?? "").trim() !== String(finalTranscript ?? "").trim()) return false;
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

/** COVERED and INVALID are sticky: once a candidate revision (or a newer one) is judged so in ANY epoch, it never plays. */
function stickyTerminalStatus(statuses, revision) {
  for (const [key, status] of statuses) {
    if (status !== "COVERED" && status !== "INVALID") continue;
    const statusRevision = Number(key.slice(key.indexOf(":") + 1));
    if (Number.isSafeInteger(statusRevision) && statusRevision >= revision) return status;
  }
  return undefined;
}

/**
 * Status of a preparation's candidate. A COVERED/INVALID judged in any epoch is sticky; any other status counts only
 * when recorded in the FINAL speech epoch (the candidate must be re-checked against what was said up to the final pause).
 * NONE (timeout/error) stays non-sticky.
 */
export function finalEpochCandidateStatus(statuses, latestByEpoch, revision, finalSpeechEpoch) {
  const sticky = stickyTerminalStatus(statuses, revision);
  if (sticky) return sticky;
  if (!Number.isSafeInteger(finalSpeechEpoch)) return undefined;
  return candidateStatusFor(statuses, latestByEpoch, finalSpeechEpoch, revision, finalSpeechEpoch);
}

/** A COVERED/INVALID status retires every retained FOLLOW_UP preparation up to its revision, releasing its prewarmed audio. */
export function discardCoveredFollowUps(registry, { revision, status }) {
  if (status !== "COVERED" && status !== "INVALID") return 0;
  return registry.discardWhere((value) => value?.decision?.decision === "FOLLOW_UP" && value.revision <= revision);
}

/** The final speech epoch advances monotonically from provisional snapshots and statuses; null (after a resume) adopts any epoch. */
export function adoptSpeechEpoch(currentSpeechEpoch, observedSpeechEpoch) {
  if (!Number.isSafeInteger(observedSpeechEpoch) || observedSpeechEpoch < 0) return currentSpeechEpoch;
  return currentSpeechEpoch === null || currentSpeechEpoch === undefined || observedSpeechEpoch > currentSpeechEpoch ? observedSpeechEpoch : currentSpeechEpoch;
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
 * record a local terminal NONE for it and discard retained FOLLOW_UP preparations of older revisions.
 */
export function applyFollowUpCandidateClear({ registry, statuses, latestByEpoch, revision, currentSpeechEpoch }) {
  recordCandidateStatus(statuses, latestByEpoch, { speechEpoch: currentSpeechEpoch, revision, status: "NONE" }, currentSpeechEpoch);
  // Candidates now outlive pauses, so a newer "no candidate" resolution retires older FOLLOW_UP preparations of any epoch.
  return registry.discardWhere((value) => value?.decision?.decision === "FOLLOW_UP" && value.revision < revision);
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
