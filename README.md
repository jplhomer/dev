# dev

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
- `dev <task>` - run a task from nearest `dev.yml` (current directory or ancestors)
- `dev clone <owner/repo|git-url>` - clone a repository
- `dev cd <repo|owner/repo|path>` - print a project directory from configured dev roots
- `dev shell-init` - print shell integration so `dev cd <repo>` changes directory
- `dev root [list|add|remove] [path]` - manage dev roots (default: `~/src/github.com`)

## Project roots and `dev cd`

`dev` keeps a list of project roots in `~/.config/dev/config.yml`.

- Default root: `~/src/github.com`
- Add extra roots (for example `~/Projects`):

```bash
dev root add ~/Projects
```

- List configured roots:

```bash
dev root list
```

- Jump to a repo from anywhere:

```bash
cd "$(dev cd owner/repo)"
cd "$(dev cd my-repo)"
```

`dev cd` also matches directories with leading numeric prefixes (for example `2026-03-04-my-repo`), so `dev cd my-repo` still resolves.

- Optional shell integration (`zsh`/`bash`) so `dev cd <repo>` changes your current shell directory:

```bash
eval "$(dev shell-init)"
```

Add that line to your shell startup file (`~/.zshrc` or `~/.bashrc`) to keep it enabled.
With shell integration enabled, `dev clone <owner/repo|git-url>` also runs `dev cd` after a successful clone and moves into the cloned project automatically.

## `dev init`

`dev init` creates a `dev.yml` for the current directory.

- If `package.json` is present, it scaffolds `type: node`, `up: [install]`, and common tasks from scripts (`dev`/`start` and `format`/`lint`/`typecheck`/`test`).
- If `package.json` is missing, it scaffolds a generic starter config.

## `dev.yml` example

`dev up` and `dev <task>` resolve `dev.yml` by walking up from the current directory. This lets you run commands inside nested folders of a project while still using the project-root config.

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
