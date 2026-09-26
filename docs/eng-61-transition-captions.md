# ENG-61: avoid repeated generic transitions

The interviewer no longer adds a generic spoken bridge when moving to a new topic. Backend and frontend fallback decisions return `acknowledgement: null`, and the orchestration prompt asks the model to do the same for `NEXT`. Short acknowledgements remain available for contextual `FOLLOW_UP` questions.

During segmented playback, captions continue to follow the active spoken sentence. After playback finishes, the stable caption returns to the current question only, so a follow-up acknowledgement does not reappear beside the question. Opening and closing utterances, and the full text fallback when audio is disabled or unavailable, keep their existing behavior.

Validation: backend orchestration tests, frontend fallback and speech-playback tests, lint, typecheck, and production build passed. The browser UI and live speech provider are not part of the automated checks for this change.
