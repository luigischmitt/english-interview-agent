"use client";


import { useLocale, t } from "@/lib/locale";
import { useEffect, useMemo, useState } from "react";
import { Play } from "lucide-react";
import { loadProgressRecords } from "@/lib/interview/persistence";
import { buildProgressInsights } from "@/lib/interview/progress-insights.mjs";
import type { ProgressRecord } from "@/lib/interview/progress-insights.mjs";
import { PageIntro } from "./shared";
import { ProgressContent } from "./progress/progress-content";

export function ProgressView({ onStart }: { onStart?: () => void } = {}) {
  const { locale } = useLocale();
  const [records, setRecords] = useState<ProgressRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    const load = async () => {
      const result = await loadProgressRecords();
      if (!active) return;
      if (result.ok) {
        setRecords(result.value);
        setError(null);
      } else {
        setRecords([]);
        setError(result.message);
      }
      setIsLoading(false);
    };
    void load();
    return () => { active = false; };
  }, [attempt]);

  const insights = useMemo(() => buildProgressInsights(records, { locale }), [records, locale]);

  const retry = () => {
    setIsLoading(true);
    setError(null);
    setAttempt((value) => value + 1);
  };

  const startAction = onStart && (
    <button type="button" className="ds-btn ds-btn-soft" onClick={onStart}>
      <Play className="size-4 fill-current" aria-hidden="true" /> {t("Nova prática ")}</button>
  );

  return (
    <main id="main-content" className="mx-auto w-full min-w-0 max-w-6xl px-4 py-8 pb-36 sm:px-8 sm:py-10 sm:pb-28 lg:px-12 lg:py-14 lg:pb-16">
      <PageIntro
        title={t("Seu progresso")}
        description={t("O que se repete nas suas respostas, o que estudar primeiro e como você evolui a cada prática.")}
        action={insights.sessionCount > 0 ? startAction : undefined}
      />
      {isLoading ? (
        <section className="mt-8 space-y-5 lg:mt-10" aria-busy="true" aria-label={t("Carregando progresso")}>
          <div className="skeleton h-80 w-full !rounded-[var(--ds-r-panel)]" />
          <div className="grid gap-5 md:grid-cols-2">
            <div className="skeleton h-56 w-full !rounded-[var(--ds-r-card)]" />
            <div className="skeleton h-56 w-full !rounded-[var(--ds-r-card)]" />
          </div>
          <div className="skeleton h-64 w-full !rounded-[var(--ds-r-card)]" />
        </section>
      ) : error ? (
        <section className="mt-8 lg:mt-10" role="alert">
          <div className="shl-error ds-fade-in flex flex-col items-start gap-4 p-5 sm:p-6">
            <div>
              <h2 className="ds-h2">{t("Não foi possível carregar seu progresso.")}</h2>
              <p className="mt-1 text-sm">{t("Verifique sua conexão e tente novamente.")}</p>
            </div>
            <button type="button" className="ds-btn ds-btn-soft" onClick={retry}>{t("Tentar novamente")}</button>
          </div>
        </section>
      ) : insights.sessionCount === 0 ? (
        <section className="mt-8 lg:mt-10">
          <div className="shl-dashed ds-enter p-6 sm:p-8">
            <span className="shl-pill shl-pill-off">{t("Nenhuma sessão concluída ainda")}</span>
            <div className="mt-4">
              <h2 className="ds-h2">{t("Sua primeira prática começa o seu painel.")}</h2>
              <p className="ds-body mt-2 max-w-xl">
                {t("Depois de concluir uma entrevista você vê aqui seus erros mais comuns, o que estudar primeiro e a evolução a cada prática. Sessões em andamento ou abandonadas não entram. ")}</p>
              {onStart && (
                <div className="mt-5">
                  <button type="button" className="ds-btn ds-btn-soft" onClick={onStart}>
                    <Play className="size-4 fill-current" aria-hidden="true" /> {t("Começar primeira prática ")}</button>
                </div>
              )}
            </div>
          </div>
        </section>
      ) : (
        <ProgressContent insights={insights} />
      )}
    </main>
  );
}
