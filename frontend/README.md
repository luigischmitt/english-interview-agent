# Frontend — English Interview Agent

Aplicação web para praticar entrevistas profissionais em inglês. A interface
é voltada inicialmente a profissionais brasileiros de tecnologia e separa a
prática da resposta em inglês da análise futura de áudio.

## O que está disponível hoje

- Página pública inicial, com links para criar conta e entrar.
- Autenticação Supabase: cadastro, login, recuperação e atualização de senha.
- Área protegida com cargo, senioridade, foco e duração (5, 10, 15 ou 25
  minutos), sem contagem fixa de perguntas. A sala respeita o tempo, permite
  concluir uma resposta já iniciada e encerra sem repetir o banco interno de
  oito perguntas. Após uma resposta, pode haver no máximo um follow-up curto.
- A abertura menciona cargo, senioridade, foco e duração configurados. Após
  cada resposta final, o entrevistador dá um reconhecimento curto com trecho
  literal da transcrição e faz no máximo um follow-up útil ou segue para a
  próxima pergunta adaptada ao cargo e foco. A sequência fixa continua como
  fallback. As legendas acompanham cada frase falada; falhas de raciocínio ou
  TTS mantêm a pergunta fixa e o texto disponível.
- Reprodução opcional da introdução e perguntas pelo backend Kokoro, legendas
  independentes e captura automática opcional após o áudio. Falha de áudio ou
  autoplay mantém o texto e a opção de iniciar o microfone manualmente.
- Prévia local opcional da câmera do candidato. O vídeo não é enviado nem
  persistido; a presença do entrevistador é apenas tipográfica/sonora, sem
  avatar ou câmera simulada.
- Respostas somente por voz usando `AudioWorklet`. O microfone pode iniciar
  automaticamente após a pergunta ou manualmente; não há resposta digitada nem
  legenda visível da fala do candidato. O navegador envia PCM mono s16le a
  16 kHz em frames de aproximadamente 100 ms pelo WebSocket v2. O VAD encerra
  a captura automaticamente após 2,7 segundos de silêncio. Ruídos breves não
  reiniciam esse intervalo; fala sustentada reinicia a contagem. Não há botão
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
  1,2 segundo, sem bloquear a conclusão; resultados Azure tardios atualizam as
  médias e a sincronização. A tabela privada `interview_feedback`
  persiste status, resumo Azure e análise estruturada, sem salvar áudio ou copiar
  a transcrição completa. Se a sincronização falhar, o relatório continua visível
  localmente.

O estado da câmera e do microfone é temporário e os tracks são encerrados ao
desligar, sair da sala ou desmontar o componente. As legendas visíveis durante
a entrevista são somente as do entrevistador; o texto final reconhecido da
fala do candidato permanece interno para envio, raciocínio da entrevista e
persistência autorizada. Uma transcrição final não vazia é submetida
automaticamente quando o processamento termina.

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
o texto da pergunta continua disponível e a falha de reprodução não bloqueia a
prática por voz.

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

O VAD encerra automaticamente após 2,7 segundos de silêncio. Ruídos breves não
reiniciam a contagem; atividade sustentada de fala reinicia o intervalo para
preservar pausas entre frases. A pessoa não finaliza a resposta manualmente.
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
