export const practiceCategories = [
  {
    key: "prepositions",
    title: "Preposições (in, on, at, for, to…)",
    explanation: "Em inglês cada situação pede uma preposição fixa, que muitas vezes não é a tradução direta do português: work on a project, in the team, at the company.",
    why: "É um dos deslizes que mais chamam a atenção de quem ouve.",
    examples: ["I worked on a payment project for two years.", "I'm interested in backend development.", "We deployed it at the end of the sprint."],
  },
  {
    key: "articles",
    title: "Artigos (a, an, the)",
    explanation: "Use a/an antes de uma coisa só citada pela primeira vez (a tool, an API) e the quando já se sabe qual é.",
    why: "Sem artigo a frase soa incompleta para um nativo.",
    examples: ["We built an API for the mobile app.", "It is a tool that we use every day.", "The service was slow, so we added a cache."],
  },
  {
    key: "verb-tenses",
    title: "Tempos verbais (passado, presente, desde quando)",
    explanation: "Projetos que terminaram vão no passado (I built, we used); algo que começou no passado e continua usa have + verbo: I have worked here since 2021.",
    why: "O tempo certo deixa claro o que você já fez e o que faz hoje.",
    examples: ["Last year I led the migration to AWS.", "I have worked with React for three years.", "Right now I maintain the billing service."],
  },
  {
    key: "verb-forms",
    title: "Formas do verbo (to + verbo, -ing, he/she + s)",
    explanation: "Depois de need, want e plan use to + verbo; para dizer o objetivo use to + verbo (to cache); com he, she e it o verbo ganha -s (the service runs).",
    why: "Formas erradas atrapalham a fluidez e a clareza das explicações.",
    examples: ["We needed to reduce the response time.", "I used Redis to cache the sessions.", "The job runs every night."],
  },
  {
    key: "word-choice",
    title: "Vocabulário e falsos amigos",
    explanation: "Algumas palavras parecem certas pelo português, mas soam estranhas ou mudam o sentido (pretend é fingir; actually é na verdade). Prefira a palavra que um dev nativo usaria.",
    why: "A palavra certa evita mal-entendidos e passa segurança.",
    examples: ["I plan to migrate the database next quarter.", "Actually, the bottleneck was the database.", "We did some research before choosing Kafka."],
  },
  {
    key: "sentence-structure",
    title: "Estrutura da frase (ordem e conexão das ideias)",
    explanation: "Frases curtas, na ordem sujeito + verbo + complemento, ficam mais claras; troque sequências de and por frases separadas ou por then, so e because.",
    why: "Respostas organizadas são mais fáceis de acompanhar numa entrevista.",
    examples: ["First we profiled the API. Then we added an index.", "The query was slow because it scanned the whole table.", "We fixed the bug, so the error rate dropped."],
  },
  {
    key: "plural-agreement",
    title: "Singular, plural e concordância",
    explanation: "Mais de um vai no plural (two services, many users) e o verbo combina com o sujeito: the tests pass, the test passes.",
    why: "Concordância certa deixa sua fala mais natural e precisa.",
    examples: ["We have three microservices in production.", "The users were happy with the new feature.", "Each request takes less than 100 ms."],
  },
  {
    key: "other",
    title: "Outros pontos",
    explanation: "Pontos que não se encaixam nos outros grupos; pratique com as suas próprias frases.",
    why: "Cada ajuste pequeno soma na impressão final.",
    examples: ["Could you repeat the question, please?", "Let me think about that for a second.", "That's a good point."],
  },
];

export const practiceCategoryKeys = practiceCategories.map(({ key }) => key);
export const practiceCategoryByKey = Object.fromEntries(practiceCategories.map((category) => [category.key, category]));

export function normalizePracticeAnswer(value) {
  return value.toLocaleLowerCase("en-US").replace(/\p{P}/gu, " ").replace(/\s+/g, " ").trim();
}
