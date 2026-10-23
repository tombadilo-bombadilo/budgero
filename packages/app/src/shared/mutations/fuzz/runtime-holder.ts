/**
 * The device whose runtime `getRuntime()` returns in the integrity fuzz
 * (the specs mock `@shared/runtime/global` to read it). One device runs at a
 * time, so swapping this pointer is how a step moves between devices.
 */
export const runtimeHolder: { current: { runtime: unknown } | null } = { current: null };
