// Fixed micro-lessons of the eight practice groups (no model call). Each rule is short on purpose: one "when", two
// examples a developer actually says in interviews and, when it helps, a memory tip. Rule ids ("group.rule") tag
// exercises so the feedback can point back to the rule that explains the mistake.

export const practiceLessons = [
  {
    key: "prepositions",
    title: "Preposições",
    subtitle: "at, on, in, for, to",
    intro: "Pense em zoom: at é um ponto, on é uma superfície, in é estar dentro de algo.",
    rules: [
      { id: "prepositions.at", label: "at", when: "Um ponto exato: horário, empresa, lugar específico.", examples: ["The daily is at 9 a.m.", "I work at Nubank."], tip: "Ponto no relógio ou no mapa → at." },
      { id: "prepositions.on", label: "on", when: "Dias, plataformas e aquilo em que você trabalha.", examples: ["I worked on the payments project.", "The code is on GitHub."], tip: "Trabalhar em um projeto é work on a project." },
      { id: "prepositions.in", label: "in", when: "Dentro de algo: meses, anos, cidades, times e linguagens.", examples: ["I joined the team in 2021.", "We wrote it in Python."], tip: "Período longo ou dentro de algo → in." },
      { id: "prepositions.for", label: "for", when: "Quanto tempo durou e para quem é algo.", examples: ["I worked there for three years.", "We built a dashboard for the sales team."], tip: "Para fazer algo não é for: é to + verbo (I used it to cache)." },
      { id: "prepositions.to", label: "to", when: "Destino e direção.", examples: ["We migrated the app to AWS.", "I report to the CTO."] },
      { id: "prepositions.combos", label: "Pares prontos", when: "Algumas palavras sempre vêm com a mesma preposição: decore o par.", examples: ["I'm responsible for the backend.", "I'm interested in distributed systems."], tip: "responsible for · interested in · good at · depend on · focus on" },
    ],
  },
  {
    key: "articles",
    title: "Artigos",
    subtitle: "a, an, the",
    intro: "Em inglês, uma coisa no singular quase nunca fica sem artigo.",
    rules: [
      { id: "articles.a-an", label: "a / an", when: "Uma coisa qualquer, citada pela primeira vez.", examples: ["I built an API for the app.", "It's a tool we use every day."], tip: "an antes de som de vogal: an API, an hour, an issue." },
      { id: "articles.the", label: "the", when: "Algo específico, que você e o entrevistador já sabem qual é.", examples: ["The API was slow at first.", "The team liked the new feature."] },
      { id: "articles.none", label: "Sem artigo", when: "Plural ou algo em geral, sem falar de um específico.", examples: ["Users expect fast apps.", "I enjoy working with data."], tip: "Falando de forma geral, sem artigo." },
    ],
  },
  {
    key: "verb-tenses",
    title: "Tempos verbais",
    subtitle: "passado, presente, desde quando",
    intro: "O tempo do verbo mostra se você já fez, ainda faz ou vai fazer.",
    rules: [
      { id: "verb-tenses.past", label: "Já terminou", when: "Projeto antigo, emprego anterior, algo com data.", examples: ["Last year I led the migration.", "We used Kafka in that project."], tip: "Tem last, ago ou um ano? Passado." },
      { id: "verb-tenses.perfect", label: "Desde quando", when: "Começou no passado e continua até hoje, com since ou for.", examples: ["I have worked here since 2021.", "I've used React for three years."], tip: "Ainda é verdade hoje + since/for → have + verbo." },
      { id: "verb-tenses.present", label: "Rotina e hoje", when: "O que você faz no trabalho atual e fatos que valem sempre.", examples: ["I maintain the billing service.", "The job runs every night."] },
      { id: "verb-tenses.future", label: "Planos", when: "O que vai acontecer: going to, will, plan to.", examples: ["We're going to migrate next quarter.", "I plan to learn Kotlin."] },
    ],
  },
  {
    key: "verb-forms",
    title: "Formas do verbo",
    subtitle: "to + verbo, -ing, he/she + s",
    intro: "O verbo muda de forma conforme a palavra que vem antes dele.",
    rules: [
      { id: "verb-forms.to", label: "to + verbo", when: "Para dizer o objetivo e depois de need, want, plan, decide, try.", examples: ["I used Redis to cache sessions.", "We needed to reduce latency."], tip: "Para fazer algo → to do, nunca for do." },
      { id: "verb-forms.ing", label: "verbo + ing", when: "Depois de preposição e de enjoy, finish, avoid, keep.", examples: ["I'm interested in learning Go.", "We finished migrating the database."] },
      { id: "verb-forms.s", label: "he / she / it + s", when: "No presente, com he, she, it ou uma coisa, o verbo ganha -s.", examples: ["The service runs on Kubernetes.", "She leads the platform team."], tip: "Uma coisa só fazendo algo hoje → verbo com s." },
      { id: "verb-forms.irregular", label: "Passados irregulares", when: "Alguns verbos mudam no passado.", examples: ["I built the API.", "We chose Postgres."], tip: "lead → led · build → built · choose → chose · write → wrote" },
    ],
  },
  {
    key: "word-choice",
    title: "Vocabulário",
    subtitle: "palavras que enganam",
    intro: "Algumas palavras parecem português, mas significam outra coisa em inglês.",
    rules: [
      { id: "word-choice.actually", label: "actually ≠ atualmente", when: "actually é na verdade; atualmente é currently.", examples: ["Currently I work with Go.", "Actually, the bottleneck was the database."] },
      { id: "word-choice.pretend", label: "pretend ≠ pretender", when: "pretend é fingir; para intenção use plan ou intend.", examples: ["I plan to migrate the database.", "We intend to open-source it."] },
      { id: "word-choice.realize", label: "realize ≠ realizar", when: "realize é perceber; realizar algo é do ou carry out.", examples: ["I realized the query was slow.", "We carried out a load test."] },
      { id: "word-choice.eventually", label: "eventually ≠ eventualmente", when: "eventually é no fim; de vez em quando é occasionally.", examples: ["Eventually we moved to microservices.", "Occasionally we deploy on Fridays."] },
      { id: "word-choice.do-make", label: "do ou make", when: "do para tarefas e research; make para decisões e mudanças.", examples: ["We did some research first.", "Then we made a decision."] },
      { id: "word-choice.natural", label: "Palavra mais natural", when: "Prefira a palavra que um dev nativo usaria no lugar da tradução literal.", examples: ["We laid the foundation of the system.", "The tool analyzes the images."] },
    ],
  },
  {
    key: "sentence-structure",
    title: "Estrutura da frase",
    subtitle: "ordem e conexão das ideias",
    intro: "Frases curtas e na ordem certa são mais fáceis de acompanhar numa entrevista.",
    rules: [
      { id: "sentence-structure.subject", label: "Sempre um sujeito", when: "Toda frase precisa de quem faz: I, we, it, they.", examples: ["We deployed it on Friday.", "It was slow because of the query."], tip: "Em português dá para omitir; em inglês, não." },
      { id: "sentence-structure.order", label: "Quem + ação + resto", when: "Sujeito, verbo e complemento, nessa ordem; adjetivo antes do substantivo.", examples: ["We built a fast API.", "I led a big migration."] },
      { id: "sentence-structure.short", label: "Frases curtas", when: "Troque uma corrente de and por duas ou três frases.", examples: ["First we tested it. Then we deployed it.", "The client liked it. They asked for more."] },
      { id: "sentence-structure.connectors", label: "Conectores", when: "because explica o motivo, so a consequência, but o contraste, then a sequência.", examples: ["It was slow because of the query, so we added an index.", "It worked, but it was expensive."] },
    ],
  },
  {
    key: "plural-agreement",
    title: "Plural e concordância",
    subtitle: "singular, plural e o verbo certo",
    intro: "Mais de um pede plural, e o verbo acompanha o sujeito.",
    rules: [
      { id: "plural-agreement.plural", label: "Plural com -s", when: "Mais de uma coisa: two, many, several, a lot of.", examples: ["We have three microservices.", "Many users asked for it."] },
      { id: "plural-agreement.verb", label: "Verbo combina", when: "Uma coisa → is, has, verbo com s; várias → are, have, verbo sem s.", examples: ["The service has three endpoints.", "The tests pass on every commit."] },
      { id: "plural-agreement.uncountable", label: "Sem plural", when: "data, information, feedback, software e research não ganham -s.", examples: ["We got a lot of feedback.", "The data is stored in S3."] },
    ],
  },
  {
    key: "other",
    title: "Outros pontos",
    subtitle: "expressões úteis em entrevista",
    intro: "Pequenos ajustes que deixam sua fala mais natural.",
    rules: [
      { id: "other.clarify", label: "Pedir para repetir", when: "Quando não entendeu a pergunta, peça com educação.", examples: ["Could you repeat the question, please?", "Do you mean the backend or the whole system?"] },
      { id: "other.time", label: "Ganhar tempo", when: "Para pensar sem ficar em silêncio.", examples: ["Let me think about that for a second.", "That's a good question."] },
      { id: "other.natural", label: "Forma natural", when: "Prefira a forma que um nativo usaria, mesmo quando a sua é entendível.", examples: ["I'm a strong fit for this role.", "I'd say my main strength is debugging."] },
    ],
  },
];

export const practiceLessonByKey = Object.fromEntries(practiceLessons.map((lesson) => [lesson.key, lesson]));

/** Every rule of every lesson, by id (for exercise and feedback tags). */
export const practiceRuleById = Object.fromEntries(practiceLessons.flatMap((lesson) => lesson.rules.map((rule) => [rule.id, rule])));

/** The compact rule list sent with an exercise request, so each exercise can be tagged with the rule it trains. */
export function lessonRulesForRequest(key) {
  return (practiceLessonByKey[key]?.rules ?? []).map((rule) => ({ id: rule.id, rule: `${rule.label}: ${rule.when}` }));
}
