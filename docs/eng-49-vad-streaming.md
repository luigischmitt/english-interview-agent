# ENG-49 — streaming de áudio com VAD

## Decisões de captura e VAD

| Parâmetro | Valor | Motivo |
| --- | ---: | --- |
| Intervalo de chunks | 250 ms | Envia áudio com baixa latência sem abrir uma chamada de transcrição por chunk. |
| Calibração de ruído | 500 ms | Mede o nível ambiente antes de iniciar a captura. |
| Limiar de fala | `clamp(média RMS × 2,5, 0,025, 0,15)` | Adapta o limiar ao ambiente com piso e teto determinísticos. |
| Histerese / silêncio | `clamp(limiar de fala × 0,65, 0,012, 0,12)` | Separa o limiar de fim do limiar de início para que ruído ambiente não impeça a detecção de silêncio. |
| Início de fala | 200 ms acima do limiar | Ignora picos breves. |
| Pré-roll | até 250 ms contíguos | Mantém apenas o chunk recente antes da detecção; o chunk inicial do contêiner é enviado uma vez no início e não é contado como pré-roll. |
| Fala mínima | 600 ms | Evita chamadas por toques breves no microfone. |
| Silêncio final | 1.500 ms abaixo do limiar de histerese | Dá espaço para pausas de formulação de candidatos B1/B2. |
| Duração máxima | 30 s | Preserva o limite já usado pelo produto e limita o custo por resposta. |
| Tamanho máximo | 4 MiB | Limita o buffer em memória por resposta. |

Os níveis RMS são medidos no navegador e enviados em mensagens JSON. O servidor mantém o estado VAD e anuncia `speech-started` e `silence-detected`. Ao detectar silêncio sustentado, o navegador fecha o gravador para entregar o último chunk e envia `finalize`. O botão “Concluir resposta” envia o mesmo evento manualmente. O servidor monta os bytes em memória e chama Whisper Large V3 Turbo uma vez.

## Protocolo e limites

O WebSocket `/api/v1/transcriptions/stream` negocia `start`, recebe mensagens JSON `level` e frames binários, e termina com `finalize` ou `cancel`. O fechamento inesperado cancela e libera os chunks. O cliente para aos 30 segundos; o servidor mantém uma janela técnica adicional de 1 segundo para receber o último timeslice e o evento `finalize`. Sessões expiram em 60 segundos e são aceitas até 16 sessões simultâneas (até 64 MiB de buffers de áudio). O áudio não é escrito em arquivo, banco, log ou armazenamento de sessão. Falhas e limites preservam a resposta escrita como fallback.

O browser usa WebM quando disponível e MP4 no Safari. O backend repassa o formato real ao endpoint de transcrição. A rota HTTP WAV existente permanece compatível. A transcrição resultante pode integrar o turno privado da entrevista; o áudio não é persistido.

Cada resposta pode gerar no máximo uma chamada ao Whisper Turbo, após fala detectada e finalização, limitada a 30 segundos e 4 MiB. Esses limites reduzem a exposição a áudios longos, mas não representam um orçamento monetário nem substituem controles do provedor. O serviço precisa de `OPENROUTER_API_KEY` no backend.
