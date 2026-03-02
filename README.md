# dev-home

A lightweight `dev` CLI for local projects, inspired by workplace tooling.

## Install

```bash
npm install
npm link
```

Then run with:

```bash
dev --help
```

## Commands

- `dev init` - scaffold a `dev.yml` in the current project
- `dev up` - detect package manager and run install
- `dev <task>` - run a task from `dev.yml`
- `dev clone <owner/repo|git-url>` - clone a repository

## `dev init`

`dev init` creates a `dev.yml` for the current directory.

- If `package.json` is present, it scaffolds `type: node`, `up: [install]`, and common tasks from scripts (`dev`/`start` and `format`/`lint`/`typecheck`/`test`).
- If `package.json` is missing, it scaffolds a generic starter config.

## `dev.yml` example

```yaml
type: node

up:
  - install

tasks:
  server:
    aliases: [s]
    run: npm run dev

  check:
    format: npx oxfmt --check .
    lint: npm run lint
    typecheck: npm run typecheck
```

## Task formats

1. String task:

```yaml
tasks:
  test: npm test
```

2. `run` task with aliases:

```yaml
tasks:
  server:
    aliases: [s]
    run: npm run dev
```

3. Command object task (always parallel):

```yaml
tasks:
  check:
    lint: npm run lint
    types: npm run typecheck
```

## `up` package manager detection

Priority:

1. `pnpm-lock.yaml` -> `pnpm install`
2. `yarn.lock` -> `yarn install`
3. `bun.lockb` or `bun.lock` -> `bun install`
4. `package-lock.json` -> `npm install`
5. fallback -> `npm install`
