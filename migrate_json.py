import argparse
import json
from pathlib import Path

import server


def parse_args():
    parser = argparse.ArgumentParser(description="Merge readers.json records into SQLite.")
    parser.add_argument("json_file", type=Path, help="Path to the readers.json file")
    return parser.parse_args()


def migrate(json_file):
    source = json.loads(json_file.read_text(encoding="utf-8"))
    source_records = {
        "currentReaderId": source.get("currentReaderId"),
        "readers": source.get("readers") if isinstance(source.get("readers"), list) else [],
    }
    server.repair_records(source_records)

    with server.RECORDS_LOCK:
        records = server.load_records_unlocked()
        existing_ids = {str(reader.get("id")) for reader in records["readers"]}
        existing_names = {
            server.normalize_name(reader.get("name")) for reader in records["readers"]
        }
        added = 0
        skipped = 0

        for reader in source_records["readers"]:
            reader_id = str(reader.get("id", "")).strip()
            normalized_name = server.normalize_name(reader.get("name"))
            if not reader_id or reader_id in existing_ids or normalized_name in existing_names:
                skipped += 1
                continue

            records["readers"].append(reader)
            existing_ids.add(reader_id)
            existing_names.add(normalized_name)
            added += 1

        if not records.get("currentReaderId") and source_records.get("currentReaderId") in existing_ids:
            records["currentReaderId"] = source_records["currentReaderId"]

        server.save_records_unlocked(records)
        with server.connect_database() as connection:
            connection.execute(
                """
                INSERT INTO app_settings (key, value)
                VALUES ('json_import_completed', 'manual-merge')
                ON CONFLICT(key) DO UPDATE SET value = excluded.value
                """
            )

    return added, skipped, len(records["readers"])


if __name__ == "__main__":
    arguments = parse_args()
    added_count, skipped_count, total_count = migrate(arguments.json_file.resolve())
    print(f"Added readers: {added_count}")
    print(f"Skipped existing readers: {skipped_count}")
    print(f"Total database readers: {total_count}")
