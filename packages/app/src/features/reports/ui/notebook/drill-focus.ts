import type { DrillRequest } from './DrillMenu';

/** The focused element when a drill starts, so the menu can hand focus back. */
export function withReturnFocus(request: DrillRequest): DrillRequest {
  if (request.returnFocus !== undefined || typeof document === 'undefined') return request;
  const active = document.activeElement;
  return {
    ...request,
    returnFocus: active instanceof HTMLElement && active !== document.body ? active : null,
  };
}
