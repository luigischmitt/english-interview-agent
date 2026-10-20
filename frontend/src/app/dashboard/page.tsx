import HomeClient from "../home-client";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const params = await searchParams;
  const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);
  const view = first(params.view);
  const initialView = view === "interview-setup" || view === "voice" || view === "progress" ? view : view === "train" || view === "pronunciation" ? "voice" : "home";
  return <HomeClient initialView={initialView} />;
}
