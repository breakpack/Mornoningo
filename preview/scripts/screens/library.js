import { getState, saveState } from "../state.js";
import { runtime } from "../runtime.js";
import { todayStr, addDays } from "../utils/date.js";
import { uploadFileToServer } from "../services/files.js";

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
    meta.textContent = `${doc.progress || 0}% 완료 · 개념 ${
      doc.conceptsCount || 0
    }개${doc.notes ? " · 노트 준비" : ""}`;
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
      notesBtn.disabled = !doc.notes;
      notesBtn.title = doc.notes ? "전체 화면으로 개념노트를 봅니다." : "개념노트 생성중";
      notesBtn.addEventListener("click", (event) => {
        event.stopPropagation();
        openNotesPanel(doc);
      });

      actions.appendChild(playBtn);
      actions.appendChild(notesBtn);

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

function openNotesPanel(doc) {
  const noteText = (doc?.notes || "").trim();
  if (!noteText) {
    alert("생성된 개념노트가 없습니다.");
    return;
  }
  if (!notesPanel || !notesContentEl || !notesTitleEl) return;
  const sections = noteText.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const title = doc?.title || "개념노트";
  notesTitleEl.textContent = `${title} · 개념노트`;
  notesContentEl.innerHTML = sections.length
    ? sections
        .map((block) => renderNoteSection(block))
        .join("")
    : `<p class="note-empty">추출된 개념노트가 없습니다.</p>`;
  notesPanel.classList.remove("hidden");
}

function closeNotesPanel() {
  if (!notesPanel || !notesContentEl || !notesTitleEl) return;
  notesPanel.classList.add("hidden");
  notesTitleEl.textContent = "";
  notesContentEl.innerHTML = "";
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
