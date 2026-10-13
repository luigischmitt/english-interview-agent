export type WordBlock = { id: number; text: string; trailing: string };
export function toBlocks(sentence: string): WordBlock[];
export function applyEdits(blocks: WordBlock[], edits: Record<number, string>, order?: number[]): string;
export function mistakeRegion(exercise: { sentence: string; answer: string }): { blockIds: number[]; correct: string; mistaken: string };
export function alternativesFor(exercise: { id: string; ruleId: string; sentence: string; answer: string; choices?: string[] }, lessons: Array<{ exercises?: Array<{ id: string; ruleId: string; kind: string; options?: string[] }> }>, random?: () => number): Array<{ value: string; label: string }>;
