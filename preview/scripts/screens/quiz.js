import { API_BASE } from "../constants.js";
import { getState, saveState } from "../state.js";
import { runtime } from "../runtime.js";
import { addDays, todayStr } from "../utils/date.js";

const DEFAULT_DECOYS = [
  "자료 구조 비교",
  "시간 복잡도 정의",
  "알고리즘 최적화",
  "네트워크 계층",
  "데이터베이스 정규화",
  "머신러닝 기본",
];

const QUIZ_PROGRESS_STEPS = [
  {
    id: "prepare",
    label: "자료 확인 중",
    description: "선택한 학습 자료를 확인하고 있어요.",
  },
  {
    id: "extract",
    label: "문서 분석 중",
    description: "서버에서 텍스트를 추출하는 중입니다.",
  },
  {
    id: "ai",
    label: "AI 생성 중",
    description: "Gemini가 문제를 만들고 있어요.",
  },
  {
    id: "finalize",
    label: "결과 정리 중",
    description: "생성된 문제를 적용하고 있습니다.",
  },
];

const QUIZ_STEP_PROGRESS = {
  prepare: 15,
  extract: 45,
  ai: 75,
  finalize: 90,
};

let quizCallbacks = {
  onStateChange: () => {},
};

const QUIZ_READY_DEFAULT = "학습 자료를 선택하면 AI가 퀴즈를 만들어 드립니다.";
const quizProgressState = {
  currentStep: null,
};

export function configureQuiz({ onStateChange }) {
  quizCallbacks.onStateChange = onStateChange;
}

export async function startQuizForDoc(docId, options = {}) {
  const {
    silent = false,
    cacheOnly = false,
    forceRegenerate = false,
    autoOpenPanel = false,
  } = options;
  const state = getState();
  const doc = state.docs.find((d) => d.id === docId);
  if (!doc) return;

  updateDocExtractionProgress(docId, 5);

  const hasCachedQuiz =
    Array.isArray(doc.preloadedQuiz) && doc.preloadedQuiz.length > 0 && !forceRegenerate;

  if (hasCachedQuiz && !cacheOnly) {
    prepareQuizSession({ docId, questions: doc.preloadedQuiz, title: doc.title });
    runtime.currentDocId = doc.id;
    if (!silent) {
      hideQuizLoading();
      setQuizReadyUI({
        message: `"${doc.title}" 퀴즈가 준비되었습니다!`,
        disabled: false,
      });
    }
    updateDocExtractionProgress(docId, 100);
    if (autoOpenPanel) {
      openQuizPanel();
    }
    return;
  }

  if (!silent && !cacheOnly) {
    resetQuizProgress(`"${doc.title}" 자료를 확인하고 있어요.`);
    setQuizReadyUI({ message: `"${doc.title}" 퀴즈를 준비 중입니다...`, disabled: true });
    showQuizLoading(`"${doc.title}" 내용을 분석하는 중...`);
  }
  updateExtractionStatus(docId, "processing");
  updateDocExtractionProgress(docId, QUIZ_STEP_PROGRESS.prepare);

  try {
    const { questions, notes } = await generateQuestionsForDocAI(doc, {
      silent: silent || cacheOnly,
    });
    if (notes) {
      doc.notes = notes;
    }
    if (cacheOnly) {
      doc.preloadedQuiz = questions;
      saveState();
      updateExtractionStatus(docId, "ready");
      updateDocExtractionProgress(docId, 100);
      return;
    }

    if (!silent) {
      setQuizProgressStep("finalize", "생성된 문제를 정리하는 중입니다.");
    }
    updateDocExtractionProgress(docId, QUIZ_STEP_PROGRESS.finalize);
    doc.preloadedQuiz = questions;
    if (notes) {
      doc.notes = notes;
    }
    saveState();
    prepareQuizSession({ docId, questions, title: doc.title });
    completeQuizProgress(`"${doc.title}" 퀴즈가 준비되었습니다!`);
    hideQuizLoading();
    setQuizReadyUI({
      message: `"${doc.title}" 퀴즈가 준비되었습니다!`,
      disabled: false,
    });
    updateExtractionStatus(docId, "ready");
    updateDocExtractionProgress(docId, 100);
    if (autoOpenPanel) {
      openQuizPanel();
    }
  } catch (err) {
    if (!silent) {
      setQuizProgressError("퀴즈 생성에 실패했습니다.");
      alert("AI 퀴즈 생성 실패: " + err.message);
      hideQuizLoading();
      setQuizReadyUI({
        message: "퀴즈 생성에 실패했습니다. 다시 시도해 주세요.",
        disabled: true,
      });
    }
    doc.preloadedQuiz = [];
    saveState();
    updateExtractionStatus(docId, "failed");
    updateDocExtractionProgress(docId, 0);
  }
}

export function startQuickRandomQuiz() {
  const state = getState();
  if (!state.docs.length) {
    alert("먼저 학습 자료를 업로드해 주세요.");
    return;
  }

  const doc = state.docs[Math.floor(Math.random() * state.docs.length)];
  const questions = generateLocalQuestions(doc).slice(0, 5);
  prepareQuizSession({ docId: doc.id, questions, title: doc.title });
  setQuizReadyUI({
    message: `"${doc.title}" 랜덤 퀴즈가 준비되었습니다!`,
    disabled: false,
  });
  openQuizPanel();
}

export function renderQuizQuestion() {
  const body = document.getElementById("quiz-body");
  const counter = document.getElementById("quiz-counter");
  const scoreEl = document.getElementById("quiz-score");
  const qEl = document.getElementById("quiz-question");
  const optsEl = document.getElementById("quiz-options");
  const feedbackEl = document.getElementById("quiz-feedback");
  const submitBtn = document.getElementById("btn-submit-answer");

  if (!runtime.currentQuiz || runtime.currentQuiz.finished || !runtime.currentQuiz.started) {
    runtime.selectedOptionIndex = null;
    body.classList.add("hidden");
    feedbackEl.textContent = "";
    if (submitBtn) submitBtn.disabled = true;
    return;
  }

  const { questions, currentIndex, score } = runtime.currentQuiz;
  const question = questions[currentIndex];
  body.classList.remove("hidden");
  document.getElementById("quiz-result")?.classList.add("hidden");
  document.getElementById("quiz-panel-title").textContent =
    runtime.currentQuiz.sourceTitle || "AI 퀴즈";
  counter.textContent = `문제 ${currentIndex + 1}/${questions.length}`;
  scoreEl.textContent = `점수 ${score}`;
  qEl.textContent = question.q;

  optsEl.innerHTML = "";
  runtime.selectedOptionIndex = null;
  submitBtn.disabled = true;
  feedbackEl.textContent = "";

  question.opts.forEach((opt, idx) => {
    const btn = document.createElement("button");
    btn.className = "quiz-option";
    btn.textContent = opt;
    btn.addEventListener("click", () => {
      runtime.selectedOptionIndex = idx;
      document.querySelectorAll(".quiz-option").forEach((optionEl) => {
        optionEl.classList.remove("selected");
      });
      btn.classList.add("selected");
      submitBtn.disabled = false;
    });
    optsEl.appendChild(btn);
  });
}

export function handleSubmitAnswer() {
  if (!runtime.currentQuiz || runtime.currentQuiz.finished) return;
  if (runtime.selectedOptionIndex === null) return;

  const { questions, currentIndex } = runtime.currentQuiz;
  const question = questions[currentIndex];
  const feedbackEl = document.getElementById("quiz-feedback");

  const isCorrect = runtime.selectedOptionIndex === question.correct;
  if (isCorrect) {
    runtime.currentQuiz.score += 10;
    runtime.currentQuiz.correctCount = (runtime.currentQuiz.correctCount || 0) + 1;
    feedbackEl.textContent = "정답입니다! +10점";
    feedbackEl.style.color = "#16a34a";
  } else {
    feedbackEl.textContent = `오답입니다. 정답: ${
      question.opts[question.correct]
    }`;
    feedbackEl.style.color = "#dc2626";
  }

  updateAggregates(isCorrect);
  setTimeout(moveToNextQuestion, 800);
}

function moveToNextQuestion() {
  if (!runtime.currentQuiz) return;

  if (runtime.currentQuiz.currentIndex < runtime.currentQuiz.questions.length - 1) {
    runtime.currentQuiz.currentIndex += 1;
    renderQuizQuestion();
  } else {
    finishQuiz();
  }
}

function updateAggregates(isCorrect) {
  const state = getState();
  state.user.totalAnswers += 1;
  if (isCorrect) state.user.correctAnswers += 1;

  const doc = state.docs.find((d) => d.id === runtime.currentQuiz.docId);
  if (doc) {
    if (!doc.quizStats) {
      doc.quizStats = { attempts: 0, correct: 0, total: 0 };
    }
    doc.quizStats.attempts += 1;
    doc.quizStats.total += 1;
    if (isCorrect) doc.quizStats.correct += 1;
    doc.progress = Math.min(100, (doc.progress || 0) + (isCorrect ? 5 : 2));
  }

  saveState();
  quizCallbacks.onStateChange();
}

function finishQuiz() {
  if (!runtime.currentQuiz) return;
  runtime.currentQuiz.finished = true;
  const state = getState();
  document.getElementById("quiz-status").textContent = `퀴즈 완료! 총 점수: ${runtime.currentQuiz.score}점`;

  state.user.totalMinutes += 3;
  state.user.streak = Math.min(state.user.streak + 1, 365);

  const doc = state.docs.find((d) => d.id === runtime.currentQuiz.docId);
  let wrongRate = 0.5;
  if (doc && doc.quizStats && doc.quizStats.total) {
    wrongRate = 1 - doc.quizStats.correct / doc.quizStats.total;
  }

  if (doc) {
    scheduleReviewsForDoc(doc.id, wrongRate);
  }

  saveState();
  quizCallbacks.onStateChange();
  showQuizResult();
}

function scheduleReviewsForDoc(docId, wrongRate) {
  const state = getState();
  const today = todayStr();
  state.reviews.forEach((review) => {
    if (review.docId === docId && review.dueDate >= today) {
      review.priority = 1 + Math.round(wrongRate * 3);
    }
  });

  [1, 3, 7, 14].forEach((d, idx) => {
    state.reviews.push({
      id: `rev_${docId}_extra_${Date.now()}_${d}`,
      docId,
      dueDate: addDays(today, d),
      stage: idx + 1,
      priority: 1 + Math.round(wrongRate * 3),
    });
  });
}

async function generateQuestionsForDocAI(doc, { silent = false } = {}) {
  if (!doc.fileId) {
    throw new Error("fileId가 없어 서버에서 문서 내용을 읽을 수 없습니다.");
  }

  if (!silent) {
    setQuizProgressStep("extract", `"${doc.title}" 문서를 분석하는 중입니다.`);
  }
  updateDocExtractionProgress(doc.id, QUIZ_STEP_PROGRESS.extract);
  const requestPromise = fetch(`${API_BASE}/api/generate-quiz-from-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId: doc.fileId, numQuestions: 5 }),
  });

  if (!silent) {
    setQuizProgressStep("ai", "Gemini가 퀴즈를 생성하는 중입니다.");
  }
  updateDocExtractionProgress(doc.id, QUIZ_STEP_PROGRESS.ai);
  const res = await requestPromise;

  const data = await res.json();
  if (!res.ok) {
    throw new Error("퀴즈 생성 실패: " + (data.error || "unknown"));
  }

  const rawQuestions = Array.isArray(data.questions)
    ? data.questions
    : Array.isArray(data)
    ? data
    : [];

  if (!rawQuestions.length) {
    throw new Error("생성된 퀴즈가 없습니다.");
  }

  const mappedQuestions = rawQuestions.map((q, idx) => ({
    q: q.question || q.q || `문제 ${idx + 1}`,
    opts: Array.isArray(q.options) ? q.options : q.opts || [],
    correct:
      typeof q.correctIndex === "number"
        ? q.correctIndex
        : typeof q.correct === "number"
        ? q.correct
        : 0,
    explanation: q.explanation || "",
  }));

  const notesText = normalizeNotes(data.notes);

  return { questions: mappedQuestions, notes: notesText };
}

function prepareQuizSession({ docId, questions, title }) {
  runtime.currentQuiz = {
    docId,
    questions,
    currentIndex: 0,
    score: 0,
    finished: false,
    started: false,
    correctCount: 0,
    sourceTitle: title,
  };
  runtime.selectedOptionIndex = null;
  runtime.lastQuizDocId = docId;
  runtime.lastQuizSourceTitle = title;
}

export function openQuizPanel() {
  if (!runtime.currentQuiz || !runtime.currentQuiz.questions?.length) {
    alert("먼저 퀴즈를 생성해 주세요.");
    return;
  }
  const panel = document.getElementById("quiz-play-panel");
  if (!panel) return;
  runtime.currentQuiz.started = true;
  runtime.currentQuiz.finished = false;
  runtime.currentQuiz.currentIndex = 0;
  runtime.currentQuiz.score = 0;
  runtime.currentQuiz.correctCount = 0;
  runtime.selectedOptionIndex = null;
  document.getElementById("quiz-result")?.classList.add("hidden");
  document.getElementById("quiz-body")?.classList.remove("hidden");
  panel.classList.remove("hidden");
  document.getElementById("quiz-status").textContent =
    runtime.currentQuiz.sourceTitle
      ? `"${runtime.currentQuiz.sourceTitle}" 기반 퀴즈입니다.`
      : "AI 퀴즈가 준비되었습니다.";
  const submitBtn = document.getElementById("btn-submit-answer");
  if (submitBtn) submitBtn.disabled = true;
  renderQuizQuestion();
}

export function closeQuizPanel() {
  document.getElementById("quiz-play-panel")?.classList.add("hidden");
  document.getElementById("quiz-result")?.classList.add("hidden");
  document.getElementById("quiz-body")?.classList.remove("hidden");
  if (runtime.currentQuiz) runtime.currentQuiz.started = false;
}

export function regenerateQuiz() {
  closeQuizPanel();
  if (runtime.lastQuizDocId) {
    startQuizForDoc(runtime.lastQuizDocId, { forceRegenerate: true, autoOpenPanel: true });
  } else {
    startQuickRandomQuiz();
  }
}

function showQuizResult() {
  const result = document.getElementById("quiz-result");
  const body = document.getElementById("quiz-body");
  if (!runtime.currentQuiz || !result || !body) return;
  body.classList.add("hidden");
  const total = runtime.currentQuiz.questions.length;
  const correct = runtime.currentQuiz.correctCount || 0;
  document.getElementById("quiz-result-summary").textContent =
    `${total}문제 중 ${correct}개 정답`; 
  result.classList.remove("hidden");
}

function showQuizLoading(message) {
  const loader = document.getElementById("quiz-loading");
  const text = document.getElementById("quiz-loading-text");
  if (!loader || !text) return;
  text.textContent = message;
  loader.classList.remove("hidden");
}

function hideQuizLoading() {
  document.getElementById("quiz-loading")?.classList.add("hidden");
}

function setQuizReadyUI({ message = QUIZ_READY_DEFAULT, disabled }) {
  const status = document.getElementById("quiz-ready-status");
  const btn = document.getElementById("btn-open-quiz-play");
  if (status) status.textContent = message;
  if (btn && typeof disabled === "boolean") {
    btn.disabled = disabled;
  }
}

export function syncQuizReadyUI() {
  if (runtime.currentQuiz && runtime.currentQuiz.questions?.length) {
    setQuizReadyUI({
      message:
        runtime.currentQuiz.sourceTitle
          ? `"${runtime.currentQuiz.sourceTitle}" 퀴즈가 준비되었습니다!`
          : "퀴즈가 준비되었습니다!",
      disabled: false,
    });
  } else {
    setQuizReadyUI({ message: QUIZ_READY_DEFAULT, disabled: true });
  }
}

function resetQuizProgress(initialMessage) {
  renderQuizProgressList();
  const textEl = document.getElementById("quiz-loading-text");
  if (textEl) {
    textEl.style.color = "#1f2937";
  }
  const firstStep = QUIZ_PROGRESS_STEPS[0];
  if (firstStep) {
    setQuizProgressStep(firstStep.id, initialMessage);
  }
}

function renderQuizProgressList() {
  const listEl = document.getElementById("quiz-progress-list");
  if (!listEl) return;
  listEl.innerHTML = "";
  QUIZ_PROGRESS_STEPS.forEach((step) => {
    const li = document.createElement("li");
    li.className = "quiz-progress-item";
    li.dataset.step = step.id;

    const indicator = document.createElement("div");
    indicator.className = "quiz-progress-indicator";

    const textWrap = document.createElement("div");
    textWrap.className = "quiz-progress-text";
    const title = document.createElement("strong");
    title.textContent = step.label;
    const desc = document.createElement("span");
    desc.textContent = step.description;

    textWrap.appendChild(title);
    textWrap.appendChild(desc);
    li.appendChild(indicator);
    li.appendChild(textWrap);
    listEl.appendChild(li);
  });
  quizProgressState.currentStep = QUIZ_PROGRESS_STEPS[0]?.id ?? null;
  updateQuizProgressUI();
}

function setQuizProgressStep(stepId, customMessage) {
  quizProgressState.currentStep = stepId;
  updateQuizProgressUI();
  const targetStep = QUIZ_PROGRESS_STEPS.find((step) => step.id === stepId);
  const text = customMessage || targetStep?.label;
  if (text) {
    const textEl = document.getElementById("quiz-loading-text");
    if (textEl) {
      textEl.textContent = text;
      textEl.style.color = "#1f2937";
    }
  }
}

function updateQuizProgressUI() {
  const listEl = document.getElementById("quiz-progress-list");
  if (!listEl || !quizProgressState.currentStep) return;
  const index = QUIZ_PROGRESS_STEPS.findIndex((step) => step.id === quizProgressState.currentStep);
  Array.from(listEl.children).forEach((item, idx) => {
    item.classList.toggle("completed", idx < index);
    item.classList.toggle("active", idx === index);
  });
}

function completeQuizProgress(message) {
  const lastStep = QUIZ_PROGRESS_STEPS[QUIZ_PROGRESS_STEPS.length - 1];
  if (lastStep) {
    setQuizProgressStep(lastStep.id, message);
  }
  const listEl = document.getElementById("quiz-progress-list");
  if (!listEl) return;
  Array.from(listEl.children).forEach((item) => {
    item.classList.add("completed");
    item.classList.remove("active");
  });
}

function setQuizProgressError(message) {
  const listEl = document.getElementById("quiz-progress-list");
  if (listEl) {
    Array.from(listEl.children).forEach((item) => {
      item.classList.remove("active");
    });
  }
  const textEl = document.getElementById("quiz-loading-text");
  if (textEl) {
    textEl.textContent = message;
    textEl.style.color = "#dc2626";
  }
}

function updateExtractionStatus(docId, status) {
  const state = getState();
  const doc = state.docs.find((d) => d.id === docId);
  if (!doc) return;
  doc.extractionStatus = status;
  saveState();
  quizCallbacks.onStateChange();
}

function updateDocExtractionProgress(docId, percent) {
  const state = getState();
  const doc = state.docs.find((d) => d.id === docId);
  if (!doc) return;
  const value = Math.max(0, Math.min(100, Math.round(Number(percent ?? 0))));
  doc.extractionProgress = value;
  saveState();
  quizCallbacks.onStateChange();
}

function generateLocalQuestions(doc) {
  const topics = (doc.notes || "")
    .split(/\n|-/)
    .map((line) => line.trim())
    .filter(Boolean);

  const pool = topics.length ? topics : [doc.title.replace(/\.[^.]+$/, "")];

  return pool.map((topic, idx) => buildQuestionFromTopic(topic, doc.title, idx));
}

function normalizeNotes(raw) {
  if (Array.isArray(raw)) {
    const cleaned = raw.map((item) => String(item || "").trim()).filter(Boolean);
    return cleaned.join("\n\n");
  }
  if (typeof raw === "string") {
    const cleaned = raw
      .split(/\n{2,}/)
      .map((line) => line.trim())
      .filter(Boolean);
    return cleaned.join("\n\n");
  }
  return "";
}

function buildQuestionFromTopic(topic, docTitle, idx) {
  const baseQuestion = `${docTitle} 학습 내용 중 핵심 개념을 고르세요.`;
  const decoys = getDecoyOptions(topic, idx);
  const options = shuffle([topic, ...decoys]).slice(0, 4);
  const correct = options.indexOf(topic);

  return {
    q: baseQuestion,
    opts: options,
    correct: correct === -1 ? 0 : correct,
    explanation: `${topic} 관련 핵심 개념입니다.`,
  };
}

function getDecoyOptions(answer, seed) {
  const filtered = DEFAULT_DECOYS.filter((item) => item !== answer);
  const decoys = [];
  for (let i = 0; i < filtered.length && decoys.length < 3; i += 1) {
    const index = (seed + i) % filtered.length;
    decoys.push(filtered[index]);
  }
  while (decoys.length < 3) {
    decoys.push(filtered[Math.floor(Math.random() * filtered.length)] || "심화 학습");
  }
  return decoys;
}

function shuffle(arr) {
  return arr
    .map((value) => ({ value, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ value }) => value);
}
