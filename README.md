# Reading Leaderboard: PHP + MySQL Version

This folder contains the current Reading Leaderboard client and a PHP API backed
by MySQL. It includes the JSON-version records in `data/readers.json` and imports
them automatically when the database is empty.

## Configure MySQL

Edit `api/config.php` and replace these values with the credentials supplied by
your hosting provider:

```php
'host' => 'YOUR_MYSQL_HOSTNAME',
'database' => 'YOUR_DATABASE_NAME',
'username' => 'YOUR_DATABASE_USERNAME',
'password' => 'YOUR_DATABASE_PASSWORD',
```

The API creates its two tables automatically. If the host blocks table creation
from PHP, import `api/schema.sql` through phpMyAdmin first.

## InfinityFree deployment

1. Create a MySQL database in the InfinityFree control panel.
2. Copy its MySQL hostname, database name, username, and password into
   `api/config.php`. The hostname is usually not `localhost`.
3. Upload everything inside `php-database-version` to the site's `htdocs` folder.
4. Include hidden files, especially `.htaccess` and `data/.htaccess`.
5. Open `https://your-site.example/api/readers`.

On the first API request, the server creates the tables and imports the bundled
`data/readers.json` when no database readers exist. The database stores an import
marker so later requests and deployments do not duplicate the records.

## IIS deployment

1. Install PHP with the `pdo_mysql` extension and the IIS URL Rewrite module.
2. Create a MySQL database and configure `api/config.php`.
3. Deploy this folder as the site or application root.
4. Confirm that `web.config` is active, then open `/api/readers`.

## Database tables

- `reading_leaderboard_readers`: one row per reader, with a unique normalized
  name and the complete reader record stored as JSON text.
- `reading_leaderboard_settings`: current-reader state, transaction lock, and
  JSON-import status.

The PHP API uses a database transaction for each read/write operation. Password
hashes are never included in API responses.

## Important

- Keep `api/config.php` private because it contains database credentials.
- `data/.htaccess` prevents browsers from downloading `readers.json` on Apache.
- After confirming the import, `data/readers.json` may be removed from the server.
- Duplicate reader names are rejected by both the API and the database.
