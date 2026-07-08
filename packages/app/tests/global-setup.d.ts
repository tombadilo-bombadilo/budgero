import { FullConfig } from '@playwright/test';
declare function globalSetup(_config: FullConfig): Promise<void>;
export default globalSetup;
