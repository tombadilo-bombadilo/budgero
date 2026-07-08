# Budgero Self-host CLI

`budgero` is both the API/web server binary and a small helper CLI for day-two operations. It exposes dedicated subcommands to launch the server, administer users, and manage background daemons.

Use `budgero --help` to see every option, including in-place updates and uninstall support.

## Installation scripts

- **macOS / Linux:** `curl -fsSL https://budgero.app/install.sh | bash`
- **Windows:** `irm https://budgero.app/install.ps1 | iex`

Each script accepts an explicit `--version`/`-Version` argument if you want to pin a release. You can also download them directly from `/install.sh` and `/install.ps1`.

## Running the server

```bash
./budgero serve
```

That's it. The server runs on port 3001 by default and auto-generates an admin account on first run.

For custom configuration, all flags are optional:

```bash
./budgero serve \
  --port 4000 \
  --currency-api-key "$CURRENCYLAYER_API_KEY" \
  --env RATE_LIMIT_RPS=5
```

The `--env KEY=VALUE` flag is repeatable and lets you set any runtime variables without touching a file.

The process still loads `.env` from the working directory (using `godotenv`) before starting Echo, so long-lived deployments can mix files and flags.

## Environment variables

| Variable                   | Default            | Description                                    |
|----------------------------|--------------------|-------------------------------------------------|
| `PORT`                     | `3001`             | HTTP server port                               |
| `DB_PATH`                  | `data/budgero.db`  | SQLite database file path                      |
| `LOG_LEVEL`                | `info`             | `debug`, `info`, `warn`, `error`               |
| `CURRENCYLAYER_API_KEY`    | -                  | Optional: multi-currency conversion            |

### Docker deployment

```bash
docker run -d \
  --name budgero \
  -p 127.0.0.1:3001:3001 \
  -v budgero_data:/data \
  budgero/budgero
```

On first startup, check logs for admin credentials:

```bash
docker logs budgero
```

```
  Admin account created:
    Username: admin
    Password: Rk8mP7yQvCw4T2aZ

  ⚠️  Save this password now - it will NOT be shown again.
```

### Docker Compose

```yaml
services:
  budgero:
    image: budgero/budgero:latest
    ports:
      - "127.0.0.1:3001:3001"
    volumes:
      - budgero_data:/data
    restart: unless-stopped

volumes:
  budgero_data:
```

### Binary deployment

Just run `budgero serve`. On first startup, admin credentials print directly to your terminal. Optionally create a `.env` file next to the binary:

```bash
PORT=3001
LOG_LEVEL=info
CURRENCYLAYER_API_KEY=...  # optional, for multi-currency
```

For daemon mode, check `data/logs/<name>.log` for the initial credentials.

## User management

### Admin UI

Access the admin dashboard at `/admin` in your browser to manage users, view activity, and configure settings.

### CLI commands

Use `./budgero admin --help` to see available subcommands. All operations run against the same SQLite database.

### Create or promote a user

```bash
./budgero admin create-user \
  --username admin \
  --name "Site Admin" \
  --password "change-me" \
  --admin
```

- If the username already exists the CLI updates that user's password/admin flag.
- `--admin` defaults to `true`. Set it to `false` to create regular users.

### Reset a password

```bash
./budgero admin reset-password \
  --username johndoe \
  --password "new-secret"
```

The command retains the user's current admin role.

### List users

```bash
./budgero admin list-users
```

Prints each user's username, admin flag, block status, and last login timestamp.

### Toggle admin access

```bash
./budgero admin set-admin --username johndoe --enable=false
```

Use `--enable=true` (default) to grant admin privileges or `--enable=false` to revoke them.

### Block or unblock a user

```bash
./budgero admin block-user --username johndoe
./budgero admin unblock-user --username johndoe
```

Blocked users are immediately signed out and all API requests are rejected until unblocked.

### Reset master password state

```bash
./budgero admin reset-master --username johndoe
```

Clears the user's encrypted database, onboarding progress, and master-password flag so they can upload a fresh OPFS backup.

### Delete a user

```bash
./budgero admin delete-user --username johndoe
```

Removes the account entirely (including owned spaces and blobs). Use with care.

## Daemon helper

The `daemon` subtree lets you run the server as background processes without systemd/Docker. Metadata is persisted to `data/selfhost-daemons.json` so you can inspect and stop processes later.

### Start

```bash
./budgero daemon start --name production
```

Or with optional configuration:

```bash
./budgero daemon start \
  --port 4000 \
  --name staging \
  --env-file .env.staging \
  --log-dir data/logs
```

- Generates a unique daemon ID and writes logs to `<log-dir>/<name>.log`.
- Loads the specified env file (merged with the current environment) before spawning the server.
- Detaches after printing the PID/log path.

### List

```bash
./budgero daemon list
```

Shows ID, PID, port, start time, and whether each recorded process is currently running.

### Stop / Kill

```bash
./budgero daemon stop staging
./budgero daemon stop 12345      # by PID
./budgero daemon stop f3a1bc42   # by ID prefix
```

Sends `SIGTERM` (and escalates to `SIGKILL` after a short timeout on POSIX) before removing the record from the state file.

## Customizing paths

- `SELFHOST_CLI_STATE_PATH` – override where the daemon state JSON file is stored.
- `--log-dir` – set the directory for daemon log files (default `data/logs`).

## Getting help

- `./budgero --help`
- `./budgero admin --help`
- `./budgero daemon --help`

These commands are powered by Cobra, so you also get shell completions and consistent flag parsing if you need to extend the CLI later.

## Uninstalling

Use the dedicated command to remove the installed binary (POSIX only):

```bash
budgero uninstall
```

On Linux and macOS this deletes the currently running executable (typically `~/.local/bin/budgero`). Your SQLite databases and other data directories are left untouched—remove them manually if desired. Windows users should delete the `budgero.exe` file manually because the OS prevents removing a running binary.

## Updating

Check for and install the latest release without re-running the bootstrap script:

```bash
budgero update
```

The CLI compares your current version with `latest.txt` in the release bucket, ensures no Budgero server process is running, and then downloads and swaps in the appropriate binary for your platform. On Windows the command transparently launches a temporary helper copy of Budgero so the main executable can be replaced safely, so the only prerequisite is that your server/daemon isn’t running.
