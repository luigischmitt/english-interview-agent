export function getHomeParallaxOffset(elementTop, viewportHeight, maxOffset = 18) {
  if (!Number.isFinite(elementTop) || !Number.isFinite(viewportHeight) || !Number.isFinite(maxOffset) || maxOffset < 0) {
    return 0;
  }

  const offset = (viewportHeight / 2 - elementTop) * 0.05;
  return Math.max(-maxOffset, Math.min(maxOffset, Math.round(offset)));
}
