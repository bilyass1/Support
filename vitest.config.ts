import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},test:{environment:'node',pool:'threads',maxWorkers:1,fileParallelism:false, testTimeout:30000,hookTimeout:30000}});
