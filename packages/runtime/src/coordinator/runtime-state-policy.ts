import type { RuntimeState } from '../types';

export type RuntimeStateIntent =
  | 'init:reset'
  | 'init:start'
  | 'init:success'
  | 'init:failure'
  | 'switch:start'
  | 'switch:success'
  | 'switch:failure'
  | 'destroy';

export class RuntimeStatePolicy {
  shouldNoopInit(state: RuntimeState): boolean {
    return (
      state === 'Ready' ||
      state === 'Reconnecting' ||
      state === 'Degraded' ||
      state === 'SwitchingSpace'
    );
  }

  shouldResetBeforeInit(state: RuntimeState): boolean {
    return state === 'Error' || state === 'Destroyed';
  }

  canSwitchSpace(state: RuntimeState): boolean {
    return state === 'Ready' || state === 'Degraded';
  }

  canExecuteMutation(state: RuntimeState): boolean {
    return state === 'Ready' || state === 'Degraded';
  }

  isInitialized(state: RuntimeState): boolean {
    return state === 'Ready' || state === 'Degraded' || state === 'Reconnecting';
  }

  resolveIntent(intent: RuntimeStateIntent, current: RuntimeState): RuntimeState {
    switch (intent) {
      case 'init:reset':
        if (current !== 'Error' && current !== 'Destroyed') {
          throw new Error(`Cannot reset init from state: ${current}`);
        }
        return 'Idle';
      case 'init:start':
        if (current !== 'Idle') {
          throw new Error(`Cannot start init in state: ${current}`);
        }
        return 'Initializing';
      case 'init:success':
        if (current !== 'Initializing') {
          throw new Error(`Cannot complete init in state: ${current}`);
        }
        return 'Ready';
      case 'init:failure':
        if (current !== 'Initializing') {
          throw new Error(`Cannot fail init in state: ${current}`);
        }
        return 'Error';
      case 'switch:start':
        if (!this.canSwitchSpace(current)) {
          throw new Error(`Cannot switch space in state: ${current}`);
        }
        return 'SwitchingSpace';
      case 'switch:success':
        if (current !== 'SwitchingSpace') {
          throw new Error(`Cannot complete switch in state: ${current}`);
        }
        return 'Ready';
      case 'switch:failure':
        if (current !== 'SwitchingSpace') {
          throw new Error(`Cannot fail switch in state: ${current}`);
        }
        return 'Error';
      case 'destroy':
        return 'Destroyed';
      default:
        return current;
    }
  }
}
