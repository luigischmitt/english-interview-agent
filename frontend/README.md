# Frontend — English Interview Agent

Interface inicial para o agente de simulação de entrevistas em inglês voltado a profissionais brasileiros de tecnologia.

## Escopo atual

Este é um protótipo funcional somente de frontend. Não há autenticação, persistência, backend, câmera, microfone ou integração com IA.

- Home minimalista com dados demonstrativos de evolução e sessões recentes.
- Navegação local para uma sala de entrevista no estilo de videochamada.
- Controles locais de microfone, câmera, encerramento e alternância entre tema claro/escuro.
- Tema claro é o padrão; o escuro é uma alternativa de conforto visual.

Os dados de dashboard são estáticos e existem apenas para validar hierarquia e layout. O avatar por iniciais na sala de entrevista é temporário: ele será substituído pelo avatar do entrevistador quando esse recurso existir.

## Rodar o ambiente completo com Docker

Na raiz do repositório:

```bash
docker compose up --build
```

Abra [http://localhost:3000](http://localhost:3000). O comando também inicia o backend e o Kokoro. As alterações em `frontend/` e `backend/` são recarregadas durante o desenvolvimento.

Para desligar o ambiente:

```bash
docker compose down
```

## Rodar somente o frontend

```bash
npm install
npm run dev
```

Abra [http://localhost:3000](http://localhost:3000).

## Verificações

```bash
npm run lint
npm run build
```

## Stack

- Next.js com App Router e TypeScript
- Tailwind CSS
- shadcn/ui
- Lucide React
