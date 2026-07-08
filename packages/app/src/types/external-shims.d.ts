/* eslint-disable @typescript-eslint/no-explicit-any */
declare module '@codemirror/state' {
  export type Extension = unknown;
}

declare module '*.json?json' {
  const value: Record<string, unknown>;
  export default value;
}

declare module '@floating-ui/react' {
  export type VirtualElement = any;
}
