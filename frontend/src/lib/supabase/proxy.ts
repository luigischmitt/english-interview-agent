import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { sanitizeNextPath } from "@/lib/auth/redirect";

import { getSupabasePublicConfigOrNull } from "./config";

const publicRoutes = new Set([
  "/",
  "/login",
  "/signup",
  "/forgot-password",
  "/auth/callback",
]);
const authEntryRoutes = new Set([
  "/login",
  "/signup",
  "/forgot-password",
  "/auth/callback",
]);

export async function updateSupabaseSession(request: NextRequest) {
  const config = getSupabasePublicConfigOrNull();
  const isPublicRoute = publicRoutes.has(request.nextUrl.pathname);

  if (!config) {
    if (isPublicRoute) {
      return NextResponse.next({ request });
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("reason", "config");
    return NextResponse.redirect(loginUrl);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(config.supabaseUrl, config.supabasePublishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicRoute) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set(
      "next",
      sanitizeNextPath(`${request.nextUrl.pathname}${request.nextUrl.search}`),
    );
    return NextResponse.redirect(loginUrl);
  }

  if (user && authEntryRoutes.has(request.nextUrl.pathname)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return response;
}
