# Frontend — English Interview Agent

Aplicação web para praticar entrevistas profissionais em inglês. A interface
é voltada inicialmente a profissionais brasileiros de tecnologia e separa a
prática da resposta em inglês da análise futura de áudio.

## O que está disponível hoje

- Página pública inicial, com links para criar conta e entrar.
- Autenticação Supabase: cadastro, login, recuperação e atualização de senha.
- As chamadas ao backend (HTTP e WebSocket de transcrição) levam o access token da sessão Supabase; se o backend responder 401, a interface avisa que a sessão expirou e oferece o link para entrar novamente.
- Área protegida com cargo, senioridade, foco e duração (5, 10, 15 ou 25
  minutos), sem contagem fixa de perguntas. A sala respeita o tempo, permite
  concluir uma resposta já iniciada e encerra sem repetir o banco interno de
  oito perguntas. Após uma resposta, pode haver no máximo um follow-up curto.
- A abertura menciona cargo, senioridade, foco e duração configurados sem
  instruções genéricas como “Take your time”. Após cada resposta final, o
  entrevistador procura primeiro um follow-up útil, mas só o faz quando há um
  ponto seguro e relacionado para aprofundar. O entrevistador pode introduzir a
  pergunta com uma ponte curta (até 220 caracteres, escrita por uma segunda
  chamada do backend) baseada na resposta, ou com uma transição neutra (também no fallback local), sem
  elogios e sem repetir as últimas pontes. Perguntas já feitas e contextos
  equivalentes são enviados como histórico para evitar repetição; a sequência
  fixa continua como fallback, pulando perguntas que repetem contexto já
  coberto. Ao concluir, o entrevistador se despede em voz
  e legenda antes de iniciar o relatório.
- Reprodução opcional da introdução e perguntas pelo backend Kokoro, legendas
  independentes e captura automática opcional após o áudio. Falha de áudio ou
  autoplay mantém o texto e a opção de iniciar o microfone manualmente.
- Prévia local opcional da câmera do candidato. O vídeo não é enviado nem
  persistido; a presença do entrevistador é apenas tipográfica/sonora, sem
  avatar ou câmera simulada.
- Respostas somente por voz usando `AudioWorklet`. O microfone pode iniciar
  automaticamente após a pergunta ou manualmente; não há resposta digitada. Com
  `TRANSCRIPTION_PROVIDER=cartesia` no backend, a fala aparece como legenda ao
  vivo ("VOCÊ", trecho já fechado em tinta normal e trecho em andamento em tom
  esmaecido) abaixo do bloco "Você", opção "Legenda da sua fala" ligada por
  padrão na configuração. A legenda é só de exibição: não é salva, enviada nem
  usada no relatório. Com Whisper não há legenda. O navegador envia PCM mono s16le a
  16 kHz em frames de aproximadamente 100 ms pelo WebSocket v2. Após detectar
  3,5 segundos de silêncio, o backend mantém uma janela automática e reversível
  de 1,5 segundo, continuando a receber áudio; se a fala recomeçar nesse
  intervalo, a resposta continua. Sem retomada, a captura termina em
  aproximadamente 5,3 segundos desde o início do silêncio, incluindo a
  confirmação de atividade. Atividade ambígua tem
  tolerância limitada de 8 segundos para preservar fala baixa sem manter a
  captura aberta indefinidamente. Não há botão
  para finalizar a resposta manualmente.
  Ao finalizar, o backend transcreve o áudio acumulado em uma única chamada ao
  Whisper Large V3 Turbo. Uma transcrição final e não vazia é submetida
  automaticamente ao concluir o processamento; a interface anuncia o estado
  sem exibir o texto reconhecido. O cronômetro de gravação não é anunciado a
  cada atualização. O áudio é mantido temporariamente em memória, sem gravação
  em disco, reprodução ou persistência.
  Cada resposta tem limite padrão de 180
  segundos e 6 MiB; cada processo aceita até 8 capturas, 4 transcrições
  simultâneas e uma fila de até 4 respostas finalizadas. Uma fila cheia produz
  um erro recuperável. Falhas oferecem nova tentativa e ações explícitas para
  pular a pergunta ou encerrar a prática.
- Sessões e transcrições finais submetidas são salvas nas tabelas Supabase quando a conta e a
  conexão estão disponíveis. As políticas RLS limitam os dados ao usuário.
- Relatório final em português disponível ao concluir: uma chamada em lote ao
  backend avalia conteúdo técnico e comunicação em inglês a partir das
  transcrições enviadas. Cada ponto técnico, observação de inglês e exercício
  priorizado cita a resposta e um trecho literal; observações de inglês também
  incluem uma reformulação concreta. Se a análise falhar, perguntas e respostas
  enviadas continuam visíveis sem serem apresentadas como análise detalhada.
  Sem respostas, o relatório informa a ausência de evidências sem solicitar
  uma análise. Médias dos
  sinais experimentais do Azure são calculadas por dimensão, ignorando respostas
  indisponíveis e valores ausentes. A sala aguarda avaliações pendentes por até
  10 segundos ao preparar o relatório, sem bloquear a entrevista; resultados Azure tardios atualizam as
  médias e a sincronização. A tabela privada `interview_feedback`
  persiste status, resumo Azure e análise estruturada, sem salvar áudio ou copiar
  a transcrição completa. Se a sincronização falhar, o relatório continua visível
  localmente.

O estado da câmera e do microfone é temporário e os tracks são encerrados ao
desligar, sair da sala ou desmontar o componente. As legendas visíveis durante
a entrevista são as do entrevistador e, quando o backend usa Cartesia Ink-2 e a
opção está ligada, a legenda ao vivo da sua fala (mensagem `caption` do
WebSocket, `aria-live="off"`, sem animação de digitação, limpa ao finalizar,
cancelar ou trocar de pergunta). O texto parcial nunca é persistido; o texto
final reconhecido (`complete`) permanece a única fonte para envio, raciocínio da
entrevista e persistência autorizada. Uma transcrição final não vazia é submetida
automaticamente quando o processamento termina.

## Variáveis de ambiente

Para o deploy em produção (Vercel + Cloud Run), veja [`docs/deploy.md`](../docs/deploy.md) (em inglês).

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
o texto da pergunta continua disponível e a falha de reprodução não bloqueia a
prática por voz.

### Aviso de microfone sem áudio

Durante a gravação, se nenhum sinal de áudio chegar em 3 s (RMS < 0,003) ou se
o servidor não detectar fala em 10 s, a captura mostra um aviso discreto com o
botão "Tentar de novo". O botão descarta a tentativa (envia `cancel`, libera o
microfone e o `AudioContext`; nada é transcrito ou salvo) e inicia uma nova
captura para a mesma pergunta, sem contar como resposta. O aviso some quando a
fala é detectada. A lógica fica em `src/lib/interview/silent-mic-detector.mjs`.

### Microfone contínuo e conexão antecipada (handoff sem espera)

O candidato deve poder responder no instante em que o entrevistador termina de
falar. Por isso a sala abre o microfone **uma vez por entrevista**
(`getUserMedia` + um `AudioContext` + worklet, em `src/lib/interview/mic-engine.mjs`)
logo ao entrar, mede o ruído de fundo enquanto o entrevistador ainda não fala e
só o libera ao encerrar, sair ou desmontar a sala. Se a permissão for negada ou
o dispositivo falhar, a captura volta ao comportamento anterior (um microfone por
resposta, com a mesma mensagem de erro). Se a trilha terminar (`ended`) ou ficar
muda (`mute`), o motor reabre o microfone uma vez; "Tentar de novo" reabre o
dispositivo quando o aviso é de microfone sem sinal e reaproveita o motor quando
ele está saudável.

Quando o último trecho da fala do entrevistador está terminando (ou ao começar,
se for curto; `onFinalChunkStarted`, até 3 s antes do fim), a sala abre o
WebSocket de transcrição, envia `start` com um token novo e espera `ready`, sem
enviar áudio nem `level`. No fim da reprodução o áudio e os níveis passam a fluir
nesse mesmo instante (`src/lib/interview/answer-stream.mjs`). Se o socket ainda
não estiver pronto, apenas os quadros capturados depois do fim da fala ficam em
um buffer limitado e são enviados em ordem; se a pré-conexão falhar, uma nova
conexão é aberta uma vez. Pular, encerrar ou sair antes do fim da fala envia
`cancel` e fecha o socket pré-aberto. Uma conexão ociosa não consome áudio
cobrado; se o provedor fechar uma conexão ociosa, o backend usa Whisper (como em
qualquer falha do Cartesia).

**Privacidade:** o navegador mantém o indicador de microfone ligado, mas nenhum
quadro de áudio é guardado, enviado ou persistido fora de uma janela de resposta.
Fora dela os quadros são descartados na primeira linha do tratamento do worklet;
ao começar a fala do entrevistador a captura é interrompida à força; o ruído de
fundo é medido apenas com o entrevistador em silêncio; a sala mostra o aviso
"Microfone ativo durante a entrevista — só enviamos áudio durante as suas
respostas.".

**Medição:** com `sessionStorage.setItem("english-interview:handoff-timing", "1")`,
o console também registra `interview_listening_handoff` com
`playbackEndedToListeningMs` (do fim da fala do entrevistador até o estado
"ouvindo") e `preconnected`. Sem conteúdo, desabilitada por padrão.

### Medir o handoff até a próxima fala (diagnóstico local)

Para habilitar uma medição opt-in no navegador, abra o console do DevTools e
execute `sessionStorage.setItem("english-interview:handoff-timing", "1")` antes
de iniciar uma nova entrevista. Após a primeira fala do entrevistador que segue
uma resposta, o console registra um objeto JSON `interview_handoff_timing` com
durações totais e por etapa: finalização/VAD, fila, Whisper, decisão, síntese e
início da reprodução (mais `prepared: true` quando a próxima pergunta foi preparada durante a espera, veja abaixo). Para desabilitar, execute
`sessionStorage.removeItem("english-interview:handoff-timing")` e recarregue a
página. A medição não registra nem inclui áudio, transcrição, IDs de sessão ou
segredos; fica desabilitada por padrão e dura apenas a sessão da aba.

Para medir a abertura da entrevista, execute
`sessionStorage.setItem("english-interview:opening-timing", "1")` antes de
iniciar uma nova entrevista. O console registra uma única linha
`interview_opening_timing` com os tempos numéricos de síntese e do fim da síntese
até o início da reprodução. A medição fica desabilitada por padrão; remova a
chave da sessão para desabilitá-la.

### Voz do entrevistador por frase

A fala do entrevistador é sintetizada em blocos (`groupInterviewerSentences`),
ajustados ao Kokoro auto-hospedado (~1,5 s para 25 caracteres, ~4 s para 100; pedidos
paralelos disputam a mesma CPU e todos ficam lentos):

- o primeiro bloco é curto: uma primeira frase com mais de 70 caracteres é dividida na
  primeira fronteira de oração (`, ` `; ` ` — ` `: `) que deixe 20 a 70 caracteres na
  primeira parte; sem fronteira, a frase fica inteira. As legendas continuam mostrando
  a frase inteira durante as duas partes;
- os demais blocos juntam frases até 40 caracteres, sem dividir frases e sem passar de
  ~140 caracteres;
- um pedido por vez: o bloco 1 é pedido na hora e o bloco N+1 só quando o áudio do
  bloco N chegou (não quando termina de tocar). O pré-aquecimento
  (`prewarmInterviewerSpeech`) usa a mesma ordem, os mesmos blocos e corpos, então a
  reprodução reaproveita blobs e pedidos em andamento.

Cada bloco toca em ordem com o próximo `Audio` já carregado para evitar pausas. Se um
bloco falhar, a reprodução termina como indisponível e o texto continua visível;
cancelar aborta o pedido pendente. A abertura é pré-sintetizada ao confirmar a
configuração (antes de a sala montar).

### Voz do navegador como alternativa

O TTS do OpenRouter às vezes trava. Se o áudio do primeiro bloco não chegar em
4 s (`FIRST_AUDIO_FALLBACK_MS`) ou o pedido falhar, `playInterviewerSegments`
descarta o áudio de rede e fala a fala inteira com a Web Speech API
(`src/lib/interview/browser-voice.mjs`, en-US, voz natural escolhida por
heurística e em cache, uma frase por `SpeechSynthesisUtterance`). Se um bloco
posterior falhar ou passar de 4 s, só as frases restantes usam a voz do
navegador. As legendas (`onSegment`), `onPlaybackStarted` e
`onFinalChunkStarted` (pré-conexão do microfone, ENG-106) continuam disparando e o
resultado traz `voice: "browser"`; a sala mostra um aviso uma vez por entrevista.
Sem `speechSynthesis`, a reprodução fica indisponível em 4 s com mensagem em
português e o texto da pergunta continua na tela. O teste de áudio da
configuração usa o mesmo fallback e tem o botão "Ouvir voz do navegador".

O cooldown só vale para falha real. Quando o prazo de 4 s estoura, o pedido em andamento
não é abortado: termina em segundo plano (limite de 20 s, `BACKGROUND_REQUEST_TIMEOUT_MS`)
só para revelar o resultado. Se chegar com sucesso, a rede é marcada saudável (sem
cooldown) e o áudio atrasado é descartado, nunca tocado; se falhar ou estourar o limite,
o cooldown é armado. Erros HTTP antes do prazo armam o cooldown na hora.

Depois de uma falha real da rede, a voz do navegador fica "pegajosa" por 2 min (`NETWORK_VOICE_COOLDOWN_MS`): as falas seguintes (e o teste de áudio) usam o navegador na hora, sem esperar 4 s nem chamar `/speech`, e o pré-aquecimento fica desligado; depois do cooldown a rede é tentada de novo, e um sucesso limpa o estado (401/403 não contam como falha de voz).

### Prontidão da voz do entrevistador

O dashboard, a configuração e a sala chamam `POST /api/v1/speech/warmup` (sem bloquear nada). Na configuração, com áudio ligado, uma linha `role="status"` consulta `GET /api/v1/speech/warmup-status` a cada 3 s (para quando a voz fica pronta, ao desmontar ou após 2 min) e mostra "Preparando…", "Voz do entrevistador pronta" ou o aviso de voz do navegador; nunca impede de iniciar. Lógica pura em `src/lib/interview/voice-readiness.mjs`.

### Preparação antecipada da próxima pergunta (Cartesia)

Com `TRANSCRIPTION_CARTESIA_PREPARE_AFTER_MS` ativo no backend, depois de um
fim de turno sem nova fala o backend envia `answer-provisional` com a
transcrição provisória da resposta. O navegador chama `decideNextTurn` com as
mesmas entradas que usaria ao enviar a resposta e, em seguida, pré-sintetiza o
áudio da próxima fala (`prewarmInterviewerSpeech`; o blob pronto fica reutilizável
por 30 s). Só a preparação mais recente é mantida: ela é abortada quando chega
outra transcrição provisória, quando a fala é retomada (`speech-resumed` ou
legenda parcial não vazia), ao pular, sair ou desmontar a sala. No `complete`, a
decisão preparada só é usada se a transcrição final for igual (após `trim`) à
provisória e as entradas da decisão forem idênticas; caso contrário é descartada
e o caminho normal roda. O console registra, sem conteúdo, o evento
`interview_next_turn_preparation` com `prepared_used` ou `prepared_discarded` e
as contagens acumuladas (`used`, `discarded`). Sem legendas, uma nova fala do
Ink-2 sem pausa local só é percebida no `complete` (a preparação é descartada
por transcrição diferente).

## Persistência e falhas

Ao iniciar uma entrevista, o app tenta criar uma sessão privada no Supabase e
salvar cada transcrição final de voz enviada. Perguntas puladas não criam turnos
de resposta. Ao concluir, marca a sessão como
`completed`; ao sair antes do fim, tenta marcá-la como `abandoned`.

Se a autenticação, o banco ou uma gravação falhar, a interface informa a
degradação e deixa o candidato continuar no estado da página. Nesse caso,
dados que ainda não chegaram ao Supabase estão disponíveis somente durante a
sessão atual do navegador e podem ser perdidos ao recarregar/fechar a página;
eles não são uma cópia offline garantida. Quando sincronizada, a interface
informa “sessão salva na conta”. Se a sincronização não estiver disponível,
informa “salva apenas no estado local da sessão; sincronização pendente”.

## Relatório final, áudio, transcrição e privacidade

Para reduzir a espera ao final, cada resposta enviada dispara em segundo plano
(sem bloquear a entrevista) `requestInterviewTurnAnalysis`
(`/api/v1/thinking/report/turn`, prazo de 25 s; cancelado ao sair ou desmontar).
Uma análise que falha é repetida uma vez em segundo plano após ~1,5 s
(`analyzeTurnWithRetry`; sem retry se cancelada). Ao encerrar,
`resolveReportAtEnd` (`report-incremental.mjs`) aguarda até 12 s (em paralelo à
espera da Azure) e, para cada resposta ainda sem análise, pede a análise de novo
em paralelo com prazo de 20 s — exceto quando mais da metade estiver faltando,
caso em que vai direto ao relatório completo; quando todas existem,
`requestInterviewConsolidation`
(`/report/consolidate`, prazo de 30 s) devolve o mesmo formato `v2`. Se alguma
análise continuar faltando ou a consolidação falhar, o fluxo usa o relatório completo
(`requestInterviewReport`) como antes. Persistência, seção Azure e textos da UI
não mudam; os logs `[interview-report]` indicam `path` (`incremental` ou
`fallback`), `retried`, `missingAtEnd` e `recoveredAtEnd`, sem conteúdo.

Os helpers `src/lib/interview/report.ts` enviam ao endpoint
`/api/v1/thinking/report` somente configuração da vaga e pares ordenados de
pergunta/resposta. A rota não recebe ID de sessão e faz uma única chamada
estruturada ao Mistral com deadline de 65 segundos no navegador e 30 segundos
no backend (configurável até 60 segundos). O conteúdo de relatório e os resumos de métricas Azure
são salvos em `interview_feedback`; RLS limita o acesso à sessão Supabase do
usuário. Os status são `pending`, `ready` e `unavailable`. Falhas na LLM não
impedem carregar ou salvar o resumo Azure disponível. A média ponderada por
duração de cada sinal inclui `sampleCount` e ignora valores nulos e avaliações
indisponíveis. O pipeline não copia a transcrição; apenas trechos curtos podem
aparecer como evidência no relatório. A versão `v2` exige associação da
evidência à resposta correta e remove itens opcionais cuja evidência não possa
ser validada, preservando as demais partes válidas.

## Áudio, transcrição e privacidade

O navegador transmite frames PCM mono s16le a 16 kHz pelo WebSocket v2. Durante
a captura, o backend acumula o áudio somente na memória e aplica limites de 180
segundos e 6 MiB por resposta. Há no máximo 8 sessões de captura por processo;
após finalizar, até 4 chamadas Whisper Large V3 Turbo podem executar ao mesmo
tempo e até 4 respostas finalizadas podem aguardar na fila. Se a fila estiver
cheia, a sala informa que a transcrição está indisponível e permite gravar de
novo, pular a pergunta ou encerrar a prática. A fila pode fazer a resposta
esperar brevemente; a interface indica “Processando sua resposta”.

O VAD sinaliza 3,5 segundos de silêncio e o backend mantém a captura por mais
1,5 segundo, ainda recebendo áudio. Se confirmar fala ou atividade ambígua nesse
intervalo, cancela a finalização e recomeça a contagem; caso contrário, conclui
automaticamente em aproximadamente 5,3 segundos desde o início do silêncio,
incluindo a confirmação de atividade.
Atividade ambígua fora dessa janela tem tolerância limitada a 8 segundos,
evitando que ruído variável mantenha a captura aberta indefinidamente. A pessoa
não finaliza a resposta manualmente.
Depois disso, uma única chamada ao Whisper recebe o áudio completo
acumulado; não há chamadas por janelas nem texto parcial na tela. Quando a
transcrição final não está vazia, ela fica em memória no cliente até ser
submetida automaticamente e pode então compor o turno privado, a próxima
decisão da entrevista e o relatório. Perguntas puladas não são persistidas. O
app não grava áudio em disco, não o reproduz e não o salva no Supabase; os buffers temporários são
descartados ao concluir, falhar, cancelar ou desconectar.

Erros estruturados de captura, limite, fila ou provedor são apresentados como
estados recuperáveis em português, com opções de nova tentativa, pular a
pergunta ou encerrar a prática. Quando Azure Pronunciation Assessment está
habilitado, ele recebe o áudio final e a transcrição de referência. A avaliação
é experimental, pode estar indisponível para respostas acima de 30 segundos e
nunca bloqueia a transcrição nem o relatório. Esses sinais não são um relatório
geral de proficiência nem uma avaliação de sotaque.

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
- AudioWorklet e WebSocket para captura PCM e transcrição final em lote
- Backend Express + Kokoro para fala do entrevistador

No modo Cartesia, a mensagem `start` do stream inclui `question` (a pergunta atual da entrevistadora, no máximo 400 caracteres) para o backend decidir semanticamente se a resposta já terminou.
