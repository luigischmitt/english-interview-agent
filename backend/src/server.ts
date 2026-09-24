import "dotenv/config";

import { createServer } from "node:http";

import { app, defaultTranscriptionService } from "./app.js";
import { attachTranscriptionWebSocket } from "./transcription/transcription-websocket.js";

const port = Number(process.env.PORT ?? 3001);

const server = createServer(app);
attachTranscriptionWebSocket(server, defaultTranscriptionService);

server.listen(port, () => {
  console.info(`Backend listening on port ${port}`);
});
