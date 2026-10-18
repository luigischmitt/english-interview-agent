import HomeClient from "../home-client";

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string | string[]; lesson?: string | string[]; part?: string | string[] }> }) {
  const params = await searchParams;
  const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value);
  const view = first(params.view);
  return <HomeClient initialView={view === "interview-setup" || view === "voice" ? view : "home"} />;
}
