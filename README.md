# VaultDeck

VaultDeck is a local-first secrets manager and environment control panel for developers who want a single source of truth for API keys, tokens, and project configuration.

## Overview

VaultDeck is a personal developer tool that manages API keys, tokens, OAuth credentials, and environment variables in one place. Instead of scattering secrets across `.env` files, config files, and random folders, VaultDeck stores everything in a structured local vault and generates environment files on demand.

It provides a clean web interface for managing secrets and a system that can generate environment variables for shells and projects.

Design philosophy:

- local-first
- developer controlled
- simple infrastructure
- readable storage
- no cloud dependency

The source of truth is a hidden local vault directory:

```bash
~/.vaultdeck
```

## Why VaultDeck Exists

Developers running many local projects usually hit the same problems:

- API keys scattered across repos
- duplicated `.env` files everywhere
- resetting keys because values get lost
- credential files living in random folders
- painful machine switching and environment setup

VaultDeck solves this by centralizing secrets into one local vault and generating environment variables as needed per workflow.

## Key Features

### Local Secrets Vault
Stores API keys, tokens, credentials, and configuration in a structured vault directory.

### Web Interface
Clean UI for creating, editing, organizing, and searching secrets.

### Environment Generation
Automatically generates `.env` and shell export files from stored entries.

### Project Organization
Group secrets by project to keep environments organized.

### Credential File Storage
Securely store files such as OAuth client JSON credentials.

### Copy + Reveal Controls
Secret values are masked by default and can be revealed or copied when needed.

### Local-First Design
Everything runs locally and the vault directory is fully inspectable.

### No Cloud Dependency
Secrets are never sent to external services.

## Vault Directory Structure

```text
~/.vaultdeck/
├── entries/
├── files/
├── projects/
├── meta/
├── backups/
├── .env.generated
└── .env.exports.sh
```

- **entries/**  
  Stores secret entries and metadata for environment variables.

- **files/**  
  Stores uploaded credential files like OAuth client configs.

- **projects/**  
  Stores project-related configuration or project-specific env groupings.

- **meta/**  
  Internal metadata used by the application.

- **backups/**  
  Local snapshots and generated env backups.

- **.env.generated**  
  Standard environment file generated from stored secrets.

- **.env.exports.sh**  
  Shell-compatible export file used to load variables into terminal sessions.

## How Environment Variables Work

VaultDeck generates two formats from vault entries.

Example `.env.generated`:

```env
OPENAI_API_KEY=sk-xxxxx
BRAVE_API_KEY=xxxxx
```

Example `.env.exports.sh`:

```bash
export OPENAI_API_KEY="sk-xxxxx"
export BRAVE_API_KEY="xxxxx"
```

The shell export file can be sourced in shell configuration:

```bash
source "$HOME/.vaultdeck/.env.exports.sh"
```

Once sourced, VaultDeck variables are available in terminal sessions.

## Shell Integration

Add this line to `~/.zshrc` or `~/.bashrc`:

```bash
[ -f "$HOME/.vaultdeck/.env.exports.sh" ] && source "$HOME/.vaultdeck/.env.exports.sh"
```

This loads VaultDeck variables whenever a shell starts.

## Global env for services (systemd user)

VaultDeck can also generate a user-scoped global env file for long-running services:

```text
~/.config/environment.d/90-vaultdeck.conf
```

Commands:

```bash
vaultdeck global enable
vaultdeck global status
vaultdeck global disable
```

How it works:
- `global enable` turns on global mode and regenerates env files.
- Every `vaultdeck regen` updates `90-vaultdeck.conf` when global mode is enabled.
- Services using the systemd user manager can read these vars after service restart (or relogin in some setups).

Troubleshooting:
- If a service does not see new values, run `vaultdeck regen` then restart the service.
- If needed, logout/login to refresh the user manager environment fully.

## Security Model (Current)

VaultDeck is currently designed for local development environments and does **not** yet implement encrypted storage.

Current protections include:

- local filesystem storage
- restricted file permissions
- masked secrets in the UI
- secrets excluded from git
- no external transmission of secrets

Planned hardening includes encryption-at-rest and vault unlock mechanisms.

## Running VaultDeck

1. Clone the repository
2. Install dependencies
3. Run the development server
4. Open the web interface

```bash
git clone <your-repo-url>
cd VaultDeck
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

## CLI Quick Checks

```bash
vaultdeck start
vaultdeck ui-status
vaultdeck restart
vaultdeck stop
vaultdeck global status
vaultdeck check-update
vaultdeck update
vaultdeck status
vaultdeck regen
vaultdeck doctor
eval "$(vaultdeck apply --regen)"
```

`vaultdeck doctor` runs baseline local safety checks (permissions + env generation health).

## UI Runtime Settings

VaultDeck supports a project-level runtime settings file:

```text
./vaultdeck.settings.json
```

Example:

```json
{
  "ui": {
    "host": "127.0.0.1",
    "port": 8120
  }
}
```

Override order:

1. `VAULTDECK_HOST` / `VAULTDECK_PORT` environment variables
2. `vaultdeck.settings.json`
3. Built-in defaults (`127.0.0.1:3000`)

You can edit these in the web UI at `/settings` and use start/stop/restart controls there.

## Roadmap

- encryption at rest
- vault unlock/passphrase system
- CLI interface expansion
- project-specific `.env` generation
- automatic key rotation helpers
- secret scanning
- backup + restore tools
- Tailscale vault sync

## Philosophy

VaultDeck is built to keep secret management under developer control: local, inspectable, and practical. No required cloud service, no heavy infrastructure, no black box.

The goal is simple: one reliable source of truth for local development environments.
