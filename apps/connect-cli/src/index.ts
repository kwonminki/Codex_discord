import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  buildDirectConfig,
  buildHubConfig,
  type ConnectMode,
  writeSetupFiles,
} from "./config.js";

function parseArgs(args: string[]): { command: string; flags: Map<string, string | boolean> } {
  const [command = "help", ...rest] = args;
  const flags = new Map<string, string | boolean>();

  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index];

    if (!arg.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);

    if (inlineValue !== undefined) {
      flags.set(key, inlineValue);
      continue;
    }

    const nextValue = rest[index + 1];

    if (nextValue && !nextValue.startsWith("--")) {
      flags.set(key, nextValue);
      index += 1;
    } else {
      flags.set(key, true);
    }
  }

  return { command, flags };
}

function flag(flags: Map<string, string | boolean>, name: string): string | undefined {
  const value = flags.get(name);
  return typeof value === "string" ? value : undefined;
}

async function askMissing(inputValue: string | undefined, question: string): Promise<string> {
  if (inputValue) {
    return inputValue;
  }

  const rl = createInterface({ input, output });

  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

async function setup(flags: Map<string, string | boolean>) {
  const mode = (flag(flags, "mode") ?? (flags.has("hub") ? "hub" : "direct")) as ConnectMode;
  const token = await askMissing(flag(flags, "token") ?? process.env.DISCORD_TOKEN, "Discord bot token: ");
  const guildId = await askMissing(flag(flags, "guild-id") ?? process.env.DISCORD_GUILD_ID, "Discord guild id: ");
  const roleIds = await askMissing(
    flag(flags, "role-ids") ?? process.env.DISCORD_ALLOWED_ROLE_IDS,
    "Allowed role ids, comma-separated: ",
  );

  const config =
    mode === "hub"
      ? buildHubConfig({
          token,
          guildId,
          roleIds,
          controlApiUrl: flag(flags, "control-api-url"),
          controlWsUrl: flag(flags, "control-ws-url"),
        })
      : buildDirectConfig({
          token,
          guildId,
          roleIds,
          channelId: await askMissing(flag(flags, "channel-id"), "Discord channel id: "),
          workspaceRoot: await askMissing(flag(flags, "workspace-root") ?? process.cwd(), "Workspace root: "),
          workspaceDisplayName: flag(flags, "workspace-name"),
          computerId: flag(flags, "computer-id"),
          computerDisplayName: flag(flags, "computer-name"),
          codexHome: flag(flags, "codex-home"),
        });

  await writeSetupFiles({ cwd: process.cwd(), config });

  console.info("Wrote .connect/config.json and .env");
  console.info(mode === "direct" ? "Start with: pnpm connect start --direct" : "Start with: pnpm connect start --hub");
}

async function status() {
  const configPath = ".connect/config.json";

  if (!existsSync(configPath)) {
    console.info("No .connect/config.json found. Run: pnpm connect setup --direct");
    return;
  }

  const rawConfig = await readFile(configPath, "utf8");
  const config = JSON.parse(rawConfig) as { mode?: unknown };
  console.info(`Connect config: ${configPath}`);
  console.info(`Mode: ${String(config.mode ?? "unknown")}`);
}

async function start(flags: Map<string, string | boolean>) {
  const mode = (flag(flags, "mode") ?? (flags.has("hub") ? "hub" : "direct")) as ConnectMode;
  const env = { ...process.env, CONNECT_CONFIG_PATH: ".connect/config.json", CONNECT_MODE: mode };
  const commands =
    mode === "hub"
      ? [
          ["pnpm", "dev:control"],
          ["pnpm", "dev:agent"],
          ["pnpm", "dev:bot"],
        ]
      : [["pnpm", "dev:bot"]];

  const children = commands.map(([cmd, script]) =>
    spawn(cmd, [script], {
      env,
      stdio: "inherit",
    }),
  );

  await Promise.race(
    children.map(
      (child) =>
        new Promise<void>((resolve, reject) => {
          child.once("exit", (code) => {
            if (code === 0) {
              resolve();
            } else {
              reject(new Error(`${child.spawnargs.join(" ")} exited with code ${code ?? "unknown"}`));
            }
          });
        }),
    ),
  );
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const { command, flags } = parseArgs(args);

  if (command === "setup" || command === "install" || command === "init") {
    await setup(flags);
    return;
  }

  if (command === "status") {
    await status();
    return;
  }

  if (command === "start") {
    await start(flags);
    return;
  }

  console.info("Usage:");
  console.info("  pnpm connect install --direct");
  console.info("  pnpm connect setup --direct");
  console.info("  pnpm connect setup --hub");
  console.info("  pnpm connect start --direct");
  console.info("  pnpm connect status");
}

const isDirectExecution =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectExecution) {
  await main();
}
