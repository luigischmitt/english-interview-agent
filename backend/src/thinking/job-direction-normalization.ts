const seniorityWord = "(?:junior|júnior|jr\\.?|mid-level|mid level|midlevel|pleno|senior|sênior|sr\\.?|staff)";
// "Lead" and "Principal" are stripped only as prefixes: as suffixes they are part of titles such as "Tech Lead".
const leading = new RegExp(`^(?:(?:${seniorityWord}|lead|principal)[\\s\\-–—:/]+)+`, "iu");
const trailing = new RegExp(`(?:[\\s\\-–—:/,]+${seniorityWord})+$`, "iu");
const parenthesized = new RegExp(`\\s*[\\(\\[]\\s*(?:${seniorityWord}[\\s/,\\-]*)+[\\)\\]]`, "giu");
const levelSuffix = /\s+(?:i{1,3}|iv|v|[1-5])$/iu;

// Common Portuguese titles, most specific first. Applied only when the title still looks Portuguese.
const portugueseTitles: Array<[RegExp, string]> = [
  [/^analista de dados$/iu, "Data Analyst"],
  [/^cientista de dados$/iu, "Data Scientist"],
  [/^engenheir[oa] de dados$/iu, "Data Engineer"],
  [/^analista de (?:business intelligence|bi)$/iu, "BI Analyst"],
  [/^engenheir[oa] de software$/iu, "Software Engineer"],
  [/^engenheir[oa] de machine learning$/iu, "Machine Learning Engineer"],
  [/^engenheir[oa] de qualidade$/iu, "QA Engineer"],
  [/^analista de (?:qa|testes|qualidade)$/iu, "QA Analyst"],
  [/^analista de sistemas$/iu, "Systems Analyst"],
  [/^analista de suporte$/iu, "Support Analyst"],
  [/^desenvolvedor[a]? (?:de software|full ?stack)$/iu, "Software Developer"],
  [/^desenvolvedor[a]? back-?end$/iu, "Backend Developer"],
  [/^desenvolvedor[a]? front-?end$/iu, "Frontend Developer"],
  [/^desenvolvedor[a]? mobile$/iu, "Mobile Developer"],
  [/^desenvolvedor[a]?$/iu, "Software Developer"],
  [/^gerente de produto$/iu, "Product Manager"],
  [/^gerente de projetos?$/iu, "Project Manager"],
  [/^gerente de engenharia$/iu, "Engineering Manager"],
  [/^designer de produto$/iu, "Product Designer"],
  [/^arquitet[oa] de software$/iu, "Software Architect"],
  [/^arquitet[oa] de solu[cç][õo]es$/iu, "Solutions Architect"],
  [/^engenheir[oa] de confiabilidade(?: de sites)?$/iu, "Site Reliability Engineer"],
];
const portugueseHints = /\b(?:analista|desenvolvedor[a]?|engenheir[oa]|cientista|gerente|arquitet[oa]|de|da|do|dados|sistemas|suporte|qualidade|produto|projetos?)\b/iu;

/** Concise English title without seniority words; null when nothing usable remains. */
export function normalizeTargetRole(value: string): string | null {
  let role = value.trim().replace(parenthesized, "").trim();
  for (let pass = 0; pass < 3; pass += 1) {
    role = role.replace(leading, "").replace(trailing, "").trim();
  }
  // Seniority is often written as a trailing level ("Engineer II"); it belongs to the separate seniority field.
  role = role.replace(levelSuffix, "").trim();
  role = role.replace(/\s{2,}/gu, " ");
  if (!role || new RegExp(`^(?:${seniorityWord}|lead|principal)$`, "iu").test(role)) return null;
  if (portugueseHints.test(role)) {
    const mapped = portugueseTitles.find(([pattern]) => pattern.test(role));
    // Unknown Portuguese titles are kept as written rather than guessed.
    if (mapped) role = mapped[1];
  }
  return role.length <= 100 ? role : null;
}

const placeholder = "(?:n[ãa]o\\s+(?:informad[oa]s?|especificad[oa]s?|dispon[ií]vel|mencionad[oa]s?)|n\\/?a|not\\s+(?:specified|informed|provided|mentioned)|desconhecid[oa]s?)";
const trailingPlaceholder = new RegExp(`(?:[\\s,;:.–—-]+|^)(?:[\\p{L}/ ]{0,40}:\\s*)?${placeholder}[\\s.;]*$`, "iu");
const placeholderOnlyClause = new RegExp(`^(?:[\\p{L}/ ]{0,40}:\\s*)?${placeholder}[\\s.]*$`, "iu");
export const neutralTeamContext = "Contexto do time não informado na vaga.";

/** Removes "Não informado"-style filler; falls back to a neutral sentence when nothing concrete remains. */
export function normalizeProductTeamContext(value: string): string {
  const clauses = value.trim().split(/(?<=[.;])\s+/u).map((clause) => clause.trim()).filter((clause) => clause && !placeholderOnlyClause.test(clause));
  let text = clauses.join(" ");
  for (let pass = 0; pass < 3; pass += 1) {
    const next = text.replace(trailingPlaceholder, "").trim();
    if (next === text) break;
    text = next;
  }
  text = text.replace(/[\s,;:–—-]+$/u, "").trim();
  if (!text || !/[\p{L}\p{N}]/u.test(text) || placeholderOnlyClause.test(text)) return neutralTeamContext;
  return /[.!]$/u.test(text) ? text : `${text}.`;
}
