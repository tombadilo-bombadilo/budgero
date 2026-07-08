// Shared app-level types to avoid coupling modules

export type ConnectivityState = {
  clerkToken: boolean;
  apiReachable: boolean;
  wsConnected: boolean;
  overall: boolean; // true only when all above are true
  lastChecked: number;
  selfHostable: boolean;
};
