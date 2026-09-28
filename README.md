# Taiga Metrics

Flow and team metrics for self-hosted [Taiga](https://taiga.io): lead and cycle time, time in statuses, throughput, stuck cards, Scrum sprints and Kanban boards, per project and per person.

Taiga Metrics is an extension that runs next to your Taiga. It never changes Taiga. It needs no plugin and does not touch Taiga's code, containers, frontend, configuration or database schema. It reads Taiga's PostgreSQL directly and **read-only**: every connection is opened with `default_transaction_read_only=on`. Its own data lives in a separate PostgreSQL. People sign in with their usual Taiga username and password.

- Works with any process: statuses, columns and roles are read from each project's settings, never assumed.
- Only the sections switched on in Taiga's project settings are shown (Epics, Scrum, Kanban, Issues).
- Data is copied from Taiga every hour (configurable). You can also start a copy by hand.

> Taiga Metrics is an independent open-source project. It is not affiliated with, endorsed by or supported by Taiga or Kaleidos Inc. Taiga is a trademark of its owners and is named here only to say what this extension works with.

## Contents

- [Requirements](#requirements)
- [Install next to taiga-docker](#install-next-to-taiga-docker)
- [First steps](#first-steps)
- [Configuration](#configuration)
- [Serving it on a domain](#serving-it-on-a-domain)
- [A read-only database user (optional)](#a-read-only-database-user-optional)
- [Update](#update)
- [Stop, remove, uninstall](#stop-remove-uninstall)
- [Other Taiga installations](#other-taiga-installations)
- [Troubleshooting](#troubleshooting)
- [Development](#development)
- [License and trademarks](#license-and-trademarks)

## Requirements

- Taiga installed with the official [taiga-docker](https://github.com/taigaio/taiga-docker). Tested with Taiga 6.9. For other setups see [Other Taiga installations](#other-taiga-installations).
- Docker with Docker Compose v2.20 or later (`docker compose version`).
- About 300 MB of RAM for the extension and its database.

## Install next to taiga-docker

The extension is installed into the same folder as Taiga's `docker-compose.yml`. It has to be in the same folder: that way it joins Taiga's Docker network, reaches Taiga's database and media, and reads the database credentials from Taiga's `.env`. None of Taiga's files are edited.

1. Go to your taiga-docker folder:

   ```bash
   cd /path/to/taiga-docker
   ```

2. Download the extension's compose file and helper script from the latest release:

   ```bash
   curl -fsSLO https://github.com/DVSAWR/taiga-metrics-extension/releases/latest/download/taiga-metrics.yml
   curl -fsSLO https://github.com/DVSAWR/taiga-metrics-extension/releases/latest/download/taiga-metrics.sh
   chmod +x taiga-metrics.sh
   ```

3. Optional: create your own settings file (see [Configuration](#configuration)). This is where you change the port or set a password for the extension's database:

   ```bash
   curl -fsSL -o taiga-metrics.env https://github.com/DVSAWR/taiga-metrics-extension/releases/latest/download/taiga-metrics.env.example
   ```

4. Start the extension:

   ```bash
   ./taiga-metrics.sh up
   ```

5. Open `http://<your-server>:9100` and sign in with your Taiga account.

The first copy of Taiga's data starts right away. On a large project it can take a few minutes.

Taiga keeps running as before. `launch-taiga.sh` and `taiga-manage.sh` only read Taiga's own compose file, so they do not start or stop the extension. The extension restarts with Docker unless you stop it.

### The helper script

`taiga-metrics.sh` runs `docker compose` with Taiga's `docker-compose.yml`, `taiga-metrics.yml`, Taiga's `.env` and, if it exists, `taiga-metrics.env`. It acts only on the extension's three services.

| Command                        | What it does                                                      |
| ------------------------------ | ----------------------------------------------------------------- |
| `./taiga-metrics.sh up`        | Start the extension, or apply changed settings                    |
| `./taiga-metrics.sh update`    | Pull the image set in `taiga-metrics.yml` and restart             |
| `./taiga-metrics.sh stop`      | Stop the extension                                                |
| `./taiga-metrics.sh remove`    | Stop the extension and remove its containers; the data is kept    |
| `./taiga-metrics.sh status`    | Show the extension's containers                                   |
| `./taiga-metrics.sh logs`      | Follow the logs                                                   |
| `./taiga-metrics.sh sync`      | Copy Taiga's data now instead of waiting for the next hourly copy |
| `./taiga-metrics.sh compose …` | Any other `docker compose` command with the extension's files     |

Without the script, the same thing by hand:

```bash
docker compose -f docker-compose.yml -f taiga-metrics.yml up -d taiga-metrics taiga-metrics-worker taiga-metrics-db
```

## First steps

Who sees what follows Taiga's accounts and roles:

| Who                   | What they can do                                                      |
| --------------------- | --------------------------------------------------------------------- |
| Taiga superuser       | See and configure every project                                       |
| Project owner, admins | See everything in their project and configure it                      |
| Project member        | See only what the owner granted to their role; **nothing by default** |

For every project, the owner opens **Settings** in the extension and:

1. **General:** marks each status as Queue, Work, Rework, Done or Cancelled, per card type. Work and Done are required. Until then lead time, cycle time and throughput are not measured.
2. **Calendar:** sets working days and hours, so durations can count working time.
3. **Access:** chooses what each Taiga role may see.

Nothing is guessed from status names: two teams can call the same thing differently.

## Configuration

Put your settings in `taiga-metrics.env` next to `taiga-metrics.yml` and run `./taiga-metrics.sh up` to apply them. Every variable is optional.

| Variable                              | Default                                            | Meaning                                                                                       |
| ------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `TAIGA_METRICS_PORT`                  | `9100`                                             | Port the extension listens on                                                                 |
| `TAIGA_METRICS_BIND`                  | `0.0.0.0`                                          | Address to listen on; `127.0.0.1` to reach it only through a reverse proxy on the same server |
| `TAIGA_METRICS_DB_PASSWORD`           | `taiga_metrics`                                    | Password of the extension's own database; set it before the first start                       |
| `TAIGA_METRICS_SYNC_INTERVAL_SECONDS` | `3600`                                             | How often Taiga's data is copied                                                              |
| `TAIGA_METRICS_TAIGA_DB_USER`         | `POSTGRES_USER` from Taiga's `.env`                | User for reading Taiga's database, see [below](#a-read-only-database-user-optional)           |
| `TAIGA_METRICS_TAIGA_DB_PASSWORD`     | `POSTGRES_PASSWORD` from Taiga's `.env`            | Its password                                                                                  |
| `TAIGA_METRICS_VERSION`               | the release you downloaded                         | Image version to run                                                                          |
| `TAIGA_METRICS_IMAGE`                 | `ghcr.io/dvsawr/taiga-metrics-extension:<version>` | Full image name, for a mirror or your own build                                               |

Links from the extension back to Taiga use `TAIGA_SCHEME`, `TAIGA_DOMAIN` and `SUBPATH` from Taiga's `.env`.

Changing `TAIGA_METRICS_DB_PASSWORD` after the first start does not change the password inside the existing database. To change it, remove the extension's data (see [Uninstall](#stop-remove-uninstall)) and start again, or change it in PostgreSQL yourself.

## Serving it on a domain

For production, put the extension behind the reverse proxy that already serves your sites, on its own domain, for example `metrics.example.com`. Use HTTPS, since people type their Taiga password there. Set `TAIGA_METRICS_BIND=127.0.0.1` so the port is not open to the outside.

Do not add it to Taiga's own gateway (`taiga-gateway`): that would mean changing Taiga's configuration.

nginx:

```nginx
server {
    listen 443 ssl;
    server_name metrics.example.com;

    ssl_certificate     /etc/letsencrypt/live/metrics.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/metrics.example.com/privkey.pem;

    location / {
        proxy_pass http://127.0.0.1:9100;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Caddy:

```caddy
metrics.example.com {
    reverse_proxy 127.0.0.1:9100
}
```

## A read-only database user (optional)

By default the extension reads Taiga's database as Taiga's own user and makes every connection read-only. For extra safety, a database administrator can create a user that can only read, and give it to the extension. The extension never runs these commands itself: it does not write to Taiga's database.

```bash
docker compose exec -T taiga-db psql -U taiga taiga <<'SQL'
CREATE ROLE taiga_metrics_reader LOGIN PASSWORD 'choose-a-password';
GRANT CONNECT ON DATABASE taiga TO taiga_metrics_reader;
GRANT USAGE ON SCHEMA public TO taiga_metrics_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO taiga_metrics_reader;
ALTER DEFAULT PRIVILEGES FOR ROLE taiga IN SCHEMA public GRANT SELECT ON TABLES TO taiga_metrics_reader;
SQL
```

Replace `taiga` in `-U taiga` and `FOR ROLE taiga` with your `POSTGRES_USER` if it differs. Then add to `taiga-metrics.env`:

```bash
TAIGA_METRICS_TAIGA_DB_USER=taiga_metrics_reader
TAIGA_METRICS_TAIGA_DB_PASSWORD=choose-a-password
```

and run `./taiga-metrics.sh up`.

## Update

Every release pins its image version inside `taiga-metrics.yml`. To move to a new release, download the new files and restart:

```bash
cd /path/to/taiga-docker
curl -fsSLO https://github.com/DVSAWR/taiga-metrics-extension/releases/latest/download/taiga-metrics.yml
curl -fsSLO https://github.com/DVSAWR/taiga-metrics-extension/releases/latest/download/taiga-metrics.sh
./taiga-metrics.sh update
```

Database changes are applied on start. Your settings in `taiga-metrics.env` and the extension's data are kept. The list of changes is on the [releases page](https://github.com/DVSAWR/taiga-metrics-extension/releases).

To run a specific version, set `TAIGA_METRICS_VERSION=1.2.0` in `taiga-metrics.env` and run `./taiga-metrics.sh update`.

## Stop, remove, uninstall

- Stop for a while: `./taiga-metrics.sh stop`; start again with `./taiga-metrics.sh up`.
- Remove the containers but keep the settings and data: `./taiga-metrics.sh remove`.
- Uninstall completely:

  ```bash
  ./taiga-metrics.sh remove
  docker volume rm "$(basename "$PWD")_taiga-metrics-db-data"
  rm taiga-metrics.yml taiga-metrics.sh taiga-metrics.env
  ```

Taiga itself is not affected by any of these.

## Other Taiga installations

If Taiga is not run with taiga-docker (installed from source, Kubernetes, a managed database), run the extension on its own with `taiga-metrics-standalone.yml`. It needs:

- network access to Taiga's PostgreSQL (allow the extension's host in `pg_hba.conf` if needed);
- Taiga's public address, for sign-in through Taiga's API and for links back to Taiga;
- optionally Taiga's media folder, for user photos and project logos.

```bash
mkdir taiga-metrics && cd taiga-metrics
curl -fsSLO https://github.com/DVSAWR/taiga-metrics-extension/releases/latest/download/taiga-metrics-standalone.yml
cat > .env <<'ENV'
TAIGA_METRICS_TAIGA_DB_HOST=db.example.com
TAIGA_METRICS_TAIGA_DB_USER=taiga_metrics_reader
TAIGA_METRICS_TAIGA_DB_PASSWORD=choose-a-password
TAIGA_METRICS_TAIGA_URL=https://taiga.example.com
TAIGA_METRICS_DB_PASSWORD=change-me
ENV
docker compose -f taiga-metrics-standalone.yml up -d
```

Besides the variables in [Configuration](#configuration), the standalone file reads:

| Variable                          | Default                 | Meaning                                     |
| --------------------------------- | ----------------------- | ------------------------------------------- |
| `TAIGA_METRICS_TAIGA_DB_HOST`     | required                | Host of Taiga's PostgreSQL                  |
| `TAIGA_METRICS_TAIGA_DB_PORT`     | `5432`                  | Its port                                    |
| `TAIGA_METRICS_TAIGA_DB_NAME`     | `taiga`                 | Taiga's database                            |
| `TAIGA_METRICS_TAIGA_DB_USER`     | required                | User to read it with                        |
| `TAIGA_METRICS_TAIGA_DB_PASSWORD` | required                | Its password                                |
| `TAIGA_METRICS_TAIGA_URL`         | required                | Taiga's public address                      |
| `TAIGA_METRICS_TAIGA_API_URL`     | `<TAIGA_URL>/api/v1`    | Taiga's API as reachable from the extension |
| `TAIGA_METRICS_MEDIA_PATH`        | `./taiga-media` (empty) | Taiga's media folder on this host           |

## Troubleshooting

- **Nothing shows up after sign-in.** A project member sees only what the owner granted to their role. Ask the owner to set it under Settings, Access.
- **"Statuses not set up".** The owner has not marked the statuses yet (Settings, General).
- **Data looks old.** Data is copied every hour. Run `./taiga-metrics.sh sync` to copy it now; the time of the last copy is under Settings, Data sync.
- **Sign-in fails with a correct password.** Check the logs with `./taiga-metrics.sh logs`: the extension must reach Taiga's API (`taiga-back` inside taiga-docker).
- **The port is taken.** Set another `TAIGA_METRICS_PORT` in `taiga-metrics.env` and run `./taiga-metrics.sh up`.

## Development

The backend is Python 3.12 with FastAPI and SQLAlchemy, managed with [uv](https://docs.astral.sh/uv/). The frontend is React with TypeScript and Vite.

```bash
make install-dev
make pre-commit
make check-all
```

`make stand-up` builds the image and starts it next to a local taiga-docker, found at `../taiga-docker` by default (`make stand-up TAIGA_DOCKER_DIR=/path/to/taiga-docker`). The frontend dev server runs with `npm run dev` in `frontend/`.

A release is published by pushing a tag that matches the version in `pyproject.toml`, for example `v0.1.0`. The image is then built for amd64 and arm64 and pushed to `ghcr.io/dvsawr/taiga-metrics-extension`. The release gets the deploy files with that version pinned.

## License and trademarks

Taiga Metrics is released under the [MIT License](LICENSE).

- **Taiga's code is not part of this project.** Taiga is licensed separately: taiga-back and taiga-docker under MPL-2.0, taiga-front under AGPL-3.0. Taiga Metrics contains, modifies and redistributes none of it. It only connects to a running Taiga: it reads Taiga's database and calls Taiga's sign-in API.
- **No Taiga assets.** The icons and the logo (Tabler's chart-histogram) come from [Tabler Icons](https://tabler.io/icons) (MIT). `make check-assets` downloads Taiga's frontend SVG files and fails if any path in `frontend/src` matches one of them; it runs in CI.
- **Third-party software** bundled in the web interface and the Docker image, with its licenses, is listed in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Trademarks.** "Taiga" and the Taiga logo belong to their owners. This project uses the name only to describe what it works with; it does not use the Taiga logo and is not an official Taiga product.
