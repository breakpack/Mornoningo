import { getState, saveState } from "../state.js";
import { runtime } from "../runtime.js";
import { todayStr, addDays } from "../utils/date.js";
import { uploadFileToServer } from "../services/files.js";
import {
  generateLearningNoteRequest,
  fetchLearningNote,
} from "../services/learningNotes.js";

const notesPanel = document.getElementById("notes-panel");
const notesTitleEl = document.getElementById("notes-panel-title");
const notesContentEl = document.getElementById("notes-panel-content");
const notesCloseBtn = document.getElementById("btn-close-notes");

if (notesCloseBtn) {
  notesCloseBtn.addEventListener("click", () => closeNotesPanel());
}

if (notesPanel) {
  notesPanel.addEventListener("click", (event) => {
    if (event.target === notesPanel) {
      closeNotesPanel();
    }
  });
}

export function renderDocsList({ onStartQuiz, onAfterChange }) {
  const state = getState();
  state.docs
    .filter((doc) => doc?.fileId && getLearningNoteStatus(doc) === "pending")
    .forEach((doc) => {
      startLearningNoteJob(doc.id, { onAfterUpdate: onAfterChange }).catch((err) =>
        console.error("학습노트 자동 생성 실패", err)
      );
    });
  const listEl = document.getElementById("doc-list");
  const emptyHint = document.getElementById("doc-empty-hint");
  const legacyDetail = document.getElementById("doc-detail-card");

  listEl.innerHTML = "";
  if (legacyDetail) legacyDetail.style.display = "none";

  if (!state.docs.length) {
    emptyHint.style.display = "block";
    runtime.expandedDocId = null;
    runtime.currentDocId = null;
    return;
  }

  emptyHint.style.display = "none";

  state.docs.forEach((doc) => {
    const li = document.createElement("li");
    const status = (doc && doc.extractionStatus) || "pending";
    const isReady = isDocReady(doc);
    const isExpanded = runtime.expandedDocId === doc.id;
    li.className = "doc-item";
    if (isExpanded) li.classList.add("open");
    if (!isReady) li.classList.add("doc-item-disabled");

    const header = document.createElement("div");
    header.className = "doc-item-header";

    const info = document.createElement("div");
    info.className = "doc-item-info";
    const title = document.createElement("div");
    title.className = "doc-title";
    title.textContent = doc.title;
    const meta = document.createElement("div");
    meta.className = "doc-meta";
    const noteMetaText = getLearningNoteMeta(doc);
    meta.textContent = `${doc.progress || 0}% 완료 · 개념 ${
      doc.conceptsCount || 0
    }개${noteMetaText}`;
    info.appendChild(title);
    info.appendChild(meta);

    const statusWrap = document.createElement("div");
    statusWrap.className = "doc-item-right";
    const chip = document.createElement("span");
    chip.className = `doc-status doc-status-${status}`;
    chip.textContent = getExtractionStatusLabel(doc);
    const icon = document.createElement("span");
    icon.className = "doc-toggle-icon";
    icon.textContent = isReady ? (isExpanded ? "▾" : "▸") : "…";
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "icon-button doc-delete-button";
    deleteBtn.innerHTML = "🗑️";
    deleteBtn.title = "삭제";
    deleteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      deleteDoc(doc.id, onAfterChange);
    });
    statusWrap.appendChild(chip);
    statusWrap.appendChild(icon);
    statusWrap.appendChild(deleteBtn);

    header.appendChild(info);
    header.appendChild(statusWrap);

    header.addEventListener("click", () => {
      if (!isDocReady(doc)) return;
      runtime.expandedDocId = isExpanded ? null : doc.id;
      runtime.currentDocId = runtime.expandedDocId;
      renderDocsList({ onStartQuiz, onAfterChange });
    });

    li.appendChild(header);

    if (isReady) {
      const detail = document.createElement("div");
      detail.className = "doc-item-detail";
      if (isExpanded) detail.classList.add("open");

      const stats = document.createElement("div");
      stats.className = "doc-detail-row";
      stats.innerHTML = `
        <span>진도 <strong>${doc.progress || 0}%</strong></span>
        <span>개념 <strong>${doc.conceptsCount || 0}개</strong></span>
        <span>상태 <strong>${getExtractionStatusLabel(doc)}</strong></span>
      `;

      const actions = document.createElement("div");
      actions.className = "doc-detail-actions";

      const playBtn = document.createElement("button");
      playBtn.className = "btn-primary";
      playBtn.textContent = "퀴즈 풀기";
      playBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        runtime.currentDocId = doc.id;
        onStartQuiz(doc.id);
      });

      const notesBtn = document.createElement("button");
      notesBtn.className = "btn-secondary";
      notesBtn.textContent = "개념노트 열기";
      const notesReady = isLearningNoteReady(doc);
      notesBtn.disabled = !notesReady;
      notesBtn.title = notesReady
        ? "전체 화면으로 개념노트를 봅니다."
        : getLearningNotePendingText(doc);
      notesBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        openNotesPanel(doc);
      });

      const regenBtn = document.createElement("button");
      regenBtn.className = "btn-ghost";
      regenBtn.textContent = "노트 재생성";
      const isProcessing = getLearningNoteStatus(doc) === "processing";
      regenBtn.disabled = isProcessing;
      regenBtn.title = isProcessing ? "생성 중입니다." : "AI에게 다시 요약을 요청합니다.";
      regenBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        regenBtn.disabled = true;
        startLearningNoteJob(doc.id, { onAfterUpdate: onAfterChange, force: true }).catch((err) =>
          alert("학습노트 재생성 실패: " + (err?.message || err))
        );
      });

      actions.appendChild(playBtn);
      actions.appendChild(notesBtn);
      actions.appendChild(regenBtn);

      detail.appendChild(stats);
      detail.appendChild(actions);

      li.appendChild(detail);
    } else {
      const waiting = document.createElement("div");
      waiting.className = "doc-waiting";
      const message = document.createElement("p");
      message.className = "doc-waiting-text";
      message.textContent =
        status === "failed"
          ? "퀴즈/개념노트 생성에 실패했습니다. 다시 시도해 주세요."
          : "AI가 퀴즈와 개념노트를 생성하는 중입니다.";
      const progress = document.createElement("div");
      progress.className = "doc-progress-track";
      const fill = document.createElement("div");
      fill.className = "doc-progress-fill";
      const percent = getDocProgressPercent(doc);
      fill.style.width = `${percent}%`;
      progress.appendChild(fill);
      const percentText = document.createElement("span");
      percentText.className = "doc-progress-value";
      percentText.textContent = `${percent}%`;
      waiting.appendChild(message);
      waiting.appendChild(progress);
      waiting.appendChild(percentText);
      li.appendChild(waiting);
    }

    listEl.appendChild(li);
  });
}

export function setupUpload({ onAfterUpload, onAutoGenerate }) {
  const input = document.getElementById("file-input");
  if (!input) return;

  input.addEventListener("change", async (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const newDocIds = [];

    for (const file of files) {
      try {
        const uploaded = await uploadFileToServer(file);
        const id = `doc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const state = getState();
        state.docs.push({
          id,
          fileId: uploaded.fileId,
          title: uploaded.originalName,
          type: uploaded.originalName.split(".").pop(),
          progress: 0,
          conceptsCount: 0,
          createdAt: todayStr(),
          notes: "",
          learningNoteStatus: "pending",
          quizStats: { attempts: 0, correct: 0, total: 0 },
          extractionStatus: "processing",
          extractionProgress: 0,
          preloadedQuiz: [],
        });
        newDocIds.push(id);

        [1, 3, 7, 14].forEach((d, idx) => {
          state.reviews.push({
            id: `rev_${id}_${d}`,
            docId: id,
            dueDate: addDays(todayStr(), d),
            stage: idx + 1,
            priority: 1,
          });
        });
      } catch (err) {
        alert("업로드 실패: " + err.message);
      }
    }

    saveState();
    onAfterUpload();
    newDocIds.forEach((docId) => {
      if (typeof onAutoGenerate === "function") {
        Promise.resolve(onAutoGenerate(docId)).catch((err) =>
          console.error("자동 퀴즈 생성 실패", err)
        );
      }
      startLearningNoteJob(docId, { onAfterUpdate: onAfterUpload }).catch((err) =>
        console.error("학습노트 생성 실패", err)
      );
    });
    input.value = "";
  });
}

function getExtractionStatusLabel(doc) {
  const status = (doc && doc.extractionStatus) || "pending";
  switch (status) {
    case "processing":
      return "추출 중";
    case "ready":
      return "추출 완료";
    case "failed":
      return "추출 실패";
    default:
      return "대기 중";
  }
}

function isDocReady(doc) {
  return (doc && doc.extractionStatus) === "ready";
}

function getDocProgressPercent(doc) {
  const value = Number(doc?.extractionProgress ?? 0);
  if (Number.isNaN(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

async function openNotesPanel(doc) {
  if (!notesPanel || !notesContentEl || !notesTitleEl) return;
  const title = doc?.title || "개념노트";
  notesTitleEl.textContent = `${title} · 학습노트`;
  notesPanel.classList.remove("hidden");
  notesPanel.setAttribute("aria-hidden", "false");
  notesContentEl.innerHTML = `<p class="note-loading">학습노트를 불러오는 중...</p>`;

  if (!doc?.fileId && !(doc?.notes || "").trim()) {
    notesContentEl.innerHTML = `<p class="note-empty">업로드된 파일 정보가 없습니다.</p>`;
    return;
  }

  if (!isLearningNoteReady(doc) && !(doc?.notes || "").trim()) {
    notesContentEl.innerHTML = `<p class="note-empty">${escapeHtml(
      getLearningNotePendingText(doc)
    )}</p>`;
    return;
  }

  try {
    const payload = doc?.fileId ? await loadLearningNotePayload(doc) : null;
    if (payload) {
      renderLearningNoteContent(payload);
      return;
    }
    const legacyText = (doc?.notes || "").trim();
    if (legacyText) {
      renderLegacyNotes(legacyText);
    } else {
      notesContentEl.innerHTML = `<p class="note-empty">생성된 학습노트가 없습니다.</p>`;
    }
  } catch (err) {
    console.error("학습노트 패널 로딩 실패", err);
    notesContentEl.innerHTML = `<p class="note-empty">${escapeHtml(
      err.message || "학습노트를 불러오지 못했습니다."
    )}</p>`;
  }
}

function closeNotesPanel() {
  if (!notesPanel || !notesContentEl || !notesTitleEl) return;
  notesPanel.classList.add("hidden");
  notesPanel.setAttribute("aria-hidden", "true");
  notesTitleEl.textContent = "";
  notesContentEl.innerHTML = "";
}

function renderLegacyNotes(noteText = "") {
  if (!notesContentEl) return;
  const sections = noteText
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean);
  notesContentEl.innerHTML = sections.length
    ? sections.map((block) => renderNoteSection(block)).join("")
    : `<p class="note-empty">추출된 개념노트가 없습니다.</p>`;
}

function renderLearningNoteContent(note) {
  if (!notesContentEl) return;
  const pages = Array.isArray(note?.pages) ? note.pages : [];
  const windows = Array.isArray(note?.windows) ? note.windows : [];
  const pageHtml = pages.length
    ? pages.map((page) => renderNotePageSection(page)).join("")
    : `<p class="note-empty">페이지 요약이 없습니다.</p>`;
  const markdownHtml = renderMarkdownView(windows, note?.markdown || "");
  notesContentEl.innerHTML = `
    <div class="note-view-toggle">
      <button type="button" class="note-view-button active" data-view="pages">페이지별 요약</button>
      <button type="button" class="note-view-button" data-view="markdown">연속 요약(MD)</button>
    </div>
    <div id="notes-view-pages" class="note-view-section">${pageHtml}</div>
    <div id="notes-view-markdown" class="note-view-section hidden-view">${markdownHtml}</div>
  `;
  const buttons = notesContentEl.querySelectorAll(".note-view-button");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const view = btn.dataset.view || "pages";
      switchNotesView(view);
    });
  });
}

function renderNotePageSection(page = {}) {
  const label = escapeHtml(page.label || `Page ${page.index || ""}`);
  const outline = escapeHtml(page.summary?.outline || "");
  const keyPoints = Array.isArray(page.summary?.keyPoints)
    ? page.summary.keyPoints.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
    : "";
  const question = escapeHtml(page.summary?.studyQuestion || "");
  const rawText = (page.text || "")
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => escapeHtml(line))
    .join("<br>");
  return `
    <section class="note-page">
      <header class="note-page-header">
        <span>${label}</span>
        <span class="note-page-index">p${page.index ?? ""}</span>
      </header>
      ${outline ? `<p class="note-page-outline">${outline}</p>` : ""}
      ${keyPoints ? `<ul class="note-page-points">${keyPoints}</ul>` : ""}
      ${question ? `<p class="note-page-question">학습 질문: ${question}</p>` : ""}
      ${rawText ? `<details class="note-page-raw"><summary>원문 텍스트</summary><p>${rawText}</p></details>` : ""}
    </section>
  `;
}

function renderMarkdownView(windows, fallbackMarkdown) {
  if (Array.isArray(windows) && windows.length) {
    return windows.map((entry) => renderMarkdownSection(entry)).join("");
  }
  const markdown = (fallbackMarkdown || "").trim();
  if (markdown) {
    return `<section class="note-md-section"><pre class="note-md-block">${escapeHtml(markdown)}</pre></section>`;
  }
  return `<p class="note-empty">연속 요약이 아직 없습니다.</p>`;
}

function renderMarkdownSection(entry = {}) {
  const start = entry.startPage;
  const end = entry.endPage;
  const label =
    typeof start === "number" && typeof end === "number"
      ? start === end
        ? `Page ${start}`
        : `Pages ${start}-${end}`
      : "Markdown";
  const markdown = escapeHtml((entry.markdown || "").trim());
  return `
    <section class="note-md-section">
      <p class="note-md-label">${label}</p>
      <pre class="note-md-block">${markdown}</pre>
    </section>
  `;
}

function switchNotesView(target = "pages") {
  if (!notesContentEl) return;
  const sections = notesContentEl.querySelectorAll(".note-view-section");
  sections.forEach((section) => {
    const isPages = section.id === "notes-view-pages";
    const isTarget = (target === "pages" && isPages) || (target === "markdown" && !isPages);
    section.classList.toggle("hidden-view", !isTarget);
  });
  const buttons = notesContentEl.querySelectorAll(".note-view-button");
  buttons.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === target);
  });
}

async function loadLearningNotePayload(doc) {
  if (!doc?.fileId) return null;
  const cache = runtime.learningNotesCache?.[doc.fileId];
  if (cache) return cache;
  const fetched = await fetchLearningNote(doc.fileId);
  if (fetched) {
    runtime.learningNotesCache[doc.fileId] = fetched;
  }
  return fetched;
}

async function startLearningNoteJob(docId, { onAfterUpdate, force = false } = {}) {
  const state = getState();
  const doc = state.docs.find((item) => item.id === docId);
  if (!doc || !doc.fileId) return null;
  if (doc.learningNoteStatus === "processing" && !force) return null;

  doc.learningNoteStatus = "processing";
  saveState();
  if (typeof onAfterUpdate === "function") onAfterUpdate();

  try {
    if (force && runtime.learningNotesCache[doc.fileId]) {
      delete runtime.learningNotesCache[doc.fileId];
    }
    const note = await generateLearningNoteRequest({
      fileId: doc.fileId,
      windowSize: 3,
      force,
    });
    runtime.learningNotesCache[doc.fileId] = note;
    doc.learningNoteStatus = "ready";
    const markdown = buildMarkdownFromNote(note);
    if (markdown) {
      doc.notes = markdown;
    }
    if (typeof note?.pageCount === "number" && note.pageCount > 0) {
      doc.conceptsCount = Math.max(doc.conceptsCount || 0, note.pageCount);
    }
    saveState();
    if (typeof onAfterUpdate === "function") onAfterUpdate();
    return note;
  } catch (err) {
    doc.learningNoteStatus = "failed";
    saveState();
    if (typeof onAfterUpdate === "function") onAfterUpdate();
    throw err;
  }
}

function buildMarkdownFromNote(note) {
  if (!note) return "";
  if (note.markdown) return String(note.markdown).trim();
  if (Array.isArray(note.windows)) {
    return note.windows
      .map((entry) => String(entry?.markdown || "").trim())
      .filter(Boolean)
      .join("\n\n")
      .trim();
  }
  return "";
}

function getLearningNoteMeta(doc) {
  const status = getLearningNoteStatus(doc);
  switch (status) {
    case "processing":
      return " · 노트 생성중";
    case "ready":
      return " · 노트 준비";
    case "failed":
      return " · 노트 실패";
    case "pending":
    default:
      return doc?.notes ? " · 노트 준비" : "";
  }
}

function isLearningNoteReady(doc) {
  if (!doc) return false;
  const status = getLearningNoteStatus(doc);
  return status === "ready" || Boolean((doc.notes || "").trim());
}

function getLearningNotePendingText(doc) {
  const status = getLearningNoteStatus(doc);
  switch (status) {
    case "processing":
      return "개념노트를 생성하는 중입니다. 잠시만 기다려 주세요.";
    case "failed":
      return "개념노트 생성에 실패했습니다. 다시 시도해 주세요.";
    default:
      return "개념노트가 아직 준비되지 않았습니다.";
  }
}

function getLearningNoteStatus(doc) {
  if (!doc) return "pending";
  if (doc.learningNoteStatus) return doc.learningNoteStatus;
  return (doc.notes || "").trim() ? "ready" : "pending";
}

function renderNoteSection(block = "") {
  try {
    const parsed = JSON.parse(block);
    if (parsed && typeof parsed === "object" && parsed.title) {
      const summary = escapeHtml(parsed.summary || "");
      const details = Array.isArray(parsed.details)
        ? parsed.details.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
        : "";
      const tip = escapeHtml(parsed.tip || "");
      return `
        <section class="note-section">
          <h4>${escapeHtml(parsed.title)}</h4>
          ${summary ? `<p class="note-summary">${summary}</p>` : ""}
          ${details ? `<ul class="note-details">${details}</ul>` : ""}
          ${tip ? `<p class="note-tip">${tip}</p>` : ""}
        </section>
      `;
    }
  } catch (_) {
    /* fallback to plain text */
  }
  const lines = block
    .split(/\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => escapeHtml(line));
  return `<section class="note-section"><p>${lines.join("<br>")}</p></section>`;
}

function escapeHtml(str = "") {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function deleteDoc(docId, onAfterChange) {
  const state = getState();
  const target = state.docs.find((doc) => doc.id === docId);
  if (!target) return;

  const ok = confirm(`"${target.title}" 학습 자료를 삭제할까요?`);
  if (!ok) return;

  state.docs = state.docs.filter((doc) => doc.id !== docId);
  state.reviews = state.reviews.filter((review) => review.docId !== docId);

  if (runtime.currentDocId === docId) {
    runtime.currentDocId = null;
  }

  if (runtime.expandedDocId === docId) {
    runtime.expandedDocId = null;
  }

  if (runtime.currentQuiz && runtime.currentQuiz.docId === docId) {
    runtime.currentQuiz = null;
    runtime.selectedOptionIndex = null;
    const quizStatus = document.getElementById("quiz-status");
    if (quizStatus) {
      quizStatus.textContent = "삭제된 자료의 퀴즈가 종료되었습니다.";
    }
  }

  saveState();
  onAfterChange();
}
