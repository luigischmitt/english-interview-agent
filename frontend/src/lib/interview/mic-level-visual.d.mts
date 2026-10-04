export const silenceDb: number;
export const loudDb: number;
export function levelToIntensity(level: number): number;
export function smoothIntensity(previous: number, target: number): number;
