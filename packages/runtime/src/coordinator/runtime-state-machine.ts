import type { RuntimeState } from '../types';

export type RuntimeStateChangeListener = (next: RuntimeState, prev: RuntimeState) => void;

const ALLOWED_TRANSITIONS: Record<RuntimeState, ReadonlySet<RuntimeState>> = {
  Idle: new Set(['Initializing', 'Destroyed']),
  Initializing: new Set(['Ready', 'Error', 'Destroyed']),
  Ready: new Set(['SwitchingSpace', 'Reconnecting', 'Degraded', 'Error', 'Destroyed']),
  SwitchingSpace: new Set(['Ready', 'Error', 'Destroyed']),
  Reconnecting: new Set(['Ready', 'Degraded', 'Error', 'Destroyed']),
  Degraded: new Set(['Ready', 'Reconnecting', 'SwitchingSpace', 'Error', 'Destroyed']),
  Error: new Set(['Idle', 'Destroyed']),
  Destroyed: new Set(['Idle']),
};

export class RuntimeStateMachine {
  private _state: RuntimeState;

  private listeners = new Set<RuntimeStateChangeListener>();

  constructor(initialState: RuntimeState = 'Idle') {
    this._state = initialState;
  }

  get state(): RuntimeState {
    return this._state;
  }

  onChange(listener: RuntimeStateChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  canTransition(next: RuntimeState, from: RuntimeState = this._state): boolean {
    if (from === next) return true;
    return ALLOWED_TRANSITIONS[from].has(next);
  }

  transition(next: RuntimeState): void {
    const prev = this._state;
    if (prev === next) return;
    if (!this.canTransition(next, prev)) {
      throw new Error(`Invalid runtime transition: ${prev} -> ${next}`);
    }
    this._state = next;
    this.listeners.forEach((listener) => {
      try {
        listener(next, prev);
      } catch {
        /* no-op */
      }
    });
  }
}
