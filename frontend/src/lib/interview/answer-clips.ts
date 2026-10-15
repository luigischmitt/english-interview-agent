import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export async function uploadAnswerClip(interviewId: string, userId: string, sequenceNumber: number, clip: { sentenceIndex: number; base64: string }): Promise<string | null> {
  try {
    const binary = atob(clip.base64);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const blob = new Blob([bytes], { type: "audio/webm" });
    const path = `${userId}/${interviewId}/${sequenceNumber}-${clip.sentenceIndex}.webm`;
    const { error } = await getSupabaseBrowserClient().storage.from("answer-clips").upload(path, blob, { upsert: true, contentType: "audio/webm" });
    return error ? null : path;
  } catch { return null; }
}

export async function getAnswerClipUrl(path: string): Promise<string | null> {
  try {
    const { data, error } = await getSupabaseBrowserClient().storage.from("answer-clips").createSignedUrl(path, 600);
    return error ? null : data.signedUrl;
  } catch { return null; }
}

export async function purgeExpiredAnswerClips(retentionDays = 30): Promise<void> {
  try {
    const sessionFlag = "answer-clips-expiry-purge-done";
    if (sessionStorage.getItem(sessionFlag)) return;
    sessionStorage.setItem(sessionFlag, "1");
    const client = getSupabaseBrowserClient();
    const { data: auth } = await client.auth.getUser();
    const userId = auth.user?.id;
    if (!userId) return;
    const { data: folders } = await client.storage.from("answer-clips").list(userId, { limit: 1000 });
    const interviewIds = (folders ?? []).map((folder) => folder.name).filter(Boolean);
    if (!interviewIds.length) return;
    const cutoff = Date.now() - Math.max(0, retentionDays) * 86_400_000;
    const { data: interviews } = await client.from("interviews").select("id").eq("status", "completed").lt("completed_at", new Date(cutoff).toISOString()).in("id", interviewIds);
    if (!interviews?.length) return;
    for (const interview of interviews as Array<{ id: string }>) {
      const folder = `${userId}/${interview.id}`;
      const { data: files } = await client.storage.from("answer-clips").list(folder, { limit: 1000 });
      const paths = (files ?? []).filter((file) => file.name && file.id).map((file) => `${folder}/${file.name}`);
      if (paths.length) await client.storage.from("answer-clips").remove(paths);
    }
  } catch { /* Retention cleanup is best effort. */ }
}
