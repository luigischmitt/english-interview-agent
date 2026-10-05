export function hasSeniorityWord(role: string): boolean;
export function looksPortuguese(role: string): boolean;
export function describeRoleForSpeech(role: string | undefined | null, seniorityLabel?: string): { phrase: string; personal: boolean };
export function focusClause(focus: string | undefined | null): string;
export function roleForSpeech(role: string | undefined | null): string;
