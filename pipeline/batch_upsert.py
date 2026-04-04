"""pipeline/batch_upsert.py — Chunked Supabase upsert helper."""
from typing import List, Any, Iterator


def chunk(lst: List[Any], size: int) -> Iterator[List[Any]]:
    """Yield successive `size`-length chunks from `lst`."""
    for i in range(0, len(lst), size):
        yield lst[i : i + size]


def batch_upsert(sb_client, table: str, rows: List[dict], on_conflict: str, chunk_size: int = 100) -> int:
    """
    Upsert `rows` into `table` in batches of `chunk_size`.
    Returns count of errors encountered.
    """
    errors = 0
    for batch in chunk(rows, chunk_size):
        try:
            sb_client.table(table).upsert(batch, on_conflict=on_conflict).execute()
        except Exception as exc:
            errors += 1
            import logging
            logging.getLogger("batch_upsert").warning(
                f"  batch upsert error ({table}, {len(batch)} rows): {exc}"
            )
    return errors
