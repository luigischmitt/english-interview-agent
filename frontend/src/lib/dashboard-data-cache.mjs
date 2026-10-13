const entries = new Map();

export function readDashboardCache(key) {
  return entries.get(key)?.value;
}

export function writeDashboardCache(key, value) {
  entries.set(key, { value });
  return value;
}

export function invalidateDashboardCache(...keys) {
  if (keys.length === 0) entries.clear();
  else for (const key of keys) entries.delete(key);
}

export function refreshDashboardCache(key, loader) {
  return Promise.resolve().then(loader).then((value) => writeDashboardCache(key, value));
}
