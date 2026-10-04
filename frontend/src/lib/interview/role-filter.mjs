function normalize(text) {
  return String(text ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

/**
 * Suggestions for the role combobox. Every word typed must appear in the role
 * (any order, accents ignored); roles that start with the query come first.
 * An empty query returns all roles. Free text is never rejected here.
 */
export function filterRoles(roles, query) {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return [...roles];
  const tokens = normalizedQuery.split(" ");

  return roles
    .map((role, index) => ({ role, index, text: normalize(role) }))
    .filter(({ text }) => tokens.every((token) => text.includes(token)))
    .sort((a, b) => {
      const aPrefix = a.text.startsWith(normalizedQuery) ? 0 : 1;
      const bPrefix = b.text.startsWith(normalizedQuery) ? 0 : 1;
      return aPrefix - bPrefix || a.index - b.index;
    })
    .map(({ role }) => role);
}

/** True when the typed text is exactly one of the suggestions (case/accent-insensitive). */
export function isKnownRole(roles, value) {
  const normalizedValue = normalize(value);
  return normalizedValue !== "" && roles.some((role) => normalize(role) === normalizedValue);
}
