# Reading Leaderboard: SQLite Version

This version stores reader records in a SQLite database instead of `readers.json`.
The browser still connects to the Python server through the same `/api/readers`
API, so the interface and workflows are unchanged.

## Run locally

From the `database-version` folder, run:

```bash
python3 server.py
```

Then open:

```text
http://127.0.0.1:5173/
```

The database is created automatically at `data/leaderboard.db`.
This project copy already includes the records migrated from the JSON version.

## Import existing JSON records

Before the first launch, copy the existing file to:

```text
database-version/data/readers.json
```

When the database is empty, the server imports that file once and records the
migration in the database. Later server restarts will not import it again.

To merge JSON records into a database that already contains readers, run:

```bash
python3 migrate_json.py ../data/readers.json
```

Readers with an existing ID or name are skipped, so running the command again
does not duplicate or overwrite database records.

You can import from another location by setting `JSON_IMPORT_FILE`:

```bash
JSON_IMPORT_FILE="/full/path/to/readers.json" python3 server.py
```

## Configuration

- `HOST`: listening address; default is `0.0.0.0`.
- `PORT`: listening port; default is `5173`.
- `DATA_DIR`: folder used for database data.
- `DATABASE_PATH`: full SQLite database path; overrides `DATA_DIR`.
- `JSON_IMPORT_FILE`: optional existing `readers.json` file to import once.

Example:

```bash
DATABASE_PATH="/var/lib/reading-leaderboard/leaderboard.db" PORT=8080 python3 server.py
```

## Deployment note

SQLite must be stored on a persistent disk. If the hosting provider uses an
ephemeral filesystem, records can still disappear after a restart or redeploy.
Configure `DATABASE_PATH` to point to the provider's persistent disk location.

SQLite supports one running server instance for this project. For multiple web
server instances, use a shared database service such as PostgreSQL instead.
