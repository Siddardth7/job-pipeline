#!/usr/bin/env python3
"""
engine/query_engine.py — JobAgent v2 Query Engine

Generates boolean job search queries from cluster definitions.
Combines title clusters with entry-level modifiers to produce
approximately 15 targeted queries per run.

Usage:
    from engine.query_engine import QueryEngine
    qe = QueryEngine()
    queries = qe.generate_queries()
"""

import json
import logging
from pathlib import Path
from itertools import islice
from typing import List, Dict

DATA_DIR = Path(__file__).parent.parent / "data"  # engine/ subdir → data/ is at repo root
CONFIG_PATH = DATA_DIR / "query_engine.json"

log = logging.getLogger("query_engine")


class QueryEngine:
    """Generates a rotating set of boolean search queries per run."""

    TARGET_QUERY_COUNT = 15

    def __init__(self, config_path: Path = CONFIG_PATH):
        with open(config_path) as f:
            self.config = json.load(f)

        self.clusters: Dict[str, List[str]] = self.config["clusters"]
        self.modifiers: List[str] = self.config["entry_level_modifiers"]
        self.exclusions: List[str] = self.config["exclusion_keywords"]

    # ── Internal helpers ──────────────────────────────────────────────────────

    def _or(self, terms: List[str]) -> str:
        """Wrap terms in OR group: ("term a" OR "term b")"""
        inner = " OR ".join(f'"{t}"' for t in terms)
        return f"({inner})"

    def _not(self, terms: List[str]) -> str:
        """Build NOT clause: NOT ("term a" OR "term b")"""
        inner = " OR ".join(f'"{t}"' for t in terms)
        return f'NOT ({inner})'

    def _build_query(self, titles: List[str]) -> str:
        """Construct a full boolean query string."""
        title_group = self._or(titles)
        mod_group = self._or(self.modifiers)
        excl_group = self._not(self.exclusions)
        return f"{title_group} AND {mod_group} {excl_group}"

    def _build_open_query(self, titles: List[str]) -> str:
        """Open query without entry-level filter — broader sweep."""
        title_group = self._or(titles)
        excl_group = self._not(self.exclusions)
        return f"{title_group} {excl_group}"

    # ── Public API ────────────────────────────────────────────────────────────

    def generate_queries(self) -> List[Dict]:
        """
        Returns up to TARGET_QUERY_COUNT query dicts.

        Each dict:
          {
            "query": str,          # the boolean search string
            "cluster": str,        # source cluster name
            "type": "filtered"|"open"
          }
        """
        queries = []

        # One filtered query per cluster (8 clusters)
        for cluster_name, titles in self.clusters.items():
            q = self._build_query(titles)
            queries.append({
                "query": q,
                "cluster": cluster_name,
                "type": "filtered"
            })

        # Open queries for high-priority clusters (to fill remaining slots)
        priority_clusters = ["manufacturing", "quality", "composites",
                              "materials", "process", "startup_manufacturing",
                              "industrial"]
        slots_remaining = self.TARGET_QUERY_COUNT - len(queries)

        for cluster_name in islice(priority_clusters, slots_remaining):
            titles = self.clusters.get(cluster_name, [])
            if titles:
                q = self._build_open_query(titles[:4])  # use top 4 titles
                queries.append({
                    "query": q,
                    "cluster": f"{cluster_name}_open",
                    "type": "open"
                })

        log.info(f"QueryEngine generated {len(queries)} queries "
                 f"({sum(1 for q in queries if q['type']=='filtered')} filtered, "
                 f"{sum(1 for q in queries if q['type']=='open')} open)")

        return queries[:self.TARGET_QUERY_COUNT]

    def get_exclusion_keywords(self) -> List[str]:
        return self.exclusions

    def get_modifiers(self) -> List[str]:
        return self.modifiers


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO,
                        format="%(asctime)s [%(levelname)s] %(message)s")
    qe = QueryEngine()
    queries = qe.generate_queries()
    print(f"\n{'='*60}")
    print(f"Generated {len(queries)} queries:")
    print('='*60)
    for i, q in enumerate(queries, 1):
        print(f"\n[{i}] Cluster: {q['cluster']} ({q['type']})")
        print(f"    {q['query']}")
