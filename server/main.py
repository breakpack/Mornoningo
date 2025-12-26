from __future__ import annotations

import hashlib
import json
import os
import time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import google.generativeai as genai
from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from file_parsers import (
    extract_pdf_pages,
    extract_pptx_slides,
    extract_text_from_pdf,
    extract_text_from_pptx,
    normalize_text,
)
from learning_note_storage import LearningNoteStorage
from quiz_storage import QuizStorage

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent
PREVIEW_DIR = ROOT_DIR / "preview"
UPLOAD_DIR = BASE_DIR / "upload"
DATA_DIR = BASE_DIR / "data"
QUIZ_STORE_PATH = DATA_DIR / "quizzes.json"
LEARNING_NOTE_DIR = DATA_DIR / "notes"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
DATA_DIR.mkdir(parents=True, exist_ok=True)

quiz_storage = QuizStorage(QUIZ_STORE_PATH)
learning_note_storage = LearningNoteStorage(LEARNING_NOTE_DIR)

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.0-flash")
MAX_SOURCE_CHARS = 8000
MAX_PAGE_PROMPT_CHARS = 3500
MAX_PAGE_TEXT_CHARS = 6000


@lru_cache(maxsize=1)
def _get_model() -> genai.GenerativeModel:
    if not GEMINI_API_KEY:
        raise RuntimeError("GEMINI_API_KEY 환경 변수가 설정되지 않았습니다.")
    genai.configure(api_key=GEMINI_API_KEY)
    return genai.GenerativeModel(GEMINI_MODEL)


async def generate_with_gemini(prompt: str) -> str:
    def _request() -> str:
        model = _get_model()
        response = model.generate_content(prompt)
        text = getattr(response, "text", None)
        if not text:
            raise RuntimeError("AI 응답에 텍스트가 없습니다.")
        return text

    try:
        raw = await run_in_threadpool(_request)
    except Exception as exc:  # pragma: no cover - relies on remote service
        raise HTTPException(status_code=500, detail=f"Gemini 호출 실패: {exc}") from exc

    return raw.replace("```json", "").replace("```", "").strip()


class QuizFromTextRequest(BaseModel):
    sourceText: str = Field(..., min_length=50)
    numQuestions: int = Field(default=5, ge=1, le=20)
    difficulty: str = Field(default="normal", max_length=32)


class QuizFromFileRequest(BaseModel):
    fileId: str = Field(..., min_length=8)
    numQuestions: int = Field(default=5, ge=1, le=20)


class LearningNoteRequest(BaseModel):
    fileId: str = Field(..., min_length=8)
    windowSize: int = Field(default=3, ge=1, le=7)
    force: bool = Field(default=False)


app = FastAPI(title="Mornoningo Quiz API", version="0.2.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if PREVIEW_DIR.exists():
    app.mount("/styles", StaticFiles(directory=PREVIEW_DIR / "styles"), name="styles")
    app.mount("/scripts", StaticFiles(directory=PREVIEW_DIR / "scripts"), name="scripts")
    app.mount("/assets", StaticFiles(directory=PREVIEW_DIR / "assets"), name="assets")


@app.get("/", include_in_schema=False)
async def serve_index() -> FileResponse:
    index_file = PREVIEW_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(status_code=404, detail="프론트엔드가 준비되지 않았습니다.")
    return FileResponse(index_file)


@app.get("/health")
async def health() -> Dict[str, Any]:
    return {"ok": True, "model": GEMINI_MODEL}


@app.post("/api/upload")
async def upload_file(file: UploadFile = File(...)) -> Dict[str, Any]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="업로드할 파일명이 필요합니다.")

    extension = Path(file.filename).suffix
    unique_name = f"{int(time.time() * 1000)}_{os.urandom(4).hex()}{extension}"
    destination = UPLOAD_DIR / unique_name

    with destination.open("wb") as buffer:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            buffer.write(chunk)

    return {"ok": True, "fileId": unique_name, "originalName": file.filename}


@app.post("/api/generate-quiz")
async def generate_quiz_from_text(payload: QuizFromTextRequest) -> Dict[str, Any]:
    normalized_text = normalize_text(payload.sourceText)[:MAX_SOURCE_CHARS]
    if len(normalized_text) < 30:
        raise HTTPException(status_code=400, detail="sourceText 내용이 너무 짧습니다.")

    prompt = _build_text_prompt(normalized_text, payload.numQuestions, payload.difficulty)
    raw = await generate_with_gemini(prompt)
    parsed = _parse_quiz_payload(raw)
    questions = parsed["questions"]
    notes = parsed["notes"]
    record = quiz_storage.add_record(
        {
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "sourceType": "text",
            "reference": {
                "hash": hashlib.sha256(normalized_text.encode("utf-8")).hexdigest(),
            },
            "numQuestions": len(questions),
            "difficulty": payload.difficulty,
            "questions": questions,
            "notes": notes,
        }
    )
    return {"questions": questions, "notes": notes, "quizId": record["id"]}


@app.post("/api/generate-quiz-from-file")
async def generate_quiz_from_file(payload: QuizFromFileRequest) -> Dict[str, Any]:
    file_path = (UPLOAD_DIR / payload.fileId).resolve()
    if not str(file_path).startswith(str(UPLOAD_DIR.resolve())) or not file_path.exists():
        raise HTTPException(status_code=404, detail="업로드된 파일을 찾을 수 없습니다.")

    ext = file_path.suffix.lower()
    if ext == ".pdf":
        extracted_text = extract_text_from_pdf(file_path)
    elif ext == ".pptx":
        extracted_text = extract_text_from_pptx(file_path)
    else:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 파일 확장자: {ext}")

    if not extracted_text:
        raise HTTPException(status_code=400, detail="문서에서 텍스트를 추출하지 못했습니다.")

    prompt = _build_file_prompt(extracted_text[:MAX_SOURCE_CHARS], payload.numQuestions)
    raw = await generate_with_gemini(prompt)
    parsed = _parse_quiz_payload(raw)
    questions = parsed["questions"]
    notes = parsed["notes"]
    record = quiz_storage.add_record(
        {
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "sourceType": "file",
            "reference": {"fileId": payload.fileId},
            "numQuestions": len(questions),
            "questions": questions,
            "notes": notes,
        }
    )
    return {"questions": questions, "notes": notes, "quizId": record["id"]}


@app.post("/api/generate-learning-note")
async def generate_learning_note(payload: LearningNoteRequest) -> Dict[str, Any]:
    existing = learning_note_storage.read(payload.fileId)
    if existing and not payload.force:
        return existing

    file_path = (UPLOAD_DIR / payload.fileId).resolve()
    if not str(file_path).startswith(str(UPLOAD_DIR.resolve())) or not file_path.exists():
        raise HTTPException(status_code=404, detail="업로드된 파일을 찾을 수 없습니다.")

    chunks = _extract_page_chunks(file_path)
    if not chunks:
        raise HTTPException(status_code=400, detail="문서에서 요약할 페이지를 찾을 수 없습니다.")

    pages = []
    for chunk in chunks:
        text = chunk.get("text", "").strip()
        if not text:
            continue
        summary = await _summarize_single_page(chunk["label"], text[:MAX_PAGE_PROMPT_CHARS])
        pages.append(
            {
                "index": chunk["index"],
                "label": chunk["label"],
                "text": _clip_text(text, MAX_PAGE_TEXT_CHARS),
                "summary": summary,
            }
        )

    if not pages:
        raise HTTPException(status_code=400, detail="요약 가능한 페이지 내용이 없습니다.")

    windows = await _summarize_windows(pages, payload.windowSize)
    merged_md = _merge_markdown(windows)
    now = datetime.now(timezone.utc).isoformat()
    created_at = (existing or {}).get("createdAt")
    record = {
        "fileId": payload.fileId,
        "createdAt": created_at or now,
        "updatedAt": now,
        "pageCount": len(pages),
        "windowSize": payload.windowSize,
        "pages": pages,
        "windows": windows,
        "markdown": merged_md,
    }
    learning_note_storage.save(payload.fileId, record)
    return record


@app.get("/api/learning-note/{file_id}")
async def get_learning_note(file_id: str) -> Dict[str, Any]:
    record = learning_note_storage.read(file_id)
    if not record:
        raise HTTPException(status_code=404, detail="학습노트를 찾을 수 없습니다.")
    return record


def _build_text_prompt(source: str, num_questions: int, difficulty: str) -> str:
    return f"""
당신은 대학 전공 학습용 객관식 퀴즈 출제 도우미입니다.
주어진 학습 노트를 바탕으로 고품질 퀴즈를 만들어 주세요.

요구사항:
- 총 {num_questions}문제
- 각 문항은 4지선다 객관식
- 난이도: {difficulty}
- 출제 언어: 한국어
- 출력은 JSON 형식만 허용합니다. (Markdown 금지)

JSON 스키마:
{{
  "questions": [
    {{
      "question": "질문",
      "options": ["보기1", "보기2", "보기3", "보기4"],
      "correctIndex": 0,
      "explanation": "정답 해설"
    }}
  ],
  "notes": [
    {{
      "title": "개념 이름",
      "summary": "한 문장 요약",
      "details": ["핵심 포인트1", "핵심 포인트2"],
      "tip": "추가 학습 팁"
    }}
  ]
}}

학습 노트:
{source}
""".strip()


def _build_file_prompt(source: str, num_questions: int) -> str:
    return f"""
대학 강의 자료에서 핵심 개념을 뽑아 객관식 퀴즈를 만드세요.

조건:
- 총 {num_questions}문제
- 각 문항마다 4개의 보기를 포함
- 해당 문장을 근거로 한 간단한 해설 포함
- 학습자가 복습할 수 있는 개념노트를 3~5개 bullet로 작성
- JSON 이외의 텍스트는 포함하지 마세요

JSON 예시 구조:
{{
  "questions": [
    {{
      "question": "...",
      "options": ["..."],
      "correctIndex": 0,
      "explanation": "..."
    }}
  ],
  "notes": [
    {{
      "title": "핵심 주제",
      "summary": "핵심 내용을 한 줄로 정리",
      "details": ["핵심 포인트1", "핵심 포인트2"],
      "tip": "실생활 예시나 학습 팁"
    }}
  ]
}}

강의 자료 전문 (일부):
{source}
""".strip()


def _parse_quiz_payload(raw: str) -> Dict[str, Any]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail={"error": "JSON 파싱 실패", "raw": raw}) from exc

    if isinstance(data, dict) and isinstance(data.get("questions"), list):
        questions_raw = data["questions"]
    elif isinstance(data, list):
        questions_raw = data
    else:
        raise HTTPException(status_code=500, detail="questions 배열이 포함된 JSON이 필요합니다.")

    questions: List[Dict[str, Any]] = []
    for idx, item in enumerate(questions_raw):
        options = item.get("options") or item.get("opts") or []
        if not isinstance(options, list):
            options = []
        if len(options) < 4:
            continue
        correct_index = item.get("correctIndex", item.get("correct"))
        try:
            correct_index = int(correct_index)
        except (TypeError, ValueError):
            correct_index = 0
        question_text = item.get("question") or item.get("q") or f"문제 {idx + 1}"
        questions.append(
            {
                "question": question_text,
                "options": options[:4],
                "correctIndex": max(0, min(correct_index, len(options[:4]) - 1)),
                "explanation": item.get("explanation", ""),
            }
        )

    if not questions:
        raise HTTPException(status_code=500, detail="생성된 문제를 찾을 수 없습니다.")

    notes_raw = []
    if isinstance(data, dict):
        candidate = data.get("notes")
        if isinstance(candidate, str):
            notes_raw = [line.strip() for line in candidate.splitlines() if line.strip()]
        elif isinstance(candidate, list):
            notes_raw = [str(item).strip() for item in candidate if str(item).strip()]

    return {"questions": questions, "notes": notes_raw}


async def _summarize_single_page(label: str, text: str) -> Dict[str, Any]:
    prompt = _build_page_summary_prompt(label, text)
    raw = await generate_with_gemini(prompt)
    return _parse_page_summary(raw)


def _build_page_summary_prompt(label: str, text: str) -> str:
    return f"""
당신은 대학 강의 슬라이드를 요약하는 조교입니다. 주어진 페이지 내용을 바탕으로 구체적 개요를 출력하세요.

출력 형식(JSON만 허용):
{{
  "outline": "두세 문장으로 페이지 전체 요약",
  "keyPoints": ["핵심 포인트1", "핵심 포인트2", "핵심 포인트3"],
  "studyQuestion": "복습할 때 스스로에게 던질 질문"
}}

지침:
- 한국어 사용
- 실제 페이지에서 확인할 수 있는 사실, 개념, 숫자를 포함
- keyPoints는 3~5개 bullet, 각 항목은 1문장
- studyQuestion은 한 문장으로 마무리

페이지: {label}
본문:
{text}
""".strip()


def _parse_page_summary(raw: str) -> Dict[str, Any]:
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=500, detail={"error": "페이지 요약 JSON 파싱 실패", "raw": raw}) from exc

    outline = str(data.get("outline") or data.get("summary") or "").strip()
    key_points_raw = data.get("keyPoints") or data.get("bullets") or data.get("details") or []
    if isinstance(key_points_raw, str):
        key_points = [item.strip() for item in key_points_raw.splitlines() if item.strip()]
    elif isinstance(key_points_raw, list):
        key_points = [str(item).strip() for item in key_points_raw if str(item).strip()]
    else:
        key_points = []
    key_points = key_points[:5]
    study_question = str(data.get("studyQuestion") or data.get("quiz") or "").strip()

    return {
        "outline": outline,
        "keyPoints": key_points,
        "studyQuestion": study_question,
    }


async def _summarize_windows(pages: Sequence[Dict[str, Any]], window_size: int) -> List[Dict[str, Any]]:
    if not pages:
        return []

    clamped_size = max(1, min(window_size, len(pages)))
    left = clamped_size // 2
    right = clamped_size - left - 1

    windows: List[Dict[str, Any]] = []
    seen: set[Tuple[int, int]] = set()
    for idx in range(len(pages)):
        start = max(0, idx - left)
        end = min(len(pages), idx + right + 1)
        if end - start <= 0:
            continue
        key = (start, end)
        if key in seen:
            continue
        seen.add(key)
        window_pages = list(pages[start:end])
        markdown = await _summarize_window_block(window_pages)
        windows.append(
            {
                "startPage": window_pages[0]["index"],
                "endPage": window_pages[-1]["index"],
                "pageIndexes": [page["index"] for page in window_pages],
                "markdown": markdown,
            }
        )

    windows.sort(key=lambda item: item["startPage"])
    return windows


async def _summarize_window_block(window_pages: Sequence[Dict[str, Any]]) -> str:
    prompt = _build_window_prompt(window_pages)
    raw = await generate_with_gemini(prompt)
    return raw.strip()


def _build_window_prompt(window_pages: Sequence[Dict[str, Any]]) -> str:
    parts = []
    for page in window_pages:
        summary = page.get("summary") or {}
        points = summary.get("keyPoints") or []
        bullet_text = "\n".join(f"- {item}" for item in points if item)
        parts.append(
            f"페이지 p{page['index']} ({page['label']}):\n"
            f"개요: {summary.get('outline', '')}\n"
            f"핵심:\n{bullet_text}\n"
            f"질문: {summary.get('studyQuestion', '')}"
        )
    joined = "\n\n".join(parts)
    return f"""
연속된 학습 자료 페이지 요약을 입력으로 받습니다. 중복되는 설명을 통합하고 Markdown으로 정리하세요.

규칙:
- 각 섹션 제목은 `### Pages 시작-끝` 형식
- 불릿마다 기여한 페이지를 괄호로 표기 (예: (p2,p3))
- 앞뒤 페이지에서 이미 다룬 내용은 제거하거나 묶어서 하나의 bullet로
- Markdown 이외 텍스트를 추가하지 마세요

페이지 요약:
{joined}
""".strip()


def _merge_markdown(windows: Sequence[Dict[str, Any]]) -> str:
    parts = [item.get("markdown", "").strip() for item in windows if item.get("markdown")]
    return "\n\n".join(part for part in parts if part)


def _clip_text(value: str, limit: int) -> str:
    text = (value or "").strip()
    if len(text) <= limit:
        return text
    return text[:limit].rstrip() + " …"


def _extract_page_chunks(file_path: Path) -> List[Dict[str, Any]]:
    ext = file_path.suffix.lower()
    if ext == ".pdf":
        return extract_pdf_pages(file_path)
    if ext == ".pptx":
        return extract_pptx_slides(file_path)
    raise HTTPException(status_code=400, detail=f"지원하지 않는 파일 확장자: {ext}")
