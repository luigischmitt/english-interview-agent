# Frontend — English Interview Agent

Aplicação web para praticar entrevistas profissionais em inglês. A interface
é voltada inicialmente a profissionais brasileiros de tecnologia e separa a
prática da resposta em inglês da análise futura de áudio.

## O que está disponível hoje

- Página pública inicial, com links para criar conta e entrar.
- Autenticação Supabase: cadastro, login, recuperação e atualização de senha.
- Área protegida com configuração de entrevista, sequência fixa de perguntas,
  respostas escritas e tela de progresso. Após uma resposta, o entrevistador
  pode fazer no máximo um follow-up curto antes de continuar a sequência fixa;
  se o serviço estiver indisponível, a entrevista avança normalmente.
- Reprodução opcional da pergunta do entrevistador pelo backend de speech;
  o texto da pergunta sempre permanece visível.
- Captura opcional de microfone usando `AudioWorklet`. O navegador envia PCM
  mono s16le a 16 kHz em frames de 100 ms pelo WebSocket v2. Whisper Large V3
  Turbo transcreve janelas sequenciais de 10 segundos com 1 segundo de áudio
  sobreposto; o texto aparece durante a fala e o cliente consolida palavras
  repetidas entre janelas. VAD encerra após 2 segundos de silêncio; o botão
  manual continua disponível. A duração padrão máxima é 3 minutos, com limites
  de bytes, fila e sessões simultâneas configuráveis no backend. O áudio fica
  somente em memória e não é reproduzido nem salvo; falhas preservam texto já
  recebido e mantêm a resposta escrita disponível.
- Sessões e turnos de texto salvos nas tabelas Supabase quando a conta e a
  conexão estão disponíveis. As políticas RLS limitam os dados ao usuário.
- Pipeline de relatório final disponível como helpers: uma chamada em lote ao
  backend avalia conteúdo técnico e inglês escrito/transcrito; médias dos
  sinais experimentais do Azure são calculadas por dimensão, ignorando respostas
  indisponíveis e valores ausentes. A tabela privada `interview_feedback`
  persiste status, resumo Azure e análise estruturada, sem salvar áudio ou copiar
  a transcrição completa. A interface ainda não exibe esse relatório.

Não há captura de câmera ou avatar de entrevistador real. A transcrição de voz
aparece em segmentos durante a fala; isso não representa o relatório final,
que ainda não é exibido pela interface.
Os blocos visuais de câmera são apenas parte da sala de prática.

## Variáveis de ambiente

Crie `frontend/.env.local` (esse arquivo não deve ser commitado):

```bash
NEXT_PUBLIC_SUPABASE_URL=https://<seu-projeto>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<publishable-key>
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001
```

As duas primeiras variáveis habilitam o cliente browser/SSR do Supabase. Elas
serão expostas ao navegador; use somente a URL do projeto e a publishable key.
Nunca coloque `service_role`, senha, token privado ou outro segredo em uma
variável `NEXT_PUBLIC_`, no código do cliente ou em arquivos versionados.

`NEXT_PUBLIC_BACKEND_URL` aponta para a API de áudio e usa
`http://localhost:3001` por padrão. Para execução em Docker Compose, esse
valor já é definido pelo serviço `frontend` como `http://localhost:3001`.

### Quando o Supabase não está configurado

Sem `NEXT_PUBLIC_SUPABASE_URL` ou `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, a
raiz continua mostrando a página pública. Rotas de autenticação exibem uma
mensagem de configuração quando uma operação é tentada, e qualquer rota
protegida redireciona para `/login?reason=config`. Não existe usuário de
desenvolvimento criado automaticamente e não é possível salvar sessões sem
uma conta Supabase configurada.

## Fluxo local completo (Docker + Supabase)

O `compose.yaml` inicia apenas frontend, backend e Kokoro. Ele não inicia uma
instância do Supabase. Use um projeto Supabase hospedado ou o fluxo local do
Supabase CLI, aplicando a migration versionada em `supabase/migrations/` antes
de testar persistência. O projeto/CLI deve ser configurado separadamente; não
há URL, chave ou segredo no repositório.

1. Configure o projeto Supabase e aplique a migration de `interviews` e
   `interview_turns` conforme [`supabase/README.md`](../supabase/README.md).
2. Crie `frontend/.env.local` com as três variáveis acima.
3. Na raiz do repositório, inicie o ambiente:

   ```bash
   docker compose up --build
   ```

   Isso expõe o frontend em `http://localhost:3000`, o backend em
   `http://localhost:3001` e o Kokoro em `http://localhost:8880`.
4. Abra `http://localhost:3000`, crie/confirme uma conta no Supabase e entre.
   Inicie uma entrevista para verificar texto, áudio e persistência.
5. Verifique a saúde da API quando necessário:

   ```bash
   curl http://localhost:3001/health
   curl http://localhost:3001/api/v1/speech/health
   ```

6. Encerre os serviços com:

   ```bash
   docker compose down
   ```

O `SPEECH_PROVIDER=kokoro` usado pelo Compose faz o backend depender do
container Kokoro. Se o backend de speech estiver indisponível, a pergunta
continua visível e a entrevista pode prosseguir sem áudio.

## Executar somente o frontend

Com `frontend/.env.local` configurado:

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`. Para reprodução de perguntas, execute também o
backend (ou aponte `NEXT_PUBLIC_BACKEND_URL` para uma API compatível). Sem ele,
o texto continua disponível e a falha de áudio não bloqueia a prática.

## Persistência e falhas

Ao iniciar uma entrevista, o app tenta criar uma sessão privada no Supabase e
salvar cada pergunta e resposta escrita. Ao concluir, marca a sessão como
`completed`; ao sair antes do fim, tenta marcá-la como `abandoned`.

Se a autenticação, o banco ou uma gravação falhar, a interface informa a
degradação e deixa o candidato continuar no estado da página. Nesse caso,
dados que ainda não chegaram ao Supabase estão disponíveis somente durante a
sessão atual do navegador e podem ser perdidos ao recarregar/fechar a página;
eles não são uma cópia offline garantida. O estado exibido deve permanecer
“salvo localmente para esta sessão; sincronização precisa de atenção”, nunca
“salvo na conta”, quando a escrita falhou.

## Relatório final, áudio, transcrição e privacidade

Os helpers `src/lib/interview/report.ts` enviam ao endpoint
`/api/v1/thinking/report` somente configuração da vaga e pares ordenados de
pergunta/resposta. A rota não recebe ID de sessão e faz uma única chamada
estruturada ao Mistral. O conteúdo de relatório e os resumos de métricas Azure
são salvos em `interview_feedback`; RLS limita o acesso à sessão Supabase do
usuário. Os status são `pending`, `ready` e `unavailable`. Falhas na LLM não
impedem carregar ou salvar o resumo Azure disponível. A média ponderada por
duração de cada sinal inclui `sampleCount` e ignora valores nulos e avaliações
indisponíveis. O pipeline não copia a transcrição; apenas trechos curtos podem
aparecer como evidência no relatório.

## Áudio, transcrição e privacidade

O microfone é opcional. O navegador transmite PCM mono s16le a 16 kHz pelo
WebSocket v2. O backend retém áudio em memória até 3 minutos (por padrão), com
limites configuráveis de duração, bytes por resposta, fila por resposta e
sessões ativas. Janelas de 10 segundos com 1 segundo de overlap são enviadas
sequencialmente ao Whisper Large V3 Turbo; o cliente consolida e deduplica o
texto das janelas. Dois segundos de silêncio ou o botão manual concluem a
captura. O app não salva nem reproduz áudio. A transcrição textual pode ser
salva como turno da sessão privada. Quando Azure Pronunciation Assessment
está habilitado, cada janela é avaliada após a transcrição e as métricas são
agregadas com peso pela duração; são sinais segmentados e experimentais, não
um relatório geral de proficiência ou sotaque. Falhas posteriores do Whisper
preservam o texto já recebido e permitem continuar com a resposta escrita.

## Validação antes de abrir uma PR

No diretório `frontend/`, execute:

```bash
npm run lint
npm run build
```

Para validar também o serviço usado pelo fluxo completo, na raiz execute:

```bash
(cd backend && npm run typecheck && npm test)
```

Quando Docker e um projeto Supabase de teste estiverem disponíveis, valide
também login, recuperação de senha, criação/conclusão de uma sessão, falha de
speech e falha de persistência. Nunca use chaves privadas ou dados reais em
logs, commits ou ambientes de teste compartilhados.

## Stack

- Next.js com App Router e TypeScript
- Supabase Auth/SSR e Postgres com RLS
- Tailwind CSS, daisyUI e componentes locais
- AudioWorklet e WebSocket para captura PCM opcional e transcrição incremental
- Backend Express + Kokoro para fala do entrevistador
