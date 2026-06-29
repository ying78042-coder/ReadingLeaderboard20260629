from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from contextlib import contextmanager
import copy
import hashlib
import json
import os
import socket
import sqlite3
import threading
import time
import uuid
from urllib.parse import unquote
from datetime import date, datetime, timezone


ROOT = Path(__file__).resolve().parent
DATA_DIR = Path(os.environ.get("DATA_DIR", ROOT / "data"))
DATABASE_FILE = Path(os.environ.get("DATABASE_PATH", DATA_DIR / "leaderboard.db"))
JSON_IMPORT_FILE = Path(os.environ.get("JSON_IMPORT_FILE", DATA_DIR / "readers.json"))
HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "5173"))
SUBJECTS = ("English", "English presentation", "Chinese", "Chinese presentation", "Math")
RECORDS_LOCK = threading.RLock()
DEFAULT_PASSWORD = "admin"


def empty_records():
    return {"currentReaderId": None, "readers": []}


@contextmanager
def connect_database():
    DATABASE_FILE.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DATABASE_FILE, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode = WAL")
    connection.execute("PRAGMA busy_timeout = 30000")
    try:
        yield connection
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def initialize_database():
    with connect_database() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS app_settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS readers (
                id TEXT PRIMARY KEY,
                normalized_name TEXT NOT NULL UNIQUE,
                position INTEGER NOT NULL,
                data_json TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS readers_position_idx
            ON readers(position);
            """
        )


def load_records():
    with RECORDS_LOCK:
        return load_records_unlocked()


def load_records_unlocked():
    initialize_database()
    readers = []
    current_reader_id = None
    with connect_database() as connection:
        for row in connection.execute("SELECT data_json FROM readers ORDER BY position, rowid"):
            try:
                reader = json.loads(row["data_json"])
            except (TypeError, json.JSONDecodeError):
                continue
            if isinstance(reader, dict):
                readers.append(reader)

        setting = connection.execute(
            "SELECT value FROM app_settings WHERE key = 'current_reader_id'"
        ).fetchone()
        if setting:
            try:
                current_reader_id = json.loads(setting["value"])
            except json.JSONDecodeError:
                current_reader_id = None

    records = {"currentReaderId": current_reader_id, "readers": readers}
    before = json.dumps(records, sort_keys=True)
    repair_records(records)
    after = json.dumps(records, sort_keys=True)
    if before != after:
        save_records(records)

    return records


def save_records(data):
    with RECORDS_LOCK:
        save_records_unlocked(data)


def save_records_unlocked(data):
    initialize_database()
    readers = data.get("readers") if isinstance(data.get("readers"), list) else []
    with connect_database() as connection:
        connection.execute("DELETE FROM readers")
        for position, reader in enumerate(readers):
            reader_id = str(reader.get("id", "")).strip()
            if not reader_id:
                continue
            connection.execute(
                """
                INSERT INTO readers (id, normalized_name, position, data_json)
                VALUES (?, ?, ?, ?)
                """,
                (
                    reader_id,
                    normalize_name(reader.get("name")),
                    position,
                    json.dumps(reader, ensure_ascii=False),
                ),
            )

        connection.execute(
            """
            INSERT INTO app_settings (key, value)
            VALUES ('current_reader_id', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
            """,
            (json.dumps(data.get("currentReaderId")),),
        )


def import_json_records_if_needed():
    initialize_database()
    with connect_database() as connection:
        migration = connection.execute(
            "SELECT value FROM app_settings WHERE key = 'json_import_completed'"
        ).fetchone()
        if migration:
            return 0

        reader_count = connection.execute("SELECT COUNT(*) AS count FROM readers").fetchone()["count"]
        if reader_count:
            connection.execute(
                "INSERT INTO app_settings (key, value) VALUES ('json_import_completed', 'skipped-existing')"
            )
            return 0

    if not JSON_IMPORT_FILE.exists():
        return 0

    try:
        source = json.loads(JSON_IMPORT_FILE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return 0

    records = {
        "currentReaderId": source.get("currentReaderId"),
        "readers": source.get("readers") if isinstance(source.get("readers"), list) else [],
    }
    repair_records(records)
    save_records_unlocked(records)
    with connect_database() as connection:
        connection.execute(
            "INSERT INTO app_settings (key, value) VALUES ('json_import_completed', 'imported')"
        )
    return len(records["readers"])


def update_records(mutator):
    with RECORDS_LOCK:
        records = load_records_unlocked()
        result = mutator(records)
        save_records_unlocked(records)
        return result if result is not None else records


def normalize_name(name):
    return " ".join(str(name).strip().split()).casefold()


def hash_password(password):
    text = str(password or DEFAULT_PASSWORD)
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def public_records(records):
    data = copy.deepcopy(records)
    for reader in data.get("readers", []):
        reader.pop("password", None)
        reader.pop("passwordHash", None)
    return data


def clean_number(value, fallback):
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def clean_date_key(value):
    text = str(value or "").strip()
    try:
        date.fromisoformat(text)
        return text
    except ValueError:
        return date.today().isoformat()


def clean_subject(value):
    subject = str(value or "").strip()
    return subject if subject in SUBJECTS else "English"


def clean_subject_minutes(value):
    incoming = value if isinstance(value, dict) else {}
    return {
        subject: max(0, clean_number(incoming.get(subject), 0))
        for subject in SUBJECTS
    }


def clean_subject_comments(value):
    incoming = value if isinstance(value, dict) else {}
    return {
        subject: str(incoming.get(subject, "")).strip()[:160]
        for subject in SUBJECTS
    }


def clean_subject_goals(value):
    incoming = value if isinstance(value, dict) else {}
    subject_goals = {}
    for subject in SUBJECTS:
        goals = incoming.get(subject) if isinstance(incoming.get(subject), dict) else {}
        legacy_daily_goal = clean_number(goals.get("daily"), 20)
        subject_goals[subject] = {
            "workday": clean_number(goals.get("workday"), legacy_daily_goal),
            "weekend": clean_number(goals.get("weekend"), legacy_daily_goal),
        }
        subject_goals[subject]["weekly"] = (
            subject_goals[subject]["workday"] * 5 + subject_goals[subject]["weekend"] * 2
        )
    return subject_goals


def summarize_subject_goals(subject_goals):
    return {
        "daily": sum(goal["workday"] for goal in subject_goals.values()),
        "dailyWorkday": sum(goal["workday"] for goal in subject_goals.values()),
        "dailyWeekend": sum(goal["weekend"] for goal in subject_goals.values()),
        "weekly": sum(goal["weekly"] for goal in subject_goals.values()),
    }


def update_daily_record(reader, record_date, today_minutes, week_minutes, month_books):
    daily_records = reader.setdefault("dailyRecords", {})
    daily_records[record_date] = {
        "todayMinutes": clean_number(today_minutes, 0),
        "weekMinutes": clean_number(week_minutes, 0),
        "monthBooks": clean_number(month_books, 0),
    }


def replace_subject_record(reader, record_date, subject_minutes, subject_comments=None):
    subject_comments = clean_subject_comments(subject_comments)
    reader["readingSessions"] = [
        session
        for session in reader.get("readingSessions", [])
        if session.get("recordDate") != record_date
    ]

    for subject in SUBJECTS:
        minutes = clean_number(subject_minutes.get(subject), 0)
        comment = subject_comments.get(subject, "")
        if minutes <= 0 and not comment:
            continue

        session = {
            "minutes": minutes,
            "subject": subject,
            "recordDate": record_date,
            "recordedAt": datetime.now(timezone.utc).isoformat(),
            "source": "manual",
        }
        if comment:
            session["comment"] = comment
        reader.setdefault("readingSessions", []).append(session)

    daily_record = reader.setdefault("dailyRecords", {}).setdefault(
        record_date,
        {"todayMinutes": 0, "weekMinutes": 0, "monthBooks": clean_number(reader.get("monthBooks"), 0)},
    )
    daily_record["todayMinutes"] = sum(subject_minutes.values())
    daily_record["monthBooks"] = clean_number(daily_record.get("monthBooks"), clean_number(reader.get("monthBooks"), 0))
    refresh_week_records(reader, record_date)
    sync_top_level_if_current_date(reader, record_date)


def update_subject_comments(reader, record_date, subject_comments):
    subject_comments = clean_subject_comments(subject_comments)
    sessions = reader.setdefault("readingSessions", [])

    for subject in SUBJECTS:
        comment = subject_comments.get(subject, "")
        matching_sessions = [
            session
            for session in sessions
            if session.get("recordDate") == record_date and session.get("subject") == subject
        ]

        for session in matching_sessions:
            session.pop("comment", None)

        if comment and matching_sessions:
            matching_sessions[-1]["comment"] = comment
        elif comment:
            sessions.append(
                {
                    "minutes": 0,
                    "subject": subject,
                    "recordDate": record_date,
                    "recordedAt": datetime.now(timezone.utc).isoformat(),
                    "source": "comment",
                    "comment": comment,
                }
            )


def repair_records(records):
    for reader in records.get("readers", []):
        if not reader.get("passwordHash"):
            reader["passwordHash"] = hash_password(reader.pop("password", DEFAULT_PASSWORD))

        goals = reader.get("goals") if isinstance(reader.get("goals"), dict) else {}
        subject_goals = clean_subject_goals(goals.get("subjects"))
        reader["goals"] = {
            **summarize_subject_goals(subject_goals),
            "subjects": subject_goals,
        }

        for record_date_key in list(reader.get("dailyRecords", {})):
            refresh_week_records(reader, record_date_key)
        sync_top_level_if_current_date(reader, date.today().isoformat())


def refresh_week_records(reader, changed_date_key):
    try:
        changed_date = date.fromisoformat(changed_date_key)
    except ValueError:
        return

    changed_year, changed_week, _ = changed_date.isocalendar()
    running_week_minutes = 0
    daily_records = reader.setdefault("dailyRecords", {})

    for record_date_key in sorted(daily_records):
        try:
            record_date = date.fromisoformat(record_date_key)
        except ValueError:
            continue

        record_year, record_week, _ = record_date.isocalendar()
        if record_year != changed_year or record_week != changed_week:
            continue

        record = daily_records[record_date_key]
        running_week_minutes += clean_number(
            record.get("todayMinutes", record.get("minutes")),
            0,
        )
        record["weekMinutes"] = running_week_minutes


def sync_top_level_if_current_date(reader, record_date_key):
    if record_date_key != date.today().isoformat():
        return

    daily_record = reader.get("dailyRecords", {}).get(record_date_key, {})
    reader["todayMinutes"] = clean_number(daily_record.get("todayMinutes"), 0)
    reader["weekMinutes"] = clean_number(daily_record.get("weekMinutes"), 0)
    reader["monthBooks"] = clean_number(daily_record.get("monthBooks"), 0)


def get_lan_ip():
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sock:
            sock.connect(("8.8.8.8", 80))
            return sock.getsockname()[0]
    except OSError:
        return None


def is_loopback_address(address):
    return address in {"127.0.0.1", "::1"} or address.startswith("127.")


class ReadingLeaderboardHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_json(self, status, data):
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_records(self, status, records):
        self.send_json(status, public_records(records))

    def do_GET(self):
        if self.path == "/api/server-info":
            is_server = is_loopback_address(self.client_address[0])
            port = self.server.server_address[1]
            lan_ip = get_lan_ip()
            self.send_json(
                200,
                {
                    "isServer": is_server,
                    "localUrl": f"http://127.0.0.1:{port}/",
                    "networkUrl": f"http://{lan_ip}:{port}/" if lan_ip else None,
                },
            )
            return

        if self.path == "/api/readers":
            self.send_records(200, load_records())
            return

        super().do_GET()

    def do_POST(self):
        if self.path.startswith("/api/readers/") and self.path.endswith("/reading-session"):
            self.add_reading_session()
            return

        if self.path != "/api/readers":
            self.send_error(404)
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            reader = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "Invalid JSON"})
            return

        name = " ".join(str(reader.get("name", "")).strip().split())
        if not name:
            self.send_json(400, {"error": "Name is required"})
            return

        with RECORDS_LOCK:
            records = load_records_unlocked()
            if any(normalize_name(existing.get("name")) == normalize_name(name) for existing in records["readers"]):
                self.send_json(409, {"error": "Name already exists"})
                return

            reader_id = str(reader.get("id", "")).strip() or f"reader-{int(time.time() * 1000)}-{uuid.uuid4().hex[:8]}"
            reader["name"] = name
            reader["id"] = reader_id
            reader["passwordHash"] = hash_password(reader.pop("password", DEFAULT_PASSWORD))
            reader.pop("favoriteBook", None)
            incoming_goals = reader.get("goals", {}) if isinstance(reader.get("goals"), dict) else {}
            subject_goals = clean_subject_goals(incoming_goals.get("subjects"))
            reader["goals"] = {
                **summarize_subject_goals(subject_goals),
                "subjects": subject_goals,
            }
            reader["todayMinutes"] = clean_number(reader.get("todayMinutes"), 0)
            reader["weekMinutes"] = clean_number(reader.get("weekMinutes"), 0)
            reader["monthBooks"] = clean_number(reader.get("monthBooks"), 0)
            record_date = clean_date_key(reader.get("recordDate"))
            reader.pop("recordDate", None)
            update_daily_record(
                reader,
                record_date,
                reader["todayMinutes"],
                reader["weekMinutes"],
                reader["monthBooks"],
            )
            refresh_week_records(reader, record_date)
            sync_top_level_if_current_date(reader, record_date)

            records["readers"].append(reader)
            records["currentReaderId"] = reader_id
            save_records_unlocked(records)
        self.send_records(200, records)

    def add_reading_session(self):
        name_from_path = unquote(self.path.removeprefix("/api/readers/").removesuffix("/reading-session"))
        normalized_name = normalize_name(name_from_path)
        if not normalized_name:
            self.send_json(400, {"error": "Name is required"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            session = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "Invalid JSON"})
            return

        minutes = max(0, clean_number(session.get("minutes"), 0))
        if minutes <= 0:
            self.send_json(400, {"error": "Reading time must be greater than zero"})
            return

        record_date = clean_date_key(session.get("recordDate"))
        subject = clean_subject(session.get("subject"))
        with RECORDS_LOCK:
            records = load_records_unlocked()
            for reader in records["readers"]:
                if normalize_name(reader.get("name")) == normalized_name:
                    daily_record = reader.setdefault("dailyRecords", {}).setdefault(
                        record_date,
                        {"todayMinutes": 0, "weekMinutes": 0, "monthBooks": clean_number(reader.get("monthBooks"), 0)},
                    )
                    daily_record["todayMinutes"] = clean_number(daily_record.get("todayMinutes"), 0) + minutes
                    daily_record["monthBooks"] = clean_number(daily_record.get("monthBooks"), clean_number(reader.get("monthBooks"), 0))
                    refresh_week_records(reader, record_date)
                    sync_top_level_if_current_date(reader, record_date)
                    reader.setdefault("readingSessions", []).append(
                        {
                            "minutes": minutes,
                            "subject": subject,
                            "recordDate": record_date,
                            "recordedAt": datetime.now(timezone.utc).isoformat(),
                        }
                    )
                    records["currentReaderId"] = reader.get("id")
                    save_records_unlocked(records)
                    self.send_records(200, records)
                    return

        self.send_json(404, {"error": "Reader not found"})

    def do_PATCH(self):
        if self.path.startswith("/api/readers/") and self.path.endswith("/goals"):
            self.update_goals()
            return

        if not self.path.startswith("/api/readers/") or not self.path.endswith("/today"):
            self.send_error(404)
            return

        name_from_path = unquote(self.path.removeprefix("/api/readers/").removesuffix("/today"))
        normalized_name = normalize_name(name_from_path)
        if not normalized_name:
            self.send_json(400, {"error": "Name is required"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            update = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "Invalid JSON"})
            return

        record_date = clean_date_key(update.get("recordDate"))
        is_comment_only_update = isinstance(update.get("subjectComments"), dict) and not isinstance(
            update.get("subjectMinutes"), dict
        )
        password_hash = hash_password(update.get("password", ""))
        with RECORDS_LOCK:
            records = load_records_unlocked()
            for reader in records["readers"]:
                if normalize_name(reader.get("name")) == normalized_name:
                    if (
                        not is_comment_only_update
                        and reader.get("passwordHash", hash_password(DEFAULT_PASSWORD)) != password_hash
                    ):
                        self.send_json(403, {"error": "Incorrect password"})
                        return

                    if is_comment_only_update:
                        update_subject_comments(
                            reader,
                            record_date,
                            clean_subject_comments(update.get("subjectComments")),
                        )
                    elif isinstance(update.get("subjectMinutes"), dict):
                        replace_subject_record(
                            reader,
                            record_date,
                            clean_subject_minutes(update.get("subjectMinutes")),
                            clean_subject_comments(update.get("subjectComments")),
                        )
                    else:
                        today_minutes = clean_number(update.get("todayMinutes"), 0)
                        week_minutes = clean_number(update.get("weekMinutes"), 0)
                        month_books = clean_number(update.get("monthBooks"), 0)
                        update_daily_record(
                            reader,
                            record_date,
                            today_minutes,
                            week_minutes,
                            month_books,
                        )
                        refresh_week_records(reader, record_date)
                        sync_top_level_if_current_date(reader, record_date)
                    records["currentReaderId"] = reader.get("id")
                    save_records_unlocked(records)
                    self.send_records(200, records)
                    return

        self.send_json(404, {"error": "Reader not found"})

    def update_goals(self):
        name_from_path = unquote(self.path.removeprefix("/api/readers/").removesuffix("/goals"))
        normalized_name = normalize_name(name_from_path)
        if not normalized_name:
            self.send_json(400, {"error": "Name is required"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            update = json.loads(self.rfile.read(length).decode("utf-8"))
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "Invalid JSON"})
            return

        incoming_goals = update.get("goals", {}) if isinstance(update.get("goals"), dict) else {}
        with RECORDS_LOCK:
            records = load_records_unlocked()
            for reader in records["readers"]:
                if normalize_name(reader.get("name")) == normalized_name:
                    existing_goals = reader.get("goals") if isinstance(reader.get("goals"), dict) else {}
                    subject_goals = clean_subject_goals(
                        incoming_goals.get("subjects", existing_goals.get("subjects"))
                    )
                    reader["goals"] = {
                        **summarize_subject_goals(subject_goals),
                        "subjects": subject_goals,
                    }
                    records["currentReaderId"] = reader.get("id")
                    save_records_unlocked(records)
                    self.send_records(200, records)
                    return

        self.send_json(404, {"error": "Reader not found"})

    def do_DELETE(self):
        if self.path == "/api/readers":
            if not is_loopback_address(self.client_address[0]):
                self.send_json(403, {"error": "Reset is only allowed from the server"})
                return

            with RECORDS_LOCK:
                records = empty_records()
                save_records_unlocked(records)
            self.send_records(200, records)
            return

        if not self.path.startswith("/api/readers/"):
            self.send_error(404)
            return

        reader_id = unquote(self.path.removeprefix("/api/readers/")).strip()
        if not reader_id:
            self.send_json(400, {"error": "Reader id is required"})
            return

        try:
            length = int(self.headers.get("Content-Length", "0"))
            delete_request = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except (ValueError, json.JSONDecodeError):
            self.send_json(400, {"error": "Invalid JSON"})
            return

        password_hash = hash_password(delete_request.get("password", ""))
        with RECORDS_LOCK:
            records = load_records_unlocked()
            reader_to_delete = next(
                (reader for reader in records["readers"] if str(reader.get("id")) == reader_id),
                None,
            )
            if not reader_to_delete:
                self.send_json(404, {"error": "Reader not found"})
                return

            if reader_to_delete.get("passwordHash", hash_password(DEFAULT_PASSWORD)) != password_hash:
                self.send_json(403, {"error": "Incorrect password"})
                return

            records["readers"] = [
                reader for reader in records["readers"] if str(reader.get("id")) != reader_id
            ]
            if records["currentReaderId"] == reader_id:
                records["currentReaderId"] = records["readers"][-1]["id"] if records["readers"] else None

            save_records_unlocked(records)
        self.send_records(200, records)


if __name__ == "__main__":
    initialize_database()
    imported_count = import_json_records_if_needed()

    server = ThreadingHTTPServer((HOST, PORT), ReadingLeaderboardHandler)
    print(f"Reading leaderboard local: http://127.0.0.1:{PORT}/")
    lan_ip = get_lan_ip()
    if lan_ip:
        print(f"Reading leaderboard network: http://{lan_ip}:{PORT}/")
    print(f"SQLite database: {DATABASE_FILE}")
    if imported_count:
        print(f"Imported {imported_count} reader(s) from: {JSON_IMPORT_FILE}")
    server.serve_forever()
