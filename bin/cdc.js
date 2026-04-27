#!/usr/bin/env node
import "tsx/esm";

const { main } = await import("../apps/connect-cli/src/index.ts");

await main();
