type AssessmentSocket = Pick<WebSocket, "onmessage" | "onclose" | "onerror" | "close">;

export declare class AssessmentSocketRegistry {
  register(attemptId: string, socket: AssessmentSocket): void;
  finish(attemptId: string, socket: AssessmentSocket): void;
  closeAll(): void;
}
