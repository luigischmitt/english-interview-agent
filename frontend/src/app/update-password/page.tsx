import { AuthForm } from "@/components/auth/auth-form";

export default async function UpdatePasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const params = await searchParams;
  return <AuthForm mode="update-password" reason={params.reason} />;
}
