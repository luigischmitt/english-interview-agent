# English Interview Agent

## Produto e público

Este produto treina brasileiros para entrevistas profissionais em inglês, inicialmente em tecnologia e vagas internacionais. O usuário típico é um dev tecnicamente sólido, com inglês B1/B2: ele sabe responder em português e trabalha em inglês no dia a dia, mas perde clareza e confiança sob pressão na entrevista.

O objetivo não é eliminar o sotaque nem exigir inglês perfeito. É permitir que a competência técnica da pessoa seja percebida em inglês com clareza, confiança e precisão.

## Diferencial

Uma entrevista simulada por IA é commodity. O diferencial é analisar o inglês **sob pressão de entrevista** e priorizar dificuldades recorrentes de falantes de português brasileiro, tais como:

- pausas, hesitação, ritmo e capacidade de sustentar uma resposta;
- inteligibilidade, pronúncia, acento de palavras e entonação;
- artigos, preposições, tempos verbais e frases traduzidas literalmente;
- falsos cognatos e vícios de linguagem;
- diferença entre qualidade técnica da resposta e a forma de comunicá-la em inglês.

O feedback deve ser específico, respeitoso, prático e priorizado pelo impacto na compreensão e na credibilidade profissional. Não trate pequenas imperfeições como falhas graves.

## Experiência esperada

- Simular entrevistas realistas em inglês, com perguntas e follow-ups coerentes.
- Criar pressão progressiva sem humilhar ou interromper o candidato em excesso.
- Avaliar separadamente conteúdo técnico, comunicação em inglês e entrega vocal.
- Dar exemplos concretos de como reformular respostas e sugerir exercícios acionáveis.
- Preservar a sensação de entrevista durante a sessão; concentrar a maior parte do feedback após blocos ou no relatório final.

## Workflow de engenharia

O trabalho é organizado por issues no Linear. Cada alteração deve pertencer a uma única issue e possuir um resultado pequeno, verificável e alinhado aos seus critérios de aceite.

1. Leia a issue atual e identifique escopo, critérios de aceite e dependências.
2. Atualize `main` e crie uma branch a partir dela.
3. Implemente e teste somente o que pertence à issue.
4. Faça commits claros vinculados à issue.
5. Abra uma PR da branch para `main`, associe-a à issue e descreva validações realizadas.
6. Faça merge apenas após revisão/validação e então encerre a issue.

### Branches

Use o identificador exato do Linear, sem espaços e em minúsculas:

```text
ltodaro/eng-6-authentication
ltodaro/eng-12-interview-transcription
ltodaro/eng-18-feedback-report
```

Para mudanças pequenas, `ltodaro/eng-6` é suficiente.

### Commits

Comece cada commit com o identificador da issue:

```text
ENG-6: add authentication flow
ENG-12: persist interview transcription
ENG-18: generate pronunciation feedback
```

## Diretrizes para agentes

- Não misture issues, refactors não relacionados ou mudanças de produto na mesma branch/PR.
- Preserve alterações existentes do usuário que não pertençam à issue atual.
- Prefira entregas incrementais, simples e testáveis a abstrações prematuras.
- Não invente requisitos de produto: se uma ambiguidade muda materialmente a solução, sinalize-a antes de decidir.
- Antes de concluir uma tarefa, valide o comportamento afetado e informe claramente o que mudou, como foi validado e o que ainda não foi coberto.
