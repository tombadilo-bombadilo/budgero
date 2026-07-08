import { describe, expect, it, vi } from 'vitest';
import { RuntimeStateMachine } from './runtime-state-machine';

describe('RuntimeStateMachine', () => {
  it('allows the expected happy-path transitions', () => {
    const machine = new RuntimeStateMachine('Idle');

    machine.transition('Initializing');
    machine.transition('Ready');
    machine.transition('SwitchingSpace');
    machine.transition('Ready');
    machine.transition('Reconnecting');
    machine.transition('Degraded');
    machine.transition('Ready');
    machine.transition('Destroyed');
    machine.transition('Idle');

    expect(machine.state).toBe('Idle');
  });

  it('rejects invalid transitions', () => {
    const machine = new RuntimeStateMachine('Idle');
    expect(() => machine.transition('Ready')).toThrow('Invalid runtime transition');
  });

  it('supports no-op same-state transitions and listener safety', () => {
    const machine = new RuntimeStateMachine('Ready');
    const listener = vi.fn(() => {
      throw new Error('listener fail');
    });
    machine.onChange(listener);

    expect(machine.canTransition('Ready')).toBe(true);
    machine.transition('Ready');
    expect(machine.state).toBe('Ready');
    expect(() => machine.transition('Degraded')).not.toThrow();
  });
});
