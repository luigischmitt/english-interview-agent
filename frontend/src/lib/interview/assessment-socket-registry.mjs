/** Keep late assessment sockets scoped to one interview and tied to its cleanup. */
export class AssessmentSocketRegistry {
  #sockets = new Map();

  register(attemptId, socket) {
    this.#sockets.set(attemptId, socket);
  }

  finish(attemptId, socket) {
    if (this.#sockets.get(attemptId) === socket) this.#sockets.delete(attemptId);
  }

  closeAll() {
    for (const socket of this.#sockets.values()) {
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      socket.close();
    }
    this.#sockets.clear();
  }
}
