import { API_BASE } from "../constants.js";

export async function generateLearningNoteRequest({ fileId, windowSize = 3, force = false }) {
  if (!fileId) {
    throw new Error("fileId가 필요합니다.");
  }

  const res = await fetch(`${API_BASE}/api/generate-learning-note`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId, windowSize, force }),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail || data?.error || "학습노트 생성 실패");
  }
  return data;
}

export async function fetchLearningNote(fileId) {
  if (!fileId) {
    throw new Error("fileId가 필요합니다.");
  }
  const res = await fetch(`${API_BASE}/api/learning-note/${fileId}`);
  if (res.status === 404) {
    return null;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.detail || data?.error || "학습노트 조회 실패");
  }
  return data;
}
