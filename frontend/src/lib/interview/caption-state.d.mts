export type CandidateCaption = { committed: string; partial: string };
export const emptyCaption: Readonly<CandidateCaption>;
export const maximumCaptionCharacters: number;
export function parseCaptionMessage(message: unknown): CandidateCaption | null;
export function reduceCaption(previous: CandidateCaption, next: CandidateCaption | null | undefined): CandidateCaption;
export function hasCaptionText(caption: CandidateCaption | null | undefined): boolean;
export function shouldShowCandidateCaption(input: { enabled: boolean; captureState: string; caption: CandidateCaption }): boolean;
