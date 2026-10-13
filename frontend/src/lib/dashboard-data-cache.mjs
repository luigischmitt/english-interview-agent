const entries = new Map();
const pendingLoads = new Map();

export function readDashboardCache(key) {
  return entries.get(key)?.value;
}

export function writeDashboardCache(key, value) {
  entries.set(key, { value });
  return value;
}

export function invalidateDashboardCache(...keys) {
  if (keys.length === 0) {
    entries.clear();
    pendingLoads.clear();
  } else for (const key of keys) {
    entries.delete(key);
    pendingLoads.delete(key);
  }
}

export function sharedLoad(key, loader) {
  const pending = pendingLoads.get(key);
  if (pending) return pending;
  const request = Promise.resolve().then(loader).then((result) => {
    if (pendingLoads.get(key) === request && result?.ok !== false) {
      writeDashboardCache(key, result?.ok === true ? result.value : result);
    }
    return result;
  });
  pendingLoads.set(key, request);
  const clear = () => {
    if (pendingLoads.get(key) === request) pendingLoads.delete(key);
  };
  request.then(clear, clear);
  return request;
}

export function refreshDashboardCache(key, loader) {
  return Promise.resolve().then(loader).then((value) => writeDashboardCache(key, value));
}
