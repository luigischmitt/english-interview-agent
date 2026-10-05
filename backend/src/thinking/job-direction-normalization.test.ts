import { describe, expect, it } from "vitest";
import { neutralTeamContext, normalizeProductTeamContext, normalizeTargetRole } from "./job-direction-normalization.js";

describe("normalizeTargetRole", () => {
  it.each([
    ["Senior Backend Engineer", "Backend Engineer"],
    ["Backend Engineer - Senior", "Backend Engineer"],
    ["Sr. Data Analyst (Pleno)", "Data Analyst"],
    ["Lead Frontend Engineer", "Frontend Engineer"],
    ["Staff Software Engineer", "Software Engineer"],
    ["Software Engineer II", "Software Engineer"],
    ["Analista de Dados Sênior", "Data Analyst"],
    ["Desenvolvedora Backend Pleno", "Backend Developer"],
    ["Engenheiro de Software Júnior", "Software Engineer"],
    ["Tech Lead", "Tech Lead"],
    ["Security Specialist", "Security Specialist"],
    ["Analista de Planejamento Financeiro", "Analista de Planejamento Financeiro"],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeTargetRole(input)).toBe(expected);
  });

  it("rejects titles that are only seniority", () => {
    expect(normalizeTargetRole("Senior")).toBeNull();
    expect(normalizeTargetRole("  ")).toBeNull();
  });
});

describe("normalizeProductTeamContext", () => {
  it.each([
    ["Plataforma B2B de logística; equipe de produto e engenharia. Não informado", "Plataforma B2B de logística; equipe de produto e engenharia."],
    ["Fintech de pagamentos, time de dados. Não informado.", "Fintech de pagamentos, time de dados."],
    ["Produto de analytics; Equipe: Não informado", "Produto de analytics."],
    ["Plataforma de e-commerce. Equipe: N/A", "Plataforma de e-commerce."],
    ["Plataforma de e-commerce, não informado", "Plataforma de e-commerce."],
    ["Marketplace com times autônomos.", "Marketplace com times autônomos."],
  ])("strips placeholders: %s", (input, expected) => {
    expect(normalizeProductTeamContext(input)).toBe(expected);
  });

  it.each(["Não informado", "N/A.", "Não informado. Não informado.", "Produto: Não informado"])("falls back to a neutral phrase for %s", (input) => {
    expect(normalizeProductTeamContext(input)).toBe(neutralTeamContext);
  });
});
