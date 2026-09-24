# Frontend — English Interview Agent

Aplicação web para praticar entrevistas profissionais em inglês. A interface
é voltada inicialmente a profissionais brasileiros de tecnologia e separa a
prática da resposta em inglês da análise futura de áudio.

## O que está disponível hoje

- Página pública inicial, com links para criar conta e entrar.
- Autenticação Supabase: cadastro, login, recuperação e atualização de senha.
- Área protegida com configuração de entrevista, sequência fixa de perguntas,
  respostas escritas e tela de progresso.
- Reprodução opcional da pergunta do entrevistador pelo backend de speech;
  o texto da pergunta sempre permanece visível.
- Captura opcional de microfone usando `MediaRecorder`. Ao concluir uma
  gravação de até 30 segundos, o navegador a converte para WAV e a envia ao
  backend para transcrição no Azure Speech ou, em teste local, nos modelos
  Whisper configurados via OpenRouter. O áudio não é
  reproduzido nem salvo; a transcrição pode compor a resposta escrita privada
  da sessão.
- Sessões e turnos de texto salvos nas tabelas Supabase quando a conta e a
  conexão estão disponíveis. As políticas RLS limitam os dados ao usuário.

Não há captura de câmera, avatar de entrevistador real, follow-ups gerados
por IA ou relatório de feedback conectado. A transcrição atual é concluída
por resposta; não há streaming ou feedback durante a fala.
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

## Áudio, transcrição e privacidade

O microfone é opcional. Ao concluir uma resposta por voz de até 30 segundos,
o áudio é enviado ao backend e encaminhado ao transcritor escolhido para
gerar a transcrição. O app não salva,
reproduz ou persiste o arquivo de áudio. A transcrição resultante pode ser
salva como turno de texto da sessão privada. Não há streaming, transcrição ao
vivo, upload persistente de áudio ou relatório final de feedback conectado.

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
- MediaRecorder para captura local opcional
- Backend Express + Kokoro para fala do entrevistador
