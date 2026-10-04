export function filterRoles<T extends string>(roles: readonly T[], query: string): T[];
export function isKnownRole(roles: readonly string[], value: string): boolean;
