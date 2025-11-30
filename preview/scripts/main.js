import { loadState, getState } from "./state.js";
import { runtime } from "./runtime.js";
import { initRouter, switchScreen } from "./router.js";
import { playIntro } from "./intro.js";
import { renderHome } from "./screens/home.js";
import { renderDocsList, setupUpload } from "./screens/library.js";
import { renderSchedule } from "./screens/schedule.js";
import { renderProfile } from "./screens/profile.js";
import { renderRanking } from "./screens/ranking.js";
import {
  configureQuiz,
  handleSubmitAnswer,
  renderQuizQuestion,
  startQuickRandomQuiz,
  startQuizForDoc,
  openQuizPanel,
  closeQuizPanel,
  regenerateQuiz,
  syncQuizReadyUI,
} from "./screens/quiz.js";

function init() {
  loadState();
  initRouter();
  configureQuiz({ onStateChange: renderAll });
  setupUpload({
    onAfterUpload: renderAll,
    onAutoGenerate: (docId) =>
      startQuizForDoc(docId, { cacheOnly: true, silent: true }).catch((err) =>
        console.error("자동 퀴즈 생성 실패", err)
      ),
  });
  initEvents();
  renderAll();
  playIntro().then(() => switchScreen("home"));
}

document.addEventListener("DOMContentLoaded", init);

function renderAll() {
  renderHome();
  renderDocsList({
    onStartQuiz: startQuizFlow,
    onAfterChange: renderAll,
  });
  renderSchedule({ onStartQuiz: startQuizFlow });
  renderProfile();
  renderQuizQuestion();
  renderRanking();
  renderHeaderSummary();
  syncQuizReadyUI();
}

function startQuizFlow(docId) {
  if (!docId) return;
  startQuizForDoc(docId, { autoOpenPanel: true });
}

function initEvents() {
  document
    .getElementById("btn-go-review")
    ?.addEventListener("click", () => switchScreen("schedule"));

  document
    .getElementById("btn-new-quiz")
    ?.addEventListener("click", () => {
      startQuickRandomQuiz();
      switchScreen("quiz");
    });

  document
    .getElementById("btn-go-quiz")
    ?.addEventListener("click", () => switchScreen("quiz"));

  document
    .getElementById("btn-start-doc-quiz")
    ?.addEventListener("click", () => {
      if (!runtime.currentDocId) return;
      startQuizFlow(runtime.currentDocId);
    });

  document
    .getElementById("btn-show-notes")
    ?.addEventListener("click", () => {
      const el = document.getElementById("doc-notes");
      if (!el) return;
      el.style.display = el.style.display === "none" ? "block" : "none";
    });

  document
    .getElementById("btn-submit-answer")
    ?.addEventListener("click", handleSubmitAnswer);

  document
    .getElementById("btn-quick-quiz")
    ?.addEventListener("click", () => {
      startQuickRandomQuiz();
    });

  document
    .getElementById("toggle-notifications")
    ?.addEventListener("change", (event) => {
      if (event.target.checked) {
        alert("알림이 켜졌다고 가정합니다. (실제 푸시는 서버/앱이 필요)");
      }
    });

  document
    .getElementById("btn-open-quiz-play")
    ?.addEventListener("click", openQuizPanel);

  document
    .getElementById("btn-close-quiz")
    ?.addEventListener("click", closeQuizPanel);

  document
    .getElementById("btn-quiz-exit")
    ?.addEventListener("click", closeQuizPanel);

  document
    .getElementById("btn-quiz-regenerate")
    ?.addEventListener("click", regenerateQuiz);
}

function renderHeaderSummary() {
  const state = getState();
  const ddayEl = document.getElementById("header-dday");
  if (ddayEl && state.upcomingExamDate) {
    const diff = calcDDay(state.upcomingExamDate);
    const label = diff === 0 ? "D-day" : diff > 0 ? `D-${diff}` : `D+${Math.abs(diff)}`;
    ddayEl.textContent = `${label} · ${formatDate(state.upcomingExamDate)} 시험`;
  }

  const leaderboard = Array.isArray(state.leaderboard)
    ? [...state.leaderboard].sort((a, b) => b.score - a.score)
    : [];
  const userId = state.currentUserId;
  const index = leaderboard.findIndex((entry) => entry.id === userId);
  const entry = index >= 0 ? leaderboard[index] : null;

  const scoreEl = document.getElementById("header-score-value");
  if (scoreEl) scoreEl.textContent = entry?.score ?? 0;

  const rankEl = document.getElementById("header-rank-value");
  if (rankEl) rankEl.textContent = index >= 0 ? `${index + 1}위` : "순위없음";

  const avatarEl = document.getElementById("header-avatar");
  if (avatarEl) {
    avatarEl.textContent = getInitials(state.user?.name || "M");
  }

  const diffEl = document.getElementById("header-rank-diff");
  const scoreDiffEl = document.getElementById("header-score-diff");
  if (diffEl) {
    const diff = Number(state.user?.bestRankDiff ?? 0);
    if (diff === 0) {
      diffEl.textContent = "어제와 동일";
      diffEl.style.color = "#6b7280";
    } else {
      const sign = diff > 0 ? "+" : "";
      diffEl.textContent = `어제보다 ${sign}${diff}점`;
      diffEl.style.color = diff > 0 ? "#16a34a" : "#dc2626";
    }
  }

  if (scoreDiffEl) {
    const diff = Number(state.user?.bestRankDiff ?? 0);
    if (diff === 0) {
      scoreDiffEl.textContent = "어제와 동일";
      scoreDiffEl.style.color = "#6b7280";
    } else {
      const sign = diff > 0 ? "+" : "";
      scoreDiffEl.textContent = `${sign}${diff}점 변화`;
      scoreDiffEl.style.color = diff > 0 ? "#16a34a" : "#dc2626";
    }
  }
}

function calcDDay(targetDateStr) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(targetDateStr);
  target.setHours(0, 0, 0, 0);
  const diffMs = target - today;
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr) {
  const date = new Date(dateStr);
  if (Number.isNaN(date.getTime())) return dateStr;
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getInitials(name) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return "M";
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
