import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { parse, stringify } from "yaml";

function fileExists(filePath) {
  return fs.existsSync(filePath);
}

function findDevConfigPath(cwd = process.cwd()) {
  let dir = path.resolve(cwd);

  while (true) {
    const devPath = path.join(dir, "dev.yml");
    if (fileExists(devPath)) {
      return devPath;
    }

    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }

    dir = parent;
  }
}

function readDevConfig(cwd = process.cwd()) {
  const devPath = findDevConfigPath(cwd);
  if (!devPath) {
    throw new Error("No dev.yml found in current directory or ancestors");
  }

  const raw = fs.readFileSync(devPath, "utf8");
  const parsed = parse(raw) ?? {};

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("dev.yml must contain a YAML object at the root");
  }

  return parsed;
}

function resolveDevConfig(cwd = process.cwd()) {
  const devPath = findDevConfigPath(cwd);
  if (!devPath) {
    throw new Error("No dev.yml found in current directory or ancestors");
  }

  const raw = fs.readFileSync(devPath, "utf8");
  const parsed = parse(raw) ?? {};

  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("dev.yml must contain a YAML object at the root");
  }

  return {
    config: parsed,
    configDir: path.dirname(devPath),
  };
}

function findPackageManager(cwd = process.cwd()) {
  const checks = [
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["package-lock.json", "npm"],
  ];

  for (const [file, manager] of checks) {
    if (fileExists(path.join(cwd, file))) {
      return manager;
    }
  }

  return "npm";
}

function installCommandFor(manager) {
  switch (manager) {
    case "pnpm":
      return { cmd: "pnpm", args: ["install"] };
    case "yarn":
      return { cmd: "yarn", args: ["install"] };
    case "bun":
      return { cmd: "bun", args: ["install"] };
    case "npm":
    default:
      return { cmd: "npm", args: ["install"] };
  }
}

function scriptRunCommandFor(manager, scriptName) {
  switch (manager) {
    case "pnpm":
      return { cmd: "pnpm", args: ["run", scriptName] };
    case "yarn":
      return { cmd: "yarn", args: ["run", scriptName] };
    case "bun":
      return { cmd: "bun", args: ["run", scriptName] };
    case "npm":
    default:
      return { cmd: "npm", args: ["run", scriptName] };
  }
}

function readPackageScripts(cwd = process.cwd()) {
  const pkg = readPackageJson(cwd);
  if (!pkg) {
    return null;
  }

  const scripts = pkg?.scripts;

  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
    return null;
  }

  return scripts;
}

function readPackageJson(cwd = process.cwd()) {
  const packageJsonPath = path.join(cwd, "package.json");
  if (!fileExists(packageJsonPath)) {
    return null;
  }

  const raw = fs.readFileSync(packageJsonPath, "utf8");
  return JSON.parse(raw);
}

function spawnCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const shell = options.shell ?? false;
    const child = spawn(command, args, {
      stdio: "inherit",
      shell,
      cwd: options.cwd ?? process.cwd(),
    });

    child.on("close", (code) => {
      resolve(code ?? 1);
    });

    child.on("error", () => {
      resolve(1);
    });
  });
}

function normalizeTasks(config) {
  const tasks = config.tasks ?? {};
  if (typeof tasks !== "object" || tasks === null || Array.isArray(tasks)) {
    throw new Error("`tasks` in dev.yml must be an object");
  }
  return tasks;
}

function resolveTask(tasks, taskName) {
  if (taskName in tasks) {
    return { taskKey: taskName, definition: tasks[taskName] };
  }

  for (const [key, def] of Object.entries(tasks)) {
    if (typeof def === "object" && def !== null && !Array.isArray(def)) {
      const aliases = def.aliases;
      if (Array.isArray(aliases) && aliases.includes(taskName)) {
        return { taskKey: key, definition: def };
      }
    }
  }

  return null;
}

async function runTaskCommands(taskName, commands, cwd = process.cwd()) {
  const entries = Object.entries(commands);
  const results = await Promise.all(
    entries.map(async ([stepName, stepCmd]) => {
      if (typeof stepCmd !== "string") {
        throw new Error(`Task ${taskName} check ${stepName} must be a string command`);
      }
      console.log(`[${taskName}:${stepName}] starting`);
      const code = await spawnCommand(stepCmd, [], { cwd, shell: true });
      if (code === 0) {
        console.log(`[${taskName}:${stepName}] success`);
      } else {
        console.error(`[${taskName}:${stepName}] failed (${code})`);
      }
      return code;
    }),
  );

  return results.every((code) => code === 0) ? 0 : 1;
}

const TASK_METADATA_KEYS = new Set(["aliases", "description"]);

async function runTaskDefinition(taskName, definition, cwd = process.cwd()) {
  if (typeof definition === "string") {
    const code = await spawnCommand(definition, [], { cwd, shell: true });
    return code;
  }

  if (typeof definition !== "object" || definition === null || Array.isArray(definition)) {
    throw new Error(`Task ${taskName} has invalid configuration`);
  }

  if (typeof definition.run === "string") {
    return spawnCommand(definition.run, [], { cwd, shell: true });
  }

  const commandEntries = Object.entries(definition).filter(
    ([key]) => !TASK_METADATA_KEYS.has(key),
  );
  const hasCommandObject =
    commandEntries.length > 0 && commandEntries.every(([, value]) => typeof value === "string");

  if (hasCommandObject) {
    return runTaskCommands(taskName, Object.fromEntries(commandEntries), cwd);
  }

  throw new Error(`Task ${taskName} must be a string, { run }, or command object`);
}

function normalizeRepo(input) {
  if (/^(https?:\/\/|git@|ssh:\/\/)/.test(input) || input.endsWith(".git")) {
    return input;
  }
  if (/^[^\s/]+\/[^\s/]+$/.test(input)) {
    return `https://github.com/${input}.git`;
  }
  throw new Error("clone target must be owner/repo or a git URL");
}

function repoFolderName(repo) {
  const cleaned = repo.replace(/\.git$/, "");
  const segments = cleaned.split("/");
  return segments[segments.length - 1];
}

function createInitConfig(cwd = process.cwd()) {
  const pkg = readPackageJson(cwd);

  if (!pkg) {
    return {
      type: "generic",
      up: [],
      tasks: {},
    };
  }

  const manager = findPackageManager(cwd);
  const scripts = readPackageScripts(cwd) ?? {};
  const runWithManager = (scriptName) => `${scriptRunCommandFor(manager, scriptName).cmd} run ${scriptName}`;

  const tasks = {};

  if (typeof scripts.dev === "string") {
    tasks.server = {
      aliases: ["s"],
      description: "Start local dev server",
      run: runWithManager("dev"),
    };
  } else if (typeof scripts.start === "string") {
    tasks.server = {
      aliases: ["s"],
      description: "Start local app",
      run: runWithManager("start"),
    };
  }

  const checkScriptNames = ["format", "lint", "typecheck", "test"];
  const checkCommands = {};
  for (const scriptName of checkScriptNames) {
    if (typeof scripts[scriptName] === "string") {
      checkCommands[scriptName] = runWithManager(scriptName);
    }
  }

  if (Object.keys(checkCommands).length > 0) {
    tasks.check = {
      description: "Run project checks",
      ...checkCommands,
    };
  }

  return {
    type: "node",
    up: ["install"],
    tasks,
  };
}

async function handleInit(cwd = process.cwd()) {
  const devPath = path.join(cwd, "dev.yml");
  if (devPath && fileExists(devPath)) {
    throw new Error("dev.yml already exists in current directory");
  }

  const config = createInitConfig(cwd);
  const content = stringify(config, {
    lineWidth: 0,
  });
  fs.writeFileSync(devPath, content, "utf8");

  console.log("Created dev.yml");
  return 0;
}

async function handleClone(target, cwd = process.cwd()) {
  if (!target) {
    throw new Error("Usage: dev clone <owner/repo|git-url>");
  }

  const repo = normalizeRepo(target);
  const code = await spawnCommand("git", ["clone", repo], { cwd });
  if (code !== 0) {
    return code;
  }

  const folder = repoFolderName(repo);
  console.log(`\nCloned successfully.`);
  console.log(`Next: cd ${folder}`);
  return 0;
}

async function handleUp(cwd = process.cwd()) {
  const { config, configDir } = resolveDevConfig(cwd);
  const manager = findPackageManager(configDir);
  const up = config.up;

  const shouldInstall = !Array.isArray(up) || up.length === 0 || up.includes("install");

  if (!shouldInstall) {
    console.log("No supported up steps found; skipping");
    return 0;
  }

  const command = installCommandFor(manager);
  console.log(`Using ${manager}: ${command.cmd} ${command.args.join(" ")}`);
  return spawnCommand(command.cmd, command.args, { cwd: configDir });
}

function formatTaskDescriptor(taskName, definition) {
  let description = "";
  let aliases = [];

  if (typeof definition === "object" && definition !== null && !Array.isArray(definition)) {
    if (typeof definition.description === "string") {
      description = definition.description.trim();
    }

    aliases = Array.isArray(definition.aliases) ? definition.aliases : [];
  }

  const parts = [taskName];

  if (description) {
    parts.push(`- ${description}`);
  }

  if (aliases.length > 0) {
    parts.push(`(aliases: ${aliases.join(", ")})`);
  }

  if (parts.length > 1) {
    return parts.join(" ");
  }

  return taskName;
}

function printHelp(cwd = process.cwd()) {
  const lines = [
    "dev - simple project task runner",
    "",
    "Usage:",
    "  dev init",
    "  dev up",
    "  dev clone <owner/repo|git-url>",
    "  dev <task>",
    "",
    "Examples:",
    "  dev up",
    "  dev s",
    "  dev check",
    "  dev clone myorg/myrepo",
    "  dev clone git@github.com:myorg/myrepo.git",
  ];

  const devPath = findDevConfigPath(cwd);
  if (fileExists(devPath)) {
    try {
      const config = readDevConfig(cwd);
      const tasks = normalizeTasks(config);
      const taskNames = Object.keys(tasks);

      if (taskNames.length > 0) {
        lines.push("", "Project Tasks:");
        for (const taskName of taskNames) {
          lines.push(`  ${formatTaskDescriptor(taskName, tasks[taskName])}`);
        }
      }
    } catch {
      // Ignore project task listing errors in help output.
    }
  }

  console.log(lines.join("\n"));
}

export async function runCli(args, cwd = process.cwd()) {
  const [command] = args;
  const reservedCommands = new Set(["init", "up", "clone", "help", "--help", "-h"]);

  if (!command || command === "-h" || command === "--help" || command === "help") {
    printHelp(cwd);
    return 0;
  }

  if (command === "clone") {
    const code = await handleClone(args[1], cwd);
    if (code !== 0) process.exitCode = code;
    return code;
  }

  if (command === "init") {
    const code = await handleInit(cwd);
    if (code !== 0) process.exitCode = code;
    return code;
  }

  if (command === "up") {
    const code = await handleUp(cwd);
    if (code !== 0) process.exitCode = code;
    return code;
  }

  const { config, configDir } = resolveDevConfig(cwd);
  const tasks = normalizeTasks(config);
  const resolved = resolveTask(tasks, command);

  if (resolved) {
    const code = await runTaskDefinition(resolved.taskKey, resolved.definition, configDir);
    if (code !== 0) {
      process.exitCode = code;
    }
    return code;
  }

  if (!reservedCommands.has(command)) {
    const scripts = readPackageScripts(configDir);
    if (scripts && typeof scripts[command] === "string") {
      const manager = findPackageManager(configDir);
      const scriptCommand = scriptRunCommandFor(manager, command);
      const code = await spawnCommand(scriptCommand.cmd, scriptCommand.args, { cwd: configDir });
      if (code !== 0) {
        process.exitCode = code;
      }
      return code;
    }
  }

  throw new Error(`Task not found: ${command}`);
}

export const _internal = {
  createInitConfig,
  findPackageManager,
  installCommandFor,
  scriptRunCommandFor,
  readPackageJson,
  readPackageScripts,
  resolveTask,
  findDevConfigPath,
  normalizeRepo,
  repoFolderName,
};
