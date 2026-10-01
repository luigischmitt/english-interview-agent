import { getSupabaseBrowserClient } from "@/lib/supabase/client";

import { createAccessTokenReader, createAuthorizedFetch } from "./access-token.mjs";

export { buildStreamStartMessage, sessionExpiredMessage, UnauthenticatedError } from "./access-token.mjs";

/** Current Supabase access token (refreshed by the client when needed); throws UnauthenticatedError without a session. */
export const getAccessToken = createAccessTokenReader(async () => (await getSupabaseBrowserClient().auth.getSession()).data.session);

/** Use for every call to the backend API. */
export const authorizedFetch = createAuthorizedFetch(getAccessToken);
