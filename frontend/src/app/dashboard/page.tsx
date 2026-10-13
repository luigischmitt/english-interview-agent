import HomeClient from "../home-client";
import { parsePracticeLink } from "@/lib/practice/practice-links.mjs";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string | string[]; lesson?: string | string[]; part?: string | string[] }> }) {
  const params = await searchParams;
  const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);
  const view = first(params.view);
  const link = view === "train" ? parsePracticeLink(first(params.lesson), first(params.part)) : null;
  return <HomeClient initialView={view === "interview-setup" ? "interview-setup" : view === "train" ? "train" : "home"} initialLesson={link?.lesson} initialPart={link?.part ?? undefined} />;
}
