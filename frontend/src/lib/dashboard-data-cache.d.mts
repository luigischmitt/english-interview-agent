export function readDashboardCache<T = unknown>(key: string): T | undefined;
export function writeDashboardCache<T>(key: string, value: T): T;
export function invalidateDashboardCache(...keys: string[]): void;
export function sharedLoad<T>(key: string, loader: () => Promise<T>): Promise<T>;
export function refreshDashboardCache<T>(key: string, loader: () => Promise<T>): Promise<T>;
