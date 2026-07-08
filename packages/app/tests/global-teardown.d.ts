import { FullConfig } from '@playwright/test';
declare function globalTeardown(_config: FullConfig): Promise<void>;
export default globalTeardown;
