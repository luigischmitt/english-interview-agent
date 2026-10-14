export function visibleProgressDimensions(dimensions) {
  return dimensions.filter((dimension) => dimension.kind !== "pattern" || dimension.value > 0);
}

export function progressDimensionKindLabel(kind) {
  return kind === "pattern" ? "Padrão observado" : "Fala";
}
