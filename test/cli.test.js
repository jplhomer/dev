import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";

import { _internal, runCli } from "../src/cli.js";

function captureStdout(fn) {
  const originalWrite = process.stdout.write;
  let output = "";

  process.stdout.write = (chunk, encoding, callback) => {
    output += typeof chunk === "string" ? chunk : chunk.toString();
    if (typeof callback === "function") {
      callback();
    }
    return true;
  };

  return Promise.resolve(fn())
    .then(() => output)
    .finally(() => {
      process.stdout.write = originalWrite;
    });
}

async function withTempDir(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-cli-"));
  try {
    await fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("findPackageManager prioritizes lockfiles", async () => {
  await withTempDir(async (dir) => {
    fs.writeFileSync(path.join(dir, "yarn.lock"), "");
    assert.equal(_internal.findPackageManager(dir), "yarn");

    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "");
    assert.equal(_internal.findPackageManager(dir), "pnpm");
  });
});

test("installCommandFor returns proper commands", () => {
  assert.deepEqual(_internal.installCommandFor("npm"), { cmd: "npm", args: ["install"] });
  assert.deepEqual(_internal.installCommandFor("pnpm"), { cmd: "pnpm", args: ["install"] });
  assert.deepEqual(_internal.installCommandFor("yarn"), { cmd: "yarn", args: ["install"] });
  assert.deepEqual(_internal.installCommandFor("bun"), { cmd: "bun", args: ["install"] });
});

test("scriptRunCommandFor returns proper commands", () => {
  assert.deepEqual(_internal.scriptRunCommandFor("npm", "test"), {
    cmd: "npm",
    args: ["run", "test"],
  });
  assert.deepEqual(_internal.scriptRunCommandFor("pnpm", "test"), {
    cmd: "pnpm",
    args: ["run", "test"],
  });
  assert.deepEqual(_internal.scriptRunCommandFor("yarn", "test"), {
    cmd: "yarn",
    args: ["run", "test"],
  });
  assert.deepEqual(_internal.scriptRunCommandFor("bun", "test"), {
    cmd: "bun",
    args: ["run", "test"],
  });
});

test("resolveTask resolves direct and aliases", () => {
  const tasks = {
    server: { aliases: ["s"], run: "npm run dev" },
    check: { lint: "npm run lint" },
  };

  const direct = _internal.resolveTask(tasks, "check");
  assert.equal(direct?.taskKey, "check");

  const alias = _internal.resolveTask(tasks, "s");
  assert.equal(alias?.taskKey, "server");

  const missing = _internal.resolveTask(tasks, "nope");
  assert.equal(missing, null);
});

test("normalizeRepo accepts shorthand and urls", () => {
  assert.equal(_internal.normalizeRepo("owner/repo"), "https://github.com/owner/repo.git");
  assert.equal(
    _internal.normalizeRepo("https://github.com/owner/repo.git"),
    "https://github.com/owner/repo.git",
  );
  assert.equal(
    _internal.normalizeRepo("git@github.com:owner/repo.git"),
    "git@github.com:owner/repo.git",
  );
});

test("repoFolderName strips .git suffix", () => {
  assert.equal(_internal.repoFolderName("https://github.com/owner/repo.git"), "repo");
  assert.equal(_internal.repoFolderName("git@github.com:owner/repo.git"), "repo");
});

test("readPackageScripts returns scripts object when present", async () => {
  await withTempDir(async (dir) => {
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { test: "node --test" } }),
    );
    const scripts = _internal.readPackageScripts(dir);
    assert.deepEqual(scripts, { test: "node --test" });
  });
});

test("runCli falls back to package scripts when task missing", async () => {
  await withTempDir(async (dir) => {
    fs.writeFileSync(
      path.join(dir, "dev.yml"),
      'tasks:\n  server:\n    run: node -e "process.exit(0)"\n',
    );
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({ scripts: { test: 'node -e "process.exit(0)"' } }),
    );

    const code = await runCli(["test"], dir);
    assert.equal(code, 0);
  });
});

test("runCli help lists project tasks and aliases", async () => {
  await withTempDir(async (dir) => {
    fs.writeFileSync(
      path.join(dir, "dev.yml"),
      [
        "tasks:",
        "  server:",
        "    description: Start local dev server",
        "    aliases: [s]",
        "    run: npm run dev",
        "  check:",
        "    lint: npm run lint",
      ].join("\n"),
    );

    const output = await captureStdout(() => runCli(["--help"], dir));
    assert.match(output, /Project Tasks:/);
    assert.match(output, /server - Start local dev server \(aliases: s\)/);
    assert.match(output, /check/);
  });
});

test("createInitConfig scaffolds generic config without package.json", async () => {
  await withTempDir(async (dir) => {
    const config = _internal.createInitConfig(dir);
    assert.deepEqual(config, {
      type: "generic",
      up: [],
      tasks: {},
    });
  });
});

test("createInitConfig scaffolds node defaults from package scripts", async () => {
  await withTempDir(async (dir) => {
    fs.writeFileSync(path.join(dir, "yarn.lock"), "");
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        scripts: {
          dev: "vite",
          lint: "eslint .",
          typecheck: "tsc --noEmit",
          test: "vitest",
        },
      }),
    );

    const config = _internal.createInitConfig(dir);
    assert.deepEqual(config, {
      type: "node",
      up: ["install"],
      tasks: {
        server: {
          aliases: ["s"],
          description: "Start local dev server",
          run: "yarn run dev",
        },
        check: {
          description: "Run project checks",
          lint: "yarn run lint",
          typecheck: "yarn run typecheck",
          test: "yarn run test",
        },
      },
    });
  });
});

test("runCli init writes dev.yml from package defaults", async () => {
  await withTempDir(async (dir) => {
    fs.writeFileSync(path.join(dir, "package-lock.json"), "{}");
    fs.writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify({
        scripts: {
          start: "node server.js",
          format: "prettier --check .",
        },
      }),
    );

    const code = await runCli(["init"], dir);
    assert.equal(code, 0);

    const devYmlPath = path.join(dir, "dev.yml");
    assert.equal(fs.existsSync(devYmlPath), true);

    const parsed = parse(fs.readFileSync(devYmlPath, "utf8"));
    assert.deepEqual(parsed, {
      type: "node",
      up: ["install"],
      tasks: {
        server: {
          aliases: ["s"],
          description: "Start local app",
          run: "npm run start",
        },
        check: {
          description: "Run project checks",
          format: "npm run format",
        },
      },
    });
  });
});

test("runCli init fails when dev.yml already exists", async () => {
  await withTempDir(async (dir) => {
    fs.writeFileSync(path.join(dir, "dev.yml"), "tasks: {}\n");

    await assert.rejects(
      () => runCli(["init"], dir),
      /dev.yml already exists in current directory/,
    );
  });
});

test("runCli ignores description metadata in command-object tasks", async () => {
  await withTempDir(async (dir) => {
    fs.writeFileSync(
      path.join(dir, "dev.yml"),
      [
        "tasks:",
        "  check:",
        "    description: Run validations",
        '    lint: node -e "process.exit(0)"',
      ].join("\n"),
    );

    const code = await runCli(["check"], dir);
    assert.equal(code, 0);
  });
});
