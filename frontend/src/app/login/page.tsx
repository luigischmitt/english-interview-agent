import { AuthForm } from "@/components/auth/auth-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; reason?: string }>;
}) {
  const params = await searchParams;
  return <AuthForm mode="login" next={params.next} reason={params.reason} />;
}
