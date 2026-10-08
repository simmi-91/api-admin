export default {
    testEnvironment: "node",
    extensionsToTreatAsEsm: [".ts"],
    moduleNameMapper: {
        "^(\\.{1,2}/.*)\\.js$": "$1",
    },
    transform: {
        "^.+\\.ts$": ["ts-jest", { useESM: true }],
    },
    testMatch: ["**/tests/**/*.test.ts"],
    collectCoverageFrom: ["src/**/*.ts", "server.ts", "!src/**/*.d.ts", "!src/**/*.test.ts"],
};
