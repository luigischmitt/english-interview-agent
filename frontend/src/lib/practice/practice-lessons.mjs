// Fixed lessons and exercises of the eight practice groups (no model call to teach or to build exercises).
// Each rule teaches in four steps: what it is (`when`), why it works that way (`explain`), the typical Brazilian mistake
// next to the right form (`wrong` → `right`) and real interview sentences with their meaning (`examples`). Exercises are
// fixed too: `choose` is graded locally; `spot` accepts the listed answers locally and only asks the model when the
// answer is none of them (another valid wording must not be marked wrong).

const ex = (en, pt) => ({ en, pt });

export const practiceLessons = [
  {
    key: "prepositions",
    title: "Preposições",
    subtitle: "at, on, in, for, to",
    intro: "Preposições quase nunca se traduzem ao pé da letra: \"em\" pode virar at, on ou in. O segredo é aprender pela situação, não pela tradução.",
    rules: [
      {
        id: "prepositions.at", label: "at", when: "Um ponto exato: horário, empresa, lugar específico.",
        explain: "Pense em um alfinete no mapa ou no relógio: at marca um ponto preciso. Por isso usamos at para horários (at 9 a.m.), para a empresa onde você trabalha (at Nubank) e para um lugar ou momento específico (at the office, at the end of the sprint).",
        wrong: "I work in Nubank.", right: "I work at Nubank.",
        examples: [ex("The daily is at 9 a.m.", "A daily é às 9h."), ex("We found the bug at the end of the sprint.", "Achamos o bug no fim da sprint.")],
        tip: "Alfinete no mapa ou no relógio → at.",
      },
      {
        id: "prepositions.on", label: "on", when: "Dias, plataformas e aquilo em que você trabalha.",
        explain: "On é \"em cima de\" uma superfície. Daí vêm três usos: dias e datas (on Monday), plataformas e telas (on GitHub, on mobile) e a expressão work on, que significa trabalhar em algo — um projeto, uma feature, um bug.",
        wrong: "I worked in the payments project.", right: "I worked on the payments project.",
        examples: [ex("I'm working on a new checkout flow.", "Estou trabalhando em um novo fluxo de checkout."), ex("The release is on Friday.", "O release é na sexta.")],
        tip: "Trabalhar em um projeto → work on a project.",
      },
      {
        id: "prepositions.in", label: "in", when: "Dentro de algo: meses, anos, cidades e linguagens.",
        explain: "In é \"dentro de\". Use quando algo está dentro de um período maior (in 2021, in March), de um lugar grande (in São Paulo, in Brazil) ou da linguagem e ferramenta em que algo foi feito (in Python, in React).",
        wrong: "I joined the company on 2021.", right: "I joined the company in 2021.",
        examples: [ex("We wrote the service in Go.", "Escrevemos o serviço em Go."), ex("I started my career in 2019.", "Comecei minha carreira em 2019.")],
        tip: "Mês, ano, cidade ou linguagem → in.",
      },
      {
        id: "prepositions.for", label: "for", when: "Quanto tempo durou e para quem é algo.",
        explain: "Use for com um período de tempo (for three years) e para dizer o destinatário (for the client). Cuidado com dois erros comuns: \"desde\" com data é since, não for; e \"para fazer algo\" é to + verbo, não for.",
        wrong: "I have used React since three years.", right: "I have used React for three years.",
        examples: [ex("I worked there for two years.", "Trabalhei lá por dois anos."), ex("We built a dashboard for the sales team.", "Fizemos um dashboard para o time de vendas.")],
        tip: "Quanto tempo? for + período. Desde quando? since + data.",
      },
      {
        id: "prepositions.to", label: "to", when: "Destino e direção.",
        explain: "To indica para onde algo vai, como uma seta: migrar para, enviar para, se reportar a alguém. Se tem movimento ou destino, é to.",
        wrong: "We migrated the app for AWS.", right: "We migrated the app to AWS.",
        examples: [ex("I report to the CTO.", "Eu me reporto ao CTO."), ex("We send the logs to Datadog.", "Mandamos os logs para o Datadog.")],
        tip: "Tem destino? → to.",
      },
      {
        id: "prepositions.combos", label: "Pares prontos", when: "Palavras que sempre vêm com a mesma preposição.",
        explain: "Algumas palavras sempre andam com a mesma preposição, e a tradução engana: \"responsável por\" é responsible for, não of. Não tente deduzir: decore o par inteiro como se fosse uma palavra só.",
        wrong: "I'm responsible of the backend.", right: "I'm responsible for the backend.",
        examples: [ex("I'm interested in distributed systems.", "Tenho interesse em sistemas distribuídos."), ex("It depends on the traffic.", "Depende do tráfego.")],
        tip: "responsible for · interested in · good at · depend on · focus on · experience with",
      },
    ],
    exercises: [
      { id: "prepositions.c1", ruleId: "prepositions.at", kind: "choose", sentence: "The daily meeting is ___ 9 a.m.", options: ["at", "on", "in"], answer: "at", why: "Horário exato é um ponto no relógio → at." },
      { id: "prepositions.c2", ruleId: "prepositions.on", kind: "choose", sentence: "I'm working ___ a new payment feature.", options: ["on", "in", "at"], answer: "on", why: "Trabalhar em algo é sempre work on." },
      { id: "prepositions.c3", ruleId: "prepositions.in", kind: "choose", sentence: "I started my career ___ 2019.", options: ["in", "on", "at"], answer: "in", why: "Ano é um período grande, você está dentro dele → in." },
      { id: "prepositions.c4", ruleId: "prepositions.for", kind: "choose", sentence: "I worked at that company ___ four years.", options: ["for", "since", "by"], answer: "for", why: "Quatro anos é a duração → for. Since seria com uma data (since 2020)." },
      { id: "prepositions.c5", ruleId: "prepositions.combos", kind: "choose", sentence: "I'm responsible ___ the payments API.", options: ["for", "of", "about"], answer: "for", why: "O par fixo é responsible for." },
      { id: "prepositions.c6", ruleId: "prepositions.on", kind: "choose", sentence: "The deploy is scheduled ___ Friday.", options: ["on", "in", "at"], answer: "on", why: "Dia da semana → on." },
      { id: "prepositions.s1", ruleId: "prepositions.to", kind: "spot", sentence: "We moved our database for AWS last year.", answer: "We moved our database to AWS last year.", why: "AWS é o destino da mudança → to." },
      { id: "prepositions.s2", ruleId: "prepositions.at", kind: "spot", sentence: "I work in Google as a backend engineer.", answer: "I work at Google as a backend engineer.", why: "A empresa onde você trabalha é um ponto específico → at." },
      { id: "prepositions.s3", ruleId: "prepositions.combos", kind: "spot", sentence: "I'm interested on machine learning.", answer: "I'm interested in machine learning.", accepted: ["I am interested in machine learning."], why: "O par fixo é interested in." },
      { id: "prepositions.s4", ruleId: "prepositions.in", kind: "spot", sentence: "We rewrote the service on Rust.", answer: "We rewrote the service in Rust.", why: "A linguagem em que algo é feito → in." },
    ],
  },
  {
    key: "articles",
    title: "Artigos",
    subtitle: "a, an, the",
    intro: "Em português às vezes dá para omitir o artigo (\"é ferramenta que usamos\"). Em inglês, uma coisa contável no singular quase sempre precisa de a, an ou the.",
    rules: [
      {
        id: "articles.a-an", label: "a / an", when: "Uma coisa qualquer, citada pela primeira vez.",
        explain: "A e an equivalem a \"um/uma\": servem para algo no singular que ainda não foi apresentado. A escolha entre os dois é pelo som, não pela letra: an antes de som de vogal (an API, an hour, an issue) e a antes de som de consoante (a user, a university).",
        wrong: "It's tool that we use every day.", right: "It's a tool that we use every day.",
        examples: [ex("I built an API for the mobile app.", "Construí uma API para o app."), ex("She is a senior engineer.", "Ela é engenheira sênior.")],
        tip: "Vale o som: an API (\"ei-pi-ai\"), a user (\"iú-zer\").",
      },
      {
        id: "articles.the", label: "the", when: "Algo específico, que os dois já sabem qual é.",
        explain: "The é \"o/a\" específico: use quando quem ouve já sabe de qual coisa você fala — porque você acabou de citar, porque só existe uma, ou porque o contexto deixa claro. Primeira vez é a; segunda vez é the.",
        wrong: "We added a cache, and a cache cut the latency.", right: "We added a cache, and the cache cut the latency.",
        examples: [ex("The API was slow at first.", "A API era lenta no começo."), ex("The team liked the new feature.", "O time gostou da nova feature.")],
        tip: "Primeira vez → a; já sabemos qual → the.",
      },
      {
        id: "articles.none", label: "Sem artigo", when: "Plural ou ideia geral.",
        explain: "Quando você fala de algo em geral — no plural ou com palavras como data, software e feedback — não use artigo. Em português dizemos \"os usuários querem apps rápidos\", mas em inglês a ideia geral fica sem the.",
        wrong: "The users want fast apps.", right: "Users want fast apps.",
        examples: [ex("I enjoy working with data.", "Gosto de trabalhar com dados."), ex("Good tests save time.", "Bons testes economizam tempo.")],
        tip: "Falando em geral? Sem the.",
      },
    ],
    exercises: [
      { id: "articles.c1", ruleId: "articles.a-an", kind: "choose", sentence: "I created ___ API to sync the orders.", options: ["an", "a", "the"], answer: "an", why: "API começa com som de vogal (\"ei\") → an." },
      { id: "articles.c2", ruleId: "articles.a-an", kind: "choose", sentence: "She is ___ software engineer at Itaú.", options: ["a", "an", "the"], answer: "a", why: "Profissão no singular leva a; software começa com som de consoante." },
      { id: "articles.c3", ruleId: "articles.the", kind: "choose", sentence: "We found a bug. ___ bug was in the login flow.", options: ["The", "A", "An"], answer: "The", why: "Já falamos desse bug → the." },
      { id: "articles.c4", ruleId: "articles.none", kind: "choose", sentence: "___ users expect fast responses.", options: ["(sem artigo)", "The", "A"], answer: "(sem artigo)", why: "Usuários em geral, no plural → sem artigo." },
      { id: "articles.c5", ruleId: "articles.a-an", kind: "choose", sentence: "It took ___ hour to fix it.", options: ["an", "a", "the"], answer: "an", why: "O h de hour é mudo; o som começa em vogal → an." },
      { id: "articles.s1", ruleId: "articles.a-an", kind: "spot", sentence: "It is tool that we use in production.", answer: "It is a tool that we use in production.", accepted: ["It's a tool that we use in production."], why: "Tool é contável e singular → precisa de a." },
      { id: "articles.s2", ruleId: "articles.a-an", kind: "spot", sentence: "I worked on project for a bank.", answer: "I worked on a project for a bank.", why: "Project é contável e singular → a project." },
      { id: "articles.s3", ruleId: "articles.none", kind: "spot", sentence: "We need an information about the user.", answer: "We need information about the user.", accepted: ["We need some information about the user."], why: "Information é incontável → nunca leva a/an." },
    ],
  },
  {
    key: "verb-tenses",
    title: "Tempos verbais",
    subtitle: "passado, presente, desde quando",
    intro: "O tempo do verbo conta a sua história: o que já terminou, o que continua até hoje, o que é rotina e o que vem pela frente.",
    rules: [
      {
        id: "verb-tenses.past", label: "Já terminou", when: "Projeto antigo, emprego anterior, algo com data.",
        explain: "Para algo que começou e terminou no passado use o passado simples: em geral verbo + ed (worked, used, deployed) ou a forma irregular (built, led, chose). Palavras como last, ago, yesterday ou um ano no passado são o sinal.",
        wrong: "Last year I lead the migration.", right: "Last year I led the migration.",
        examples: [ex("We used Kafka in that project.", "Usamos Kafka naquele projeto."), ex("Two years ago I built an API for a bank.", "Há dois anos construí uma API para um banco.")],
        tip: "Tem last, ago ou yesterday? Passado.",
      },
      {
        id: "verb-tenses.perfect", label: "Desde quando", when: "Começou no passado e continua até hoje.",
        explain: "Em português dizemos \"trabalho aqui desde 2021\" no presente. Em inglês, quando algo começou no passado e ainda é verdade, usamos have/has + o verbo no passado: I have worked here since 2021. Since vem com o ponto de início (since 2021); for, com a duração (for three years).",
        wrong: "I work here since 2021.", right: "I have worked here since 2021.",
        examples: [ex("I've used React for three years.", "Uso React há três anos."), ex("She has led the team since March.", "Ela lidera o time desde março.")],
        tip: "Ainda é verdade + since/for → have + verbo.",
      },
      {
        id: "verb-tenses.present", label: "Rotina e agora", when: "O que você faz hoje e o que está acontecendo agora.",
        explain: "Rotina e fatos do seu trabalho atual vão no presente simples (I maintain the billing service). Algo acontecendo neste momento ou nesta fase usa am/is/are + -ing (I'm working on the checkout now). É assim que o -ing mostra \"estar fazendo\".",
        wrong: "Right now I work on the checkout flow.", right: "Right now I'm working on the checkout flow.",
        examples: [ex("I maintain the billing service.", "Eu mantenho o serviço de cobrança."), ex("The job runs every night.", "O job roda toda noite.")],
        tip: "Rotina → presente simples; agora mesmo → am/is/are + ing.",
      },
      {
        id: "verb-tenses.future", label: "Planos", when: "O que vai acontecer.",
        explain: "Para planos já decididos use going to (we're going to migrate) ou plan to. Para previsões ou decisões na hora use will (I think it will scale). Depois de will o verbo vem puro, sem to.",
        wrong: "I will to learn Kotlin next year.", right: "I'm going to learn Kotlin next year.",
        examples: [ex("We're going to migrate next quarter.", "Vamos migrar no próximo trimestre."), ex("I think it will scale well.", "Acho que vai escalar bem.")],
        tip: "will + verbo puro: will learn, nunca will to learn.",
      },
    ],
    exercises: [
      { id: "verb-tenses.c1", ruleId: "verb-tenses.past", kind: "choose", sentence: "Last year I ___ the migration to AWS.", options: ["led", "lead", "have led"], answer: "led", why: "Last year → já terminou → passado. O passado de lead é led." },
      { id: "verb-tenses.c2", ruleId: "verb-tenses.perfect", kind: "choose", sentence: "I ___ here since 2021.", options: ["have worked", "work", "worked"], answer: "have worked", why: "Começou em 2021 e continua → have worked + since." },
      { id: "verb-tenses.c3", ruleId: "verb-tenses.past", kind: "choose", sentence: "We ___ Kafka in my previous job.", options: ["used", "use", "have used"], answer: "used", why: "Emprego anterior já terminou → passado simples." },
      { id: "verb-tenses.c4", ruleId: "verb-tenses.present", kind: "choose", sentence: "Right now I ___ on the checkout flow.", options: ["'m working", "worked", "work"], answer: "'m working", why: "Acontecendo agora → am + -ing." },
      { id: "verb-tenses.c5", ruleId: "verb-tenses.future", kind: "choose", sentence: "Next quarter we ___ migrate to Kubernetes.", options: ["are going to", "went to", "have"], answer: "are going to", why: "Plano já decidido → going to." },
      { id: "verb-tenses.s1", ruleId: "verb-tenses.perfect", kind: "spot", sentence: "I work with Python for five years.", answer: "I have worked with Python for five years.", accepted: ["I've worked with Python for five years.", "I have been working with Python for five years.", "I've been working with Python for five years."], why: "Começou há cinco anos e continua → have worked + for." },
      { id: "verb-tenses.s2", ruleId: "verb-tenses.past", kind: "spot", sentence: "Two years ago I build an API for a bank.", answer: "Two years ago I built an API for a bank.", why: "Two years ago → passado. O passado de build é built." },
      { id: "verb-tenses.s3", ruleId: "verb-tenses.past", kind: "spot", sentence: "Yesterday we deploy the new version.", answer: "Yesterday we deployed the new version.", why: "Yesterday → passado: deployed." },
      { id: "verb-tenses.s4", ruleId: "verb-tenses.future", kind: "spot", sentence: "I will to study for the AWS certification.", answer: "I will study for the AWS certification.", accepted: ["I'm going to study for the AWS certification.", "I am going to study for the AWS certification."], why: "Depois de will o verbo vem puro, sem to." },
    ],
  },
  {
    key: "verb-forms",
    title: "Formas do verbo",
    subtitle: "to + verbo, -ing, he/she + s",
    intro: "O mesmo verbo muda de forma dependendo da palavra que vem antes dele. Quatro casos aparecem o tempo todo em entrevistas.",
    rules: [
      {
        id: "verb-forms.to", label: "to + verbo", when: "Para dizer o objetivo, e depois de need, want, plan, decide, try.",
        explain: "Quando você explica para que fez algo (\"usei Redis para guardar sessões\"), o \"para\" vira to + verbo: I used Redis to cache sessions. Traduzir como for + verbo é o erro mais comum de brasileiros. O mesmo to aparece depois de need, want, plan, decide e try: we needed to reduce latency.",
        wrong: "I used Redis for cache the sessions.", right: "I used Redis to cache the sessions.",
        examples: [ex("We needed to reduce the latency.", "Precisávamos reduzir a latência."), ex("I decided to rewrite the module.", "Decidi reescrever o módulo.")],
        tip: "\"Para fazer algo\" → to do, nunca for do.",
      },
      {
        id: "verb-forms.ing", label: "verbo + -ing", when: "Depois de preposição (in, about, before, without…) e de enjoy, finish, avoid.",
        explain: "O -ing tem dois papéis. Você já conhece um: \"estar fazendo\" (I'm working). O outro é transformar o verbo em substantivo quando ele vem depois de uma preposição — in, at, about, for, before, after, without — ou de verbos como enjoy, finish, avoid e keep. \"Interessado em aprender\" → interested in learning.",
        wrong: "I'm interested in learn Go.", right: "I'm interested in learning Go.",
        examples: [ex("We finished migrating the database.", "Terminamos de migrar o banco."), ex("Before deploying, we run the tests.", "Antes de fazer o deploy, rodamos os testes.")],
        tip: "Depois de preposição, o verbo vai com -ing.",
      },
      {
        id: "verb-forms.s", label: "he / she / it + s", when: "No presente, uma pessoa ou coisa → verbo com -s.",
        explain: "No presente, quando quem faz a ação é he, she, it ou uma coisa no singular (the service, the API), o verbo ganha -s: the service runs, she leads. Com I, you, we e they, sem -s. É um detalhe pequeno, mas um nativo percebe na hora.",
        wrong: "The service run on Kubernetes.", right: "The service runs on Kubernetes.",
        examples: [ex("She leads the platform team.", "Ela lidera o time de plataforma."), ex("The API returns a JSON response.", "A API retorna uma resposta em JSON.")],
        tip: "Uma coisa só, no presente → verbo com s.",
      },
      {
        id: "verb-forms.irregular", label: "Passados irregulares", when: "Verbos que mudam no passado em vez de ganhar -ed.",
        explain: "Alguns dos verbos que devs mais usam não recebem -ed no passado; eles mudam de forma. Não existe regra: vale decorar os principais, porque você vai usá-los em quase toda resposta sobre projetos.",
        wrong: "We choosed Postgres for the project.", right: "We chose Postgres for the project.",
        examples: [ex("I built the API from scratch.", "Construí a API do zero."), ex("We found the bug in the cache layer.", "Achamos o bug na camada de cache.")],
        tip: "build → built · lead → led · choose → chose · write → wrote · find → found · run → ran",
      },
    ],
    exercises: [
      { id: "verb-forms.c1", ruleId: "verb-forms.to", kind: "choose", sentence: "I used a queue ___ the events.", options: ["to process", "for process", "processing"], answer: "to process", why: "Objetivo (para processar) → to + verbo." },
      { id: "verb-forms.c2", ruleId: "verb-forms.to", kind: "choose", sentence: "We need ___ the response time.", options: ["to reduce", "reduce", "reducing"], answer: "to reduce", why: "Depois de need → to + verbo." },
      { id: "verb-forms.c3", ruleId: "verb-forms.ing", kind: "choose", sentence: "I'm interested in ___ Rust.", options: ["learning", "learn", "to learn"], answer: "learning", why: "Depois da preposição in → verbo com -ing." },
      { id: "verb-forms.c4", ruleId: "verb-forms.s", kind: "choose", sentence: "The job ___ every night.", options: ["runs", "run", "running"], answer: "runs", why: "The job é uma coisa só, no presente → runs." },
      { id: "verb-forms.c5", ruleId: "verb-forms.irregular", kind: "choose", sentence: "Last month we ___ a new dashboard.", options: ["built", "builded", "build"], answer: "built", why: "Passado irregular: build → built." },
      { id: "verb-forms.c6", ruleId: "verb-forms.ing", kind: "choose", sentence: "We finished ___ the tests.", options: ["writing", "to write", "write"], answer: "writing", why: "Depois de finish → verbo com -ing." },
      { id: "verb-forms.s1", ruleId: "verb-forms.to", kind: "spot", sentence: "I created a script for automate the deploys.", answer: "I created a script to automate the deploys.", why: "Para automatizar (objetivo) → to automate." },
      { id: "verb-forms.s2", ruleId: "verb-forms.s", kind: "spot", sentence: "She lead the backend team.", answer: "She leads the backend team.", accepted: ["She led the backend team."], why: "She, no presente → leads (ou led, se for passado)." },
      { id: "verb-forms.s3", ruleId: "verb-forms.ing", kind: "spot", sentence: "Before deploy, we always run the tests.", answer: "Before deploying, we always run the tests.", why: "Depois da preposição before → deploying." },
    ],
  },
  {
    key: "word-choice",
    title: "Vocabulário",
    subtitle: "palavras que enganam",
    intro: "Algumas palavras inglesas parecem português, mas significam outra coisa — são os falsos amigos. Usar uma delas no sentido errado muda o que você quis dizer.",
    rules: [
      {
        id: "word-choice.actually", label: "actually ≠ atualmente", when: "actually = na verdade.",
        explain: "Actually serve para corrigir ou detalhar o que foi dito: \"na verdade\". Se você diz \"Actually I work at a fintech\", o entrevistador entende \"na verdade eu trabalho numa fintech\", como se você estivesse corrigindo algo. Para \"atualmente\", use currently ou right now.",
        wrong: "Actually I work at a fintech.", right: "Currently I work at a fintech.",
        examples: [ex("Currently I'm on the payments team.", "Atualmente estou no time de pagamentos."), ex("Actually, the bottleneck was the database.", "Na verdade, o gargalo era o banco.")],
        tip: "Atualmente → currently. Na verdade → actually.",
      },
      {
        id: "word-choice.pretend", label: "pretend ≠ pretender", when: "pretend = fingir.",
        explain: "Pretend significa fingir. \"I pretend to migrate the database\" soa como \"eu finjo que vou migrar o banco\" — o oposto do que você quer dizer. Para intenção use plan to, intend to ou I'd like to.",
        wrong: "I pretend to migrate the database next year.", right: "I plan to migrate the database next year.",
        examples: [ex("We intend to open-source the library.", "Pretendemos abrir o código da biblioteca."), ex("I'd like to lead a team someday.", "Gostaria de liderar um time um dia.")],
        tip: "Pretender → plan / intend. Pretend → fingir.",
      },
      {
        id: "word-choice.realize", label: "realize ≠ realizar", when: "realize = perceber.",
        explain: "Realize é \"perceber, se dar conta\". \"We realized a load test\" soaria como \"percebemos um teste de carga\". Para realizar no sentido de fazer, use do, run ou carry out.",
        wrong: "We realized a load test before the launch.", right: "We ran a load test before the launch.",
        examples: [ex("I realized the query was missing an index.", "Percebi que faltava um índice na query."), ex("We carried out the migration in two steps.", "Fizemos a migração em duas etapas.")],
        tip: "Perceber → realize. Realizar (fazer) → do, run, carry out.",
      },
      {
        id: "word-choice.eventually", label: "eventually ≠ eventualmente", when: "eventually = no fim, depois de um tempo.",
        explain: "Eventually conta como a história terminou: \"no fim, acabamos migrando\". Para \"eventualmente\" no sentido de \"de vez em quando\", use occasionally ou sometimes.",
        wrong: "Eventually we deploy on Fridays, but not often.", right: "Occasionally we deploy on Fridays, but not often.",
        examples: [ex("Eventually we moved to microservices.", "No fim, migramos para microsserviços."), ex("Occasionally the job fails at night.", "De vez em quando o job falha à noite.")],
        tip: "No fim → eventually. De vez em quando → occasionally.",
      },
      {
        id: "word-choice.do-make", label: "do × make", when: "do para tarefas; make para decisões e mudanças.",
        explain: "Os dois viram \"fazer\" em português, mas não se misturam. Do é para tarefas e atividades (do research, do a code review, do the tests). Make é para criar ou mudar algo: make a decision, make a change, make a mistake.",
        wrong: "We made a research before choosing Kafka.", right: "We did some research before choosing Kafka.",
        examples: [ex("I did the code review this morning.", "Fiz o code review hoje de manhã."), ex("We made a decision to rewrite it.", "Tomamos a decisão de reescrever.")],
        tip: "Tarefa → do. Decisão, mudança, erro → make.",
      },
    ],
    exercises: [
      { id: "word-choice.c1", ruleId: "word-choice.actually", kind: "choose", sentence: "___ I work as a backend developer at a fintech.", options: ["Currently", "Actually", "Eventually"], answer: "Currently", why: "Atualmente é currently; actually é \"na verdade\"." },
      { id: "word-choice.c2", ruleId: "word-choice.pretend", kind: "choose", sentence: "I ___ to learn Kubernetes this year.", options: ["plan", "pretend", "realize"], answer: "plan", why: "Pretend é fingir; para intenção use plan." },
      { id: "word-choice.c3", ruleId: "word-choice.realize", kind: "choose", sentence: "I ___ that the query was missing an index.", options: ["realized", "made", "pretended"], answer: "realized", why: "Perceber → realize." },
      { id: "word-choice.c4", ruleId: "word-choice.do-make", kind: "choose", sentence: "We ___ a decision to rewrite the service.", options: ["made", "did", "realized"], answer: "made", why: "Decisão → make a decision." },
      { id: "word-choice.c5", ruleId: "word-choice.do-make", kind: "choose", sentence: "Before choosing a framework, we ___ some research.", options: ["did", "made", "realized"], answer: "did", why: "Pesquisa é uma tarefa → do research." },
      { id: "word-choice.c6", ruleId: "word-choice.eventually", kind: "choose", sentence: "We tried many fixes and ___ we found the root cause.", options: ["eventually", "occasionally", "currently"], answer: "eventually", why: "No fim, depois de várias tentativas → eventually." },
      { id: "word-choice.s1", ruleId: "word-choice.pretend", kind: "spot", sentence: "I pretend to study for a cloud certification.", answer: "I plan to study for a cloud certification.", accepted: ["I intend to study for a cloud certification.", "I'd like to study for a cloud certification.", "I would like to study for a cloud certification."], why: "Pretend é fingir; intenção é plan ou intend." },
      { id: "word-choice.s2", ruleId: "word-choice.realize", kind: "spot", sentence: "We realized a migration of the whole database.", answer: "We carried out a migration of the whole database.", accepted: ["We did a migration of the whole database.", "We ran a migration of the whole database."], why: "Realize é perceber; para fazer use carry out, do ou run." },
      { id: "word-choice.s3", ruleId: "word-choice.do-make", kind: "spot", sentence: "We made a code review before merging.", answer: "We did a code review before merging.", why: "Code review é uma tarefa → do." },
    ],
  },
  {
    key: "sentence-structure",
    title: "Estrutura da frase",
    subtitle: "ordem e conexão das ideias",
    intro: "Em entrevista, frases curtas e bem ligadas mostram raciocínio claro. Quatro hábitos resolvem a maioria dos problemas.",
    rules: [
      {
        id: "sentence-structure.subject", label: "Sempre um sujeito", when: "Toda frase precisa de quem faz a ação.",
        explain: "Em português é normal dizer \"Fiz o deploy na sexta\" ou \"É rápido\", sem sujeito. Em inglês o sujeito é obrigatório: I, we, they ou, para coisas e situações, it. Sem ele, a frase soa quebrada.",
        wrong: "Is very important to write tests.", right: "It is very important to write tests.",
        examples: [ex("We deployed the app on Friday.", "Fizemos o deploy do app na sexta."), ex("It was slow because of the query.", "Estava lento por causa da query.")],
        tip: "Sem sujeito? Coloque I, we ou it.",
      },
      {
        id: "sentence-structure.order", label: "Adjetivo antes", when: "Sujeito + verbo + complemento; adjetivo antes do substantivo.",
        explain: "A ordem básica é quem + ação + resto: We built a new API. E, ao contrário do português (\"um projeto grande\"), o adjetivo vem antes do substantivo: a big project, a fast API.",
        wrong: "I worked on a project very complex.", right: "I worked on a very complex project.",
        examples: [ex("We built a fast API.", "Construímos uma API rápida."), ex("She writes clean code.", "Ela escreve código limpo.")],
        tip: "Adjetivo antes da coisa: a big project.",
      },
      {
        id: "sentence-structure.short", label: "Frases curtas", when: "Corte as correntes de and.",
        explain: "Sob pressão é comum emendar tudo com and (\"and then… and… and…\"). Quem ouve se perde. Divida em duas ou três frases curtas: fica mais claro e você ganha tempo para pensar no próximo passo.",
        wrong: "We tested it and then we deployed and the client used and liked it.", right: "We tested it. Then we deployed it. The client liked it.",
        examples: [ex("First we tested it. Then we deployed it.", "Primeiro testamos. Depois fizemos o deploy."), ex("The client liked it. They asked for more.", "O cliente gostou. Pediu mais.")],
        tip: "Mais de dois and seguidos? Corte em frases.",
      },
      {
        id: "sentence-structure.connectors", label: "Conectores", when: "because, so, but, then.",
        explain: "Conectores mostram o seu raciocínio, que é o que o entrevistador quer ouvir: because dá o motivo, so a consequência, but o contraste e then a sequência. Sem eles, as frases ficam soltas.",
        wrong: "The query was slow, we added an index.", right: "The query was slow, so we added an index.",
        examples: [ex("It was slow because of the query.", "Estava lento por causa da query."), ex("It worked, but it was expensive.", "Funcionou, mas era caro.")],
        tip: "Motivo → because · consequência → so · contraste → but",
      },
    ],
    exercises: [
      { id: "sentence-structure.c1", ruleId: "sentence-structure.connectors", kind: "choose", sentence: "The query was slow, ___ we added an index.", options: ["so", "because", "but"], answer: "so", why: "Adicionar o índice é a consequência → so." },
      { id: "sentence-structure.c2", ruleId: "sentence-structure.connectors", kind: "choose", sentence: "We changed the cache ___ it was using too much memory.", options: ["because", "so", "then"], answer: "because", why: "Usar memória demais é o motivo → because." },
      { id: "sentence-structure.c3", ruleId: "sentence-structure.connectors", kind: "choose", sentence: "It was fast, ___ it was expensive.", options: ["but", "so", "because"], answer: "but", why: "Rápido e caro se opõem → but." },
      { id: "sentence-structure.c4", ruleId: "sentence-structure.order", kind: "choose", sentence: "We built ___.", options: ["a fast API", "an API fast", "a API fast"], answer: "a fast API", why: "Adjetivo antes do substantivo: a fast API." },
      { id: "sentence-structure.s1", ruleId: "sentence-structure.subject", kind: "spot", sentence: "Is very important to write tests.", answer: "It is very important to write tests.", accepted: ["It's very important to write tests."], why: "Toda frase precisa de sujeito: it is." },
      { id: "sentence-structure.s2", ruleId: "sentence-structure.subject", kind: "spot", sentence: "Deployed the new version yesterday.", answer: "We deployed the new version yesterday.", accepted: ["I deployed the new version yesterday."], why: "Falta quem fez a ação: we ou I." },
      { id: "sentence-structure.s3", ruleId: "sentence-structure.order", kind: "spot", sentence: "I worked on a project very complex.", answer: "I worked on a very complex project.", why: "Adjetivo antes do substantivo: a very complex project." },
    ],
  },
  {
    key: "plural-agreement",
    title: "Plural e concordância",
    subtitle: "singular, plural e o verbo certo",
    intro: "Na fala rápida é fácil engolir o -s, mas em inglês ele muda o sentido: mais de um pede plural, e o verbo acompanha quem faz a ação.",
    rules: [
      {
        id: "plural-agreement.plural", label: "Plural com -s", when: "Mais de um → substantivo com -s.",
        explain: "Depois de números maiores que um e de palavras como many, several e a lot of, o substantivo vai para o plural: three services, many users. Na fala em português às vezes deixamos o plural só no artigo (\"os usuário\"); em inglês o -s precisa estar na palavra.",
        wrong: "We have many user in Brazil.", right: "We have many users in Brazil.",
        examples: [ex("We have three microservices.", "Temos três microsserviços."), ex("Several teams use the API.", "Vários times usam a API.")],
        tip: "Mais de um? Confira o -s.",
      },
      {
        id: "plural-agreement.verb", label: "Verbo combina", when: "Uma coisa → is/has/verbo com s; várias → are/have.",
        explain: "O verbo concorda com quem faz a ação. Uma coisa: is, has, was e verbo com -s (the service has, the test passes). Várias: are, have, were e verbo sem -s (the services have, the tests pass). Em frases longas, ache o sujeito principal antes de escolher.",
        wrong: "The service have three endpoints.", right: "The service has three endpoints.",
        examples: [ex("The tests pass on every commit.", "Os testes passam em todo commit."), ex("Our users are mostly in Brazil.", "Nossos usuários estão principalmente no Brasil.")],
        tip: "Um → is/has · vários → are/have",
      },
      {
        id: "plural-agreement.uncountable", label: "Sem plural", when: "data, information, feedback, software, research.",
        explain: "Algumas palavras são incontáveis em inglês: não ganham -s nem a/an, mesmo quando em português usamos plural (\"vários feedbacks\"). Para falar de quantidade use a lot of ou some: a lot of feedback, some information.",
        wrong: "We received many feedbacks from users.", right: "We received a lot of feedback from users.",
        examples: [ex("We got some useful feedback.", "Recebemos um feedback útil."), ex("The data is stored in S3.", "Os dados ficam no S3.")],
        tip: "feedback, data, information, software, research → sem -s",
      },
    ],
    exercises: [
      { id: "plural-agreement.c1", ruleId: "plural-agreement.verb", kind: "choose", sentence: "The service ___ three endpoints.", options: ["has", "have", "having"], answer: "has", why: "The service é uma coisa só → has." },
      { id: "plural-agreement.c2", ruleId: "plural-agreement.verb", kind: "choose", sentence: "The tests ___ on every commit.", options: ["pass", "passes", "passing"], answer: "pass", why: "The tests são vários → pass, sem -s." },
      { id: "plural-agreement.c3", ruleId: "plural-agreement.uncountable", kind: "choose", sentence: "We store a lot of ___ about the orders.", options: ["data", "datas", "a data"], answer: "data", why: "Data é incontável → sem -s e sem a." },
      { id: "plural-agreement.c4", ruleId: "plural-agreement.plural", kind: "choose", sentence: "We have five ___ in production.", options: ["services", "service", "servicies"], answer: "services", why: "Mais de um → services." },
      { id: "plural-agreement.s1", ruleId: "plural-agreement.plural", kind: "spot", sentence: "We have many client in Europe.", answer: "We have many clients in Europe.", why: "Many pede plural → clients." },
      { id: "plural-agreement.s2", ruleId: "plural-agreement.verb", kind: "spot", sentence: "Our users is mostly in Brazil.", answer: "Our users are mostly in Brazil.", why: "Users são vários → are." },
      { id: "plural-agreement.s3", ruleId: "plural-agreement.uncountable", kind: "spot", sentence: "We got a lot of feedbacks from the client.", answer: "We got a lot of feedback from the client.", why: "Feedback é incontável → sem -s." },
    ],
  },
  {
    key: "other",
    title: "Outros pontos",
    subtitle: "expressões úteis em entrevista",
    intro: "Algumas frases curtas ajudam a conduzir a entrevista com calma e naturalidade, mesmo quando você não entendeu algo ou precisa pensar.",
    rules: [
      {
        id: "other.clarify", label: "Pedir para repetir", when: "Quando não entendeu a pergunta.",
        explain: "Não entender uma pergunta é normal, até para nativos. Pedir com educação mostra segurança; chutar uma resposta para a pergunta errada passa uma impressão pior. Could you…? é a forma mais educada.",
        wrong: "Repeat, please.", right: "Could you repeat the question, please?",
        examples: [ex("Could you repeat the question, please?", "Você poderia repetir a pergunta?"), ex("Do you mean the backend or the whole system?", "Você quer dizer o backend ou o sistema todo?")],
        tip: "Could you…? soa sempre educado.",
      },
      {
        id: "other.time", label: "Ganhar tempo", when: "Para pensar sem ficar em silêncio.",
        explain: "Em vez de silêncio ou de \"éé…\", use uma frase curta enquanto organiza a resposta. O entrevistador entende que você está pensando, não travado.",
        wrong: "Hmm… hmm… hmm…", right: "Let me think about that for a second.",
        examples: [ex("Let me think about that for a second.", "Deixa eu pensar um segundo."), ex("That's a good question.", "Boa pergunta.")],
        tip: "Let me think… compra alguns segundos.",
      },
      {
        id: "other.natural", label: "Forma natural", when: "Construções que soam traduzidas.",
        explain: "Algumas frases são entendidas, mas soam traduzidas do português. A mais comum é a idade: em inglês você \"é\" a idade (I am 28 years old), não \"tem\".",
        wrong: "I have 28 years.", right: "I am 28 years old.",
        examples: [ex("I'm a good fit for this role.", "Tenho o perfil certo para esta vaga."), ex("My main strength is debugging.", "Meu principal ponto forte é debugar.")],
        tip: "Idade → I am … years old.",
      },
    ],
    exercises: [
      { id: "other.c1", ruleId: "other.clarify", kind: "choose", sentence: "Could you ___ the question, please?", options: ["repeat", "to repeat", "repeating"], answer: "repeat", why: "Depois de could you, o verbo vem puro: repeat." },
      { id: "other.c2", ruleId: "other.natural", kind: "choose", sentence: "I ___ 28 years old.", options: ["am", "have", "has"], answer: "am", why: "Idade em inglês usa be: I am 28 years old." },
      { id: "other.c3", ruleId: "other.time", kind: "choose", sentence: "Let me ___ about that for a second.", options: ["think", "thinking", "to think"], answer: "think", why: "Depois de let me, o verbo vem puro: think." },
      { id: "other.s1", ruleId: "other.natural", kind: "spot", sentence: "I have 30 years and I live in Recife.", answer: "I am 30 years old and I live in Recife.", accepted: ["I'm 30 years old and I live in Recife.", "I am 30 and I live in Recife.", "I'm 30 and I live in Recife."], why: "Idade usa be: I am 30 years old." },
      { id: "other.s2", ruleId: "other.clarify", kind: "spot", sentence: "Can you repeat? I no understood.", answer: "Can you repeat that? I didn't understand.", accepted: ["Could you repeat that? I didn't understand.", "Can you repeat that, please? I didn't understand.", "Could you repeat that, please? I didn't understand."], why: "Negação no passado usa didn't + verbo: I didn't understand." },
    ],
  },
];

export const practiceLessonByKey = Object.fromEntries(practiceLessons.map((lesson) => [lesson.key, lesson]));

/** Every rule of every lesson, by id (for exercise and feedback tags). */
export const practiceRuleById = Object.fromEntries(practiceLessons.flatMap((lesson) => lesson.rules.map((rule) => [rule.id, rule])));

/** The compact rule text sent with a grading request, so the model explains the mistake with the lesson's own reason. */
export function ruleTextForRequest(ruleId) {
  const rule = practiceRuleById[ruleId];
  return rule ? `${rule.label}: ${rule.when} ${rule.explain}`.slice(0, 240) : null;
}

/** The compact rule list of one lesson. */
export function lessonRulesForRequest(key) {
  return (practiceLessonByKey[key]?.rules ?? []).map((rule) => ({ id: rule.id, rule: `${rule.label}: ${rule.when}` }));
}

const normalize = (value) => String(value ?? "").toLocaleLowerCase("en-US").replace(/[’']/gu, "'").replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/gu, " ").trim();

/** Local check of a fixed exercise: a chosen option, or a corrected sentence matching the answer or an accepted variant. */
export function checkFixedAnswer(exercise, answer) {
  const given = normalize(answer);
  if (!given) return false;
  return [exercise.answer, ...(exercise.accepted ?? [])].some((candidate) => normalize(candidate) === given);
}

/**
 * Picks a practice round: up to `ownCount` of the person's own sentences first, then fixed exercises not done recently,
 * one per rule where possible and alternating choose and spot. `random` is injectable for tests.
 */
export function pickPracticeRound({ key, ownErrors = [], recentIds = [], size = 5, ownCount = 0, chooseShare = 0.6, random = Math.random }) {
  const lesson = practiceLessonByKey[key];
  const own = ownErrors.slice(0, Math.min(ownCount, size)).map((error, index) => ({
    id: `own.${index}`, ruleId: null, kind: "fix", sentence: error.evidence, answer: error.rephrased, accepted: [], why: null,
  }));
  const recent = new Set(recentIds);
  const shuffled = [...(lesson?.exercises ?? [])]
    .map((exercise) => ({ exercise, order: random() }))
    .sort((a, b) => a.order - b.order)
    .map(({ exercise }) => exercise);
  const pool = [...shuffled.filter((exercise) => !recent.has(exercise.id)), ...shuffled.filter((exercise) => recent.has(exercise.id))];
  const picked = [];
  const usedRules = new Set();
  const room = () => size - own.length - picked.length;
  // Most items are multiple choice (direct, instant); the rest ask to rewrite a sentence with one known mistake.
  const chooseTarget = Math.round((size - own.length) * chooseShare);
  const count = (kind) => picked.filter((exercise) => exercise.kind === kind).length;
  const wanted = (exercise) => exercise.kind === "choose" ? count("choose") < chooseTarget : count("spot") < size - own.length - chooseTarget;
  // First pass: a new rule each time, alternating kinds when possible; second pass: fill what is left.
  for (const exercise of pool) {
    if (room() <= 0) break;
    const lastKind = picked[picked.length - 1]?.kind;
    if (usedRules.has(exercise.ruleId) || exercise.kind === lastKind || !wanted(exercise)) continue;
    picked.push(exercise);
    usedRules.add(exercise.ruleId);
  }
  for (const exercise of pool) {
    if (room() <= 0) break;
    if (!picked.includes(exercise) && wanted(exercise)) picked.push(exercise);
  }
  for (const exercise of pool) {
    if (room() <= 0) break;
    if (!picked.includes(exercise)) picked.push(exercise);
  }
  return [...own, ...picked];
}
