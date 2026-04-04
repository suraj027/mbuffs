import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        include: ['tests/**/*.integration.test.ts'],
        fileParallelism: false,
        sequence: {
            concurrent: false,
        },
        testTimeout: 30000,
        hookTimeout: 30000,
    },
});
