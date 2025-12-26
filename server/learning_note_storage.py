from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from threading import Lock
from typing import Any, Dict, Optional


class LearningNoteStorage:
    """Persist per-file learning notes as standalone JSON documents."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.root.mkdir(parents=True, exist_ok=True)
        self._lock = Lock()

    def _path_for(self, file_id: str) -> Path:
        safe_name = Path(file_id).name
        return self.root / f"{safe_name}.json"

    def read(self, file_id: str) -> Optional[Dict[str, Any]]:
        path = self._path_for(file_id)
        if not path.exists():
            return None
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            return None

    def write(self, file_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        path = self._path_for(file_id)
        tmp_fd, tmp_path = tempfile.mkstemp(dir=self.root, prefix=f"{path.stem}_", suffix=".tmp")
        try:
            with os.fdopen(tmp_fd, "w", encoding="utf-8") as handle:
                json.dump(payload, handle, ensure_ascii=False, indent=2)
            os.replace(tmp_path, path)
        finally:
            if os.path.exists(tmp_path):
                os.remove(tmp_path)
        return payload

    def save(self, file_id: str, payload: Dict[str, Any]) -> Dict[str, Any]:
        with self._lock:
            return self.write(file_id, payload)
