from __future__ import annotations

import json
import os
import tempfile
import uuid
from pathlib import Path
from threading import Lock
from typing import Any, Dict, List


class QuizStorage:
    """Persist quizzes to a JSON file without requiring a database."""

    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()
        if not self.path.exists():
            self._write({"quizzes": []})

    def _write(self, payload: Dict[str, Any]) -> None:
        tmp_fd, tmp_path = tempfile.mkstemp(dir=self.path.parent, prefix="quizzes", suffix=".tmp")
        try:
            with os.fdopen(tmp_fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
            os.replace(tmp_path, self.path)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)

    def _load(self) -> Dict[str, Any]:
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            data = {"quizzes": []}
        if "quizzes" not in data or not isinstance(data["quizzes"], list):
            data["quizzes"] = []
        return data

    def add_record(self, record: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            data = self._load()
            if "id" not in record:
                record = {"id": str(uuid.uuid4()), **record}
            data["quizzes"].append(record)
            self._write(data)
        return record

    def list_recent(self, limit: int = 20) -> List[Dict[str, Any]]:
        data = self._load()
        quizzes = data.get("quizzes", [])
        quizzes.sort(key=lambda item: item.get("createdAt", ""), reverse=True)
        return quizzes[:limit]
