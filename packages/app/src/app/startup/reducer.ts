import type { StartupEvent, StartupMachineState, StartupResolution } from './types';

export const INITIAL_STARTUP_RESOLUTION: StartupResolution = {
  state: 'boot',
  screen: 'splash',
  message: 'Loading Budgero…',
  branch: 'boot',
};

export const INITIAL_STARTUP_MACHINE_STATE: StartupMachineState = {
  resolution: INITIAL_STARTUP_RESOLUTION,
  stablePublished: false,
};

export function startupReducer(
  state: StartupMachineState,
  event: StartupEvent
): StartupMachineState {
  switch (event.type) {
    case 'RESET':
      return INITIAL_STARTUP_MACHINE_STATE;
    case 'RESOLVE': {
      const nextStablePublished = state.stablePublished || event.resolution.state !== 'boot';
      const unchanged =
        state.resolution.state === event.resolution.state &&
        state.resolution.screen === event.resolution.screen &&
        state.resolution.message === event.resolution.message &&
        state.resolution.detail === event.resolution.detail &&
        state.resolution.error === event.resolution.error &&
        state.resolution.branch === event.resolution.branch &&
        state.stablePublished === nextStablePublished;

      if (unchanged) {
        return state;
      }

      return {
        resolution: event.resolution,
        stablePublished: nextStablePublished,
      };
    }
    default:
      return state;
  }
}
