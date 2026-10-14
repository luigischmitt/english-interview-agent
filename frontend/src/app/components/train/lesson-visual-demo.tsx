"use client";

import { useState, type ReactNode } from "react";
import { t } from "@/lib/locale";

export function LessonVisualDemo({ lessonKey }: { lessonKey: string }) {
  if (lessonKey === "prepositions") return <PrepositionsDemo />;
  if (lessonKey === "articles") return <ArticlesDemo />;
  if (lessonKey === "verb-tenses") return <TensesDemo />;
  if (lessonKey === "sentence-structure") return <ResponseStructureDemo />;
  return null;
}

function DemoFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="tr-visual-demo" aria-label={title}>
      <div className="tr-visual-demo-heading">
        <p className="tr-mini-label">{t("Veja a regra em ação")}</p>
        <h3>{t(title)}</h3>
        <p>{t("Escolha uma opção para observar como a frase muda.")}</p>
      </div>
      {children}
    </section>
  );
}

function DemoChoiceGroup({ label, children }: { label: string; children: ReactNode }) {
  return <div className="tr-visual-demo-choices" role="group" aria-label={t(label)}>{children}</div>;
}

function PrepositionsDemo() {
  const [selected, setSelected] = useState(0);
  const choices = [
    { word: "at", idea: "horário exato", phrase: "The deployment starts at 9 a.m." },
    { word: "on", idea: "dia da semana", phrase: "The release is on Friday." },
    { word: "in", idea: "linguagem de programação", phrase: "We built the service in Go." },
  ];
  const choice = choices[selected];

  return (
    <DemoFrame title="Um jeito visual de pensar em at, on e in">
      <DemoChoiceGroup label="Escolha uma preposição">
        {choices.map((item, index) => (
          <button key={item.word} type="button" className="tr-visual-choice" aria-pressed={selected === index} onClick={() => setSelected(index)}>
            <strong>{item.word}</strong><span>{t(item.idea)}</span>
          </button>
        ))}
      </DemoChoiceGroup>
      <p className="tr-visual-demo-guidance">{t("Escolha pela relação — horário, dia ou linguagem; traduzir “em” ao pé da letra não basta.")}</p>
      <p className="tr-visual-demo-example" aria-live="polite">{choice.phrase}</p>
    </DemoFrame>
  );
}

function ArticlesDemo() {
  const [selected, setSelected] = useState(0);
  const isNewReference = selected === 0;
  return (
    <DemoFrame title="Apresentar um bug e retomar esse mesmo bug">
      <DemoChoiceGroup label="Escolha a menção">
        <button type="button" className="tr-visual-choice" aria-pressed={isNewReference} onClick={() => setSelected(0)}>
          <strong>{t("Sem referência anterior")}</strong><span>{t("apresentar")}</span>
        </button>
        <button type="button" className="tr-visual-choice" aria-pressed={!isNewReference} onClick={() => setSelected(1)}>
          <strong>{t("Já mencionado")}</strong><span>{t("identificar")}</span>
        </button>
      </DemoChoiceGroup>
      <p className="tr-visual-demo-guidance" aria-live="polite">
        {isNewReference ? t("Se o contexto ainda não identifica o bug, apresente-o com a.") : t("Como o bug já foi identificado, retome com the.")}
      </p>
      <p className="tr-visual-demo-example" aria-live="polite">
        We found a bug. The bug was in the login flow.
      </p>
      <p className="tr-visual-demo-guidance">{t("Plural em sentido geral não leva artigo: “Services need monitoring.”")}</p>
    </DemoFrame>
  );
}

function TensesDemo() {
  const [selected, setSelected] = useState(1);
  const moments = [
    { label: "Evento concluído", clue: "in 2024", sentence: "I built the payment API in 2024.", reading: "In 2024 marca um período encerrado: use o passado simples." },
    { label: "Continua até hoje", clue: "since 2021", sentence: "I’ve worked here since 2021.", reading: "Since 2021 liga o início no passado a algo que continua verdadeiro." },
    { label: "Experiência sem data", clue: "sem dizer quando", sentence: "I’ve used Kafka in production.", reading: "Sem uma data, o present perfect pode indicar experiência; não significa sempre continuidade." },
  ];
  const moment = moments[selected];

  return (
    <DemoFrame title="O verbo acompanha o momento da história">
      <div className={`tr-visual-timeline tr-visual-timeline-${selected}`}>
        <div className="tr-visual-timeline-line" aria-hidden="true" />
        <DemoChoiceGroup label="Escolha um momento na linha do tempo">
          {moments.map((item, index) => (
            <button key={item.label} type="button" className="tr-visual-time-choice" aria-pressed={selected === index} onClick={() => setSelected(index)}>
              <span className="tr-visual-time-dot" aria-hidden="true" />
              <strong>{t(item.label)}</strong><small>{t(item.clue)}</small>
            </button>
          ))}
        </DemoChoiceGroup>
      </div>
      <p className="tr-visual-demo-guidance" aria-live="polite">{t(moment.reading)}</p>
      <p className="tr-visual-demo-example" aria-live="polite">{moment.sentence}</p>
    </DemoFrame>
  );
}

function ResponseStructureDemo() {
  const [selected, setSelected] = useState(0);
  const steps = [
    { label: "Afirmativa", sentence: "He deploys the service every Friday.", reading: "No presente simples, he recebe -s no verbo de ação." },
    { label: "Pergunta", sentence: "Does he deploy the service every Friday?", reading: "Na pergunta, does recebe o -s; o verbo de ação fica na forma base." },
    { label: "Negativa", sentence: "He doesn’t deploy the service on Fridays.", reading: "Na negativa, doesn’t recebe o -s; o verbo de ação fica na forma base." },
  ];
  const step = steps[selected];

  return (
    <DemoFrame title="Como a frase muda com does">
      <DemoChoiceGroup label="Escolha a forma da frase">
        {steps.map((item, index) => (
          <button key={item.label} type="button" className="tr-visual-choice" aria-pressed={selected === index} onClick={() => setSelected(index)}>
            <strong>{t(item.label)}</strong>
          </button>
        ))}
      </DemoChoiceGroup>
      <p className="tr-visual-demo-guidance" aria-live="polite">{t(step.reading)} {t("Este padrão é para verbos de ação; be funciona de outro jeito.")}</p>
      <p className="tr-visual-demo-example" aria-live="polite">{step.sentence}</p>
    </DemoFrame>
  );
}
