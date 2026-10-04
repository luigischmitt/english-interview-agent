# ENG-49 — captura de áudio com VAD e transcrição ao finalizar

## Captura e protocolo

O browser captura mono PCM s16le a 16 kHz com `AudioWorklet`, agrupa até 100 ms por frame e envia binários pelo WebSocket v2. O WebSocket faz transporte de áudio e mensagens de RMS para o VAD. Nenhuma chamada Whisper ou texto de transcrição é produzido enquanto a pessoa fala.

A abertura da sessão usa:

```json
{
  "type": "start",
  "version": 2,
  "sampleRate": 16000,
  "channels": 1,
  "encoding": "s16le",
  "speechThreshold": 0.025
}
```

O servidor responde `ready` com os limites e a política de transcrição. Mensagens `level` alimentam o VAD; `finalize` solicita o processamento da resposta inteira e `cancel` descarta a gravação. O backend mantém os frames em memória e monta um único WAV PCM ao finalizar.

| Parâmetro | Valor | Motivo |
| --- | ---: | --- |
| Taxa / canais / formato | 16 kHz / mono / s16le | Áudio compacto, aceito pelo fluxo Whisper. |
| Frame de transporte | 100 ms (3,2 KiB) | Transporte responsivo sem chamadas ao provedor por frame. |
| Calibração / pré-roll | 500 ms / cinco frames em memória | Estima o ruído e preserva o começo da fala capturada. |
| Limiar de fala | `clamp(média RMS × 2,5, 0,025, 0,15)` | Adapta o início de fala ao ruído medido. |
| Histerese de silêncio | `clamp(limiar de fala × 0,65, 0,012, 0,12)` | Distingue fala de ruído baixo. |
| Início de fala | 200 ms acima do limiar | Ignora picos curtos. |
| Fala mínima | 600 ms | Evita enviar toques breves como respostas. |
| Silêncio final | 3.500 ms | Tolera pausas de formulação antes de finalizar automaticamente. |

O cliente finaliza automaticamente ao detectar silêncio confiante; não há controle manual para encerrar a resposta. Pausas de até três segundos são preservadas e são necessários 3.500 ms de silêncio para finalizar. Ruído breve não reinicia a contagem: atividade retomada precisa persistir por 300 ms. Voz baixa ou atividade sustentada cancela a contagem; o fallback de 5.800 ms só se aplica a atividade continuamente estável na faixa intermediária entre os limiares de silêncio e fala. Variação ou qualquer frame acima do limiar de fala adia esse fallback. O servidor valida se houve fala; silêncio sem fala retorna `NO_SPEECH_DETECTED` sem chamar Whisper. Áudio válido não é rejeitado por ter uma cauda silenciosa. Na finalização, o servidor envia `finalizing`, pode enviar `transcription-queued` enquanto aguarda um slot, e emite `transcription-started` quando a chamada começa. Diagnósticos operacionais de finalização, sucesso e falha registram somente motivo/código e durações, sem texto, áudio, IDs de sessão ou detalhes do provedor. Em sucesso, `complete` contém a transcrição final, provedor e duração. Não há mensagens `partial` nem montagem de texto entre janelas.

## Limites, concorrência e privacidade

Os limites por instância são:

- até 180 segundos e 6 MiB por resposta;
- até 8 sessões de captura ativas;
- até 4 chamadas Whisper simultâneas;
- até 4 respostas finalizadas aguardando um slot.

Os valores podem ser reduzidos por ambiente, mas têm tetos no backend para manter uso de memória e concorrência limitados. Saturação da fila retorna `TRANSCRIPTION_CAPACITY_REACHED` e permite uma nova tentativa. As variáveis são:

- `TRANSCRIPTION_STREAM_MAX_DURATION_MS` (padrão `180000`, teto `180000`)
- `TRANSCRIPTION_STREAM_MAX_BYTES` (padrão `6291456`, teto `6291456`)
- `TRANSCRIPTION_STREAM_MAX_ACTIVE_SESSIONS` (padrão `8`, teto `8`)
- `TRANSCRIPTION_STREAM_MAX_CONCURRENT_TRANSCRIPTIONS` (padrão `4`, teto `4`)
- `TRANSCRIPTION_STREAM_MAX_QUEUED_TRANSCRIPTIONS` (padrão `4`, teto `4`)
- `TRANSCRIPTION_HEDGE_AFTER_MS` (padrão `4000`, `0` desativa, teto `30000`; ver ENG-90)
- `TRANSCRIPTION_TIMEOUT_MS` (padrão `55000`, teto `60000`; inclui tentativas limitadas por HTTP 429)

PCM mono s16le a 16 kHz ocupa 32.000 bytes por segundo; 180 segundos representam 5.760.000 bytes, abaixo do limite de 6 MiB. O servidor monta WAV diretamente dos frames para evitar uma cópia PCM intermediária e envia o arquivo ao OpenRouter em multipart, sem expansão Base64. Cada transcrição lógica tenta no máximo três requisições quando recebe HTTP 429, respeitando `Retry-After` por até dois segundos e backoff limitado, dentro do orçamento total de `TRANSCRIPTION_TIMEOUT_MS`. Outros erros não são repetidos. O limite da sessão de captura é substituído ao receber `finalize` por um orçamento separado que cobre a espera máxima da fila, o processamento Whisper e a avaliação Azure curta; assim, uma resposta de 180 segundos não perde o resultado por causa do timer de captura.

O áudio permanece apenas em memória: não é gravado em arquivo, banco, log ou armazenamento de sessão. Buffers são zerados em sucesso, erro, cancelamento, timeout e desconexão. O cancelamento aborta a chamada upstream ativa quando suportado. A transcrição final pode compor o turno privado da entrevista; o áudio não é persistido. A rota HTTP WAV de compatibilidade permanece separada e aceita no máximo 30 segundos.

## Transcrição especulativa (ENG-83)

Ao detectar silêncio confiante (`silence`, não `ambient_activity`), se houver um slot Whisper livre naquele instante, o servidor inicia a chamada Whisper sobre um snapshot WAV em memória do áudio até ali. O slot é reservado na `FinalTranscriptionQueue` (`reserve()`), sem fila e sem exceder o limite de concorrência; sem slot livre, vale o fluxo normal. Se a fala retomar durante a graça, a chamada é abortada, o snapshot é zerado e o slot liberado; um novo silêncio pode especular de novo. Sem retomada, `finalize` reaproveita a mesma chamada (o slot passa ao job de finalização) e `complete` só é enviado após a graça. Se a chamada especulativa falhar, ocorre uma transcrição normal. O Azure usa as marcações do snapshot sobre o áudio final completo (o excedente é silêncio final). Finalização manual, cancelamento, erro, limites e fechamento do socket abortam a especulação e zeram os buffers. O log `complete` inclui `speculation` (`reused`, `discarded`, `skipped_no_slot`, `failed`, `none`), sem conteúdo.

## Falhas recuperáveis

Ausência de fala, fala curta, limite de gravação, fila cheia, timeout e falha do Whisper retornam eventos `error` com códigos e mensagens sem texto da transcrição nem detalhes do provedor. A interface pode oferecer gravar novamente, pular a pergunta ou encerrar a prática. Respostas escritas não são aceitas.

## Azure Pronunciation Assessment

Com `AZURE_SPEECH_ASSESSMENT_ENABLED=true`, o backend envia ao Azure a gravação final e a transcrição Whisper completa como `ReferenceText`; não faz uma segunda chamada de reconhecimento. A avaliação só é solicitada para gravações de até 30 segundos, limite do contrato de áudio curto usado por esta integração. Respostas maiores recebem `assessment: unavailable` sem chamada ao Azure.

O resultado `complete` do Whisper é entregue antes da avaliação Azure. O trabalho de Azure não ocupa um slot da fila Whisper. Falhas, timeout ou cancelamento no Azure não removem nem substituem a transcrição. Accuracy, Fluency e Prosody são sinais experimentais do fornecedor, não medidas validadas de nível geral, prontidão, proficiência ou sotaque. Confirme custos e limites atuais do recurso Azure antes de habilitá-lo em produção.

## Verificação

Os testes cobrem transporte PCM, construção do WAV completo, ausência de chamadas antes de `finalize`, uma chamada lógica depois, silêncio sem fala, cauda silenciosa após fala válida, duração/bytes/sessões, fila e concorrência, cancelamento e desconexão, falha do Whisper, avaliação Azure tardia e limite de 30 segundos. O harness opt-in gera uma resposta sintética, envia frames pelo WebSocket e informa latências e tamanho do texto sem imprimir a transcrição.

## Requisições hedged (ENG-90)

A latência do Whisper via OpenRouter tem cauda longa independente do áudio (o mesmo WAV de 61 s variou de ~1 s a ~15 s, e fixar o provedor não ajuda). Por isso, tanto a chamada especulativa quanto a chamada final normal são "hedged": se a chamada primária ainda não terminou após `TRANSCRIPTION_HEDGE_AFTER_MS` (padrão 4 s) e a sessão não foi abortada, o servidor tenta reservar mais um slot da `FinalTranscriptionQueue` (`reserve()`, nunca excedendo o limite de concorrência nem furando a fila). Se houver slot, inicia uma segunda chamada idêntica sobre o mesmo buffer. A primeira resposta bem-sucedida vence e a outra é abortada; o slot extra só é liberado depois que a chamada abortada termina. Se uma falhar, espera-se a outra; se ambas falharem, o erro da primária (com as categorias do ENG-89) é o reportado. O transcript canônico continua único: apenas o resultado vencedor é usado. Descarte da especulação, finalização manual, cancelamento, erro e fechamento do socket abortam as duas chamadas e zeram os buffers. A recuperação opcional de timestamps não é hedged.

Custo: o hedge é uma chamada Whisper extra apenas em requisições lentas; o Whisper custa cerca de US$0,01 por hora de áudio. Os logs `complete` e `failed` incluem `hedge` (`not_needed`, `skipped_no_slot`, `primary_won`, `secondary_won`, `both_failed`), sem conteúdo.

## Whisper incremental como sinal de fim de resposta

O Whisper incremental é o único motor de transcrição das respostas (ENG-108; o Cartesia Ink-2 foi removido). O VAD local corta a resposta em segmentos a cada pausa (`TRANSCRIPTION_PAUSE_MS`, padrão 800 ms) e cada segmento é transcrito em segundo plano pelo Whisper via OpenRouter. Depois de cada fim de turno roda uma janela de segurança: `TRANSCRIPTION_ANSWER_GRACE_MS` (padrão 3,5 s) quando o texto termina como frase completa, ou `TRANSCRIPTION_INCOMPLETE_GRACE_MS` (padrão 6 s) quando parece incompleto (sem pontuação final ou terminando em conectivo como "because"/"and"), cancelada por fala retomada no VAD local. Ao expirar, o backend envia `finalizing`, aguarda os segmentos em andamento e envia `complete`. Se algum segmento falhar ou o transcript vier vazio, a resposta usa o caminho Whisper com o áudio completo (com especulação e hedge). Para o Azure, o Whisper roda em segundo plano depois de `complete`, só para tempos de palavras e texto de referência. Detalhes, variáveis e logs em `backend/README.md` ("Answer transcription (incremental Whisper)").
