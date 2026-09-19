import { AuthForm } from "@/components/auth/auth-form";

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const params = await searchParams;
  return <AuthForm mode="forgot-password" reason={params.reason} />;
}
