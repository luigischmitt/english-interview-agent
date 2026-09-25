# ENG-49 — streaming de áudio com VAD

## Captura e transcrição incremental

O browser captura mono PCM s16le a 16 kHz com `AudioWorklet`, agrupa até 100 ms por frame e envia binários pelo WebSocket. A taxa não muda durante a sessão. O protocolo v2 começa com:

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

O servidor responde `ready` com protocolo, limites e política das janelas. Mensagens `level` carregam RMS para o VAD; `finalize` fecha a resposta e `cancel` descarta a sessão. O browser e backend usam frames independentes em PCM, então cada janela de Whisper é um WAV válido sem depender de cabeçalho WebM/MP4.

| Parâmetro | Valor | Motivo |
| --- | ---: | --- |
| Taxa / canais / formato | 16 kHz / mono / s16le | Entrada compacta e estável para Whisper e Azure. |
| Frame de transporte | 100 ms (até 3,2 KiB) | Mantém latência baixa sem chamar o provedor a cada frame. |
| Janela Whisper | 10 s | Atualiza o texto enquanto o candidato ainda responde. |
| Overlap de áudio | 1 s | Reduz cortes de palavras nas bordas de segmentos. |
| Agendamento | sequencial, no máximo uma chamada Whisper em andamento | Preserva ordem e limita fila/custo. |
| Calibração de ruído / pré-roll | 500 ms / cinco frames PCM guardados em memória | O limiar é calculado antes de abrir a sessão e os frames calibrados são enviados em seguida, sem perder fala capturada. |
| Limiar de fala | `clamp(média RMS × 2,5, 0,025, 0,15)` | Adapta-se ao ruído de fundo observado na calibração. |
| Histerese de silêncio | `clamp(limiar de fala × 0,65, 0,012, 0,12)` | Separa o limiar de fala de ruído baixo. |
| Início de fala | 200 ms acima do limiar calibrado | Ignora picos curtos. |
| Fala mínima | 600 ms | Evita chamada por toque breve. |
| Silêncio final | 2.000 ms | Dá espaço para pausas de formulação sem estender demais a captura. |

O primeiro Whisper roda após 10 segundos de áudio. Janelas seguintes cobrem 9 segundos novos e repetem 1 segundo da janela anterior. Ao finalizar, uma última janela pode conter menos de 10 segundos. O cliente recebe um evento `partial` por janela com índice e intervalo de áudio; ele junta as transcrições na ordem e remove somente o overlap textual que encontra na fronteira. O evento `complete` informa se todos os segmentos foram transcritos ou se o texto é parcial.

## Limites e privacidade

O padrão é até 180 segundos, 6 MiB por sessão, 512 KiB aguardando Whisper por sessão e 8 sessões simultâneas. Os controles são de backend e podem ser alterados por ambiente:

- `TRANSCRIPTION_STREAM_MAX_DURATION_MS` (padrão `180000`)
- `TRANSCRIPTION_STREAM_MAX_BYTES` (padrão `6291456`)
- `TRANSCRIPTION_STREAM_MAX_QUEUE_BYTES` (padrão `524288`)
- `TRANSCRIPTION_STREAM_MAX_ACTIVE_SESSIONS` (padrão `8`)

Uma resposta PCM máxima representa cerca de 5,5 MiB de áudio bruto; o teto de bytes é um limite técnico separado do teto de tempo. A fila e a concorrência protegem o processo quando o provedor fica mais lento que a captura. O limite é validado também no servidor, não apenas no timer visual do browser. A rota HTTP WAV de compatibilidade permanece separada e ainda aceita até 30 segundos.

O backend mantém buffers apenas em memória. Não grava áudio em arquivo, banco, log ou armazenamento de sessão. Uma janela é enviada ao Whisper Large V3 Turbo somente quando está pronta; chamadas são sequenciais, nunca por frame. Cada pedido usa a chave do OpenRouter no servidor. `finalize`, `cancel`, desconexão, timeout e falhas liberam buffers. O texto final pode compor o turno privado da entrevista; o áudio não é persistido.

Se uma janela Whisper posterior falhar, o backend emite `partial-error` e `complete` com estado parcial. O browser preserva o trecho para leitura somente durante a captura atual, mas ele não pode ser submetido como resposta. A pessoa pode tentar gravar novamente, pular a pergunta ou encerrar a prática. Falhas antes do primeiro resultado oferecem as mesmas ações; não há entrada escrita de resposta.

## Azure Pronunciation Assessment

Com `AZURE_SPEECH_ASSESSMENT_ENABLED=true`, cada janela é avaliada somente depois que seu Whisper retorna. A janela WAV e apenas o texto Whisper correspondente são enviados ao Azure scripted assessment como `ReferenceText`; não há uma segunda chamada de transcrição. Azure é opcional: falhas ou timeout não bloqueiam Whisper nem substituem seus resultados.

O evento final `assessment` contém Accuracy, Fluency e Prosody experimentais, agregados pela média ponderada das durações avaliadas, além de `durationMs` (soma das durações dos segmentos avaliados; a região de overlap conta em ambos os segmentos). As métricas são explicitamente segmentadas e não equivalem à avaliação única da gravação inteira. Não são medidas validadas de nível geral, prontidão, proficiência ou sotaque e não são persistidas. Confirme custos e limites atuais do recurso Azure antes de habilitar em produção.

## Verificação

Os testes cobrem frames PCM ordenados, construção de WAV, janelas de 10 s / overlap de 1 s, cauda final, limites, VAD de 2 s, protocolo v2, segmentos incrementais, falha Whisper com texto parcial preservado e avaliação Azure por segmento com duração agregada.
