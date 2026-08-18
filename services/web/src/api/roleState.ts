// Module-level role store so the HTTP API client can send X-Fiscus-Role on every request
// without needing to be inside a React component. Updated by session.tsx when role changes.
let _role = 'data_entry';
export const getApiRole = (): string => _role;
export const setApiRole = (role: string): void => { _role = role; };
