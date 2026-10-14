export function visibleProgressDimensions<T extends { kind: "pattern" | "voice"; value: number }>(dimensions: T[]): T[];
export function progressDimensionKindLabel(kind: "pattern" | "voice"): "Padrão observado" | "Fala";
