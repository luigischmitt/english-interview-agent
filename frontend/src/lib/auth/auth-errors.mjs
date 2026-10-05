/**
 * Maps Supabase auth errors to clear PT-BR messages, and suggests fixes for mistyped e-mail domains.
 * Supabase errors carry a stable `code` (AuthApiError); older versions only have `status` + `message`.
 */

const messages = {
  invalid_credentials: "E-mail ou senha incorretos. Confira os dois e tente de novo.",
  email_not_confirmed: "Seu e-mail ainda não foi confirmado. Abra o link que enviamos (veja também o spam) ou reenvie a confirmação.",
  user_already_exists: "Já existe uma conta com este e-mail. Entre ou recupere sua senha.",
  email_exists: "Já existe uma conta com este e-mail. Entre ou recupere sua senha.",
  weak_password: "Essa senha é fraca demais. Use pelo menos oito caracteres, misturando letras e números.",
  email_address_invalid: "Este e-mail não parece válido. Confira o endereço.",
  over_email_send_rate_limit: "Muitos e-mails foram enviados agora. Espere alguns minutos e tente de novo.",
  over_request_rate_limit: "Muitas tentativas seguidas. Espere um minuto e tente de novo.",
  signup_disabled: "Novos cadastros estão desativados no momento.",
  same_password: "A nova senha precisa ser diferente da atual.",
};

/** Normalizes a Supabase error into a known code (or null). */
export function authErrorCode(error) {
  if (!error || typeof error !== "object") return null;
  const code = typeof error.code === "string" ? error.code : null;
  if (code && code in messages) return code;
  const text = typeof error.message === "string" ? error.message.toLowerCase() : "";
  if (text.includes("invalid login credentials")) return "invalid_credentials";
  if (text.includes("email not confirmed")) return "email_not_confirmed";
  if (text.includes("already registered") || text.includes("already been registered")) return "user_already_exists";
  if (text.includes("rate limit") && text.includes("email")) return "over_email_send_rate_limit";
  if (error.status === 429) return "over_request_rate_limit";
  if (text.includes("password should be")) return "weak_password";
  if (text.includes("invalid") && text.includes("email")) return "email_address_invalid";
  return code;
}

export function authErrorMessage(error) {
  if (error instanceof Error && error.message.includes("Missing NEXT_PUBLIC")) return "O Supabase ainda não está configurado neste ambiente.";
  const code = authErrorCode(error);
  if (code && code in messages) return messages[code];
  return "Não foi possível concluir esta solicitação. Confira seus dados e tente novamente.";
}

const knownDomains = ["gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com", "live.com", "yahoo.com.br", "hotmail.com.br", "outlook.com.br", "uol.com.br", "bol.com.br", "terra.com.br", "msn.com", "me.com", "protonmail.com", "proton.me"];

function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** Returns the corrected e-mail when the domain looks like a typo of a common provider (e.g. gamil.com → gmail.com), else null. */
export function suggestEmailCorrection(email) {
  const value = String(email ?? "").trim().toLowerCase();
  const at = value.lastIndexOf("@");
  if (at < 1 || at === value.length - 1) return null;
  const local = value.slice(0, at);
  let domain = value.slice(at + 1).replace(/\.con$/, ".com").replace(/\.cmo$/, ".com").replace(/\.co$/, ".com");
  if (knownDomains.includes(value.slice(at + 1))) return null;
  if (knownDomains.includes(domain)) return `${local}@${domain}`;
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of knownDomains) {
    const d = distance(domain, candidate);
    if (d < bestDistance) { best = candidate; bestDistance = d; }
  }
  return best && bestDistance > 0 && bestDistance <= 2 ? `${local}@${best}` : null;
}
