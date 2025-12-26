import { STORAGE_KEY } from "./constants.js";
import { todayStr, addDays } from "./utils/date.js";

let appState = null;

export function getState() {
  if (!appState) {
    throw new Error("State is not initialized. loadState() must run first.");
  }
  return appState;
}

export function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    appState = createSampleState();
    saveState();
    return;
  }

  try {
    appState = JSON.parse(raw);
  } catch (err) {
    console.error("Failed to parse state, falling back to sample data.", err);
    appState = createSampleState();
    saveState();
    return;
  }

  ensureStateShape();
}

export function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
}

function ensureStateShape() {
  if (!appState.currentUserId) {
    appState.currentUserId = "user_me";
  }
  if (!appState.upcomingExamDate) {
    appState.upcomingExamDate = addDays(todayStr(), 30);
  }
  if (!Array.isArray(appState.leaderboard) || appState.leaderboard.length === 0) {
    appState.leaderboard = buildFallbackLeaderboard(appState);
  }
  ensureLeaderboardSeed();
  ensureDocsDefaults();
}

function createSampleState() {
  const today = todayStr();
  const docs = [
    {
      id: "doc_os",
      title: "운영체제 개론.pptx",
      type: "pptx",
      progress: 78,
      conceptsCount: 23,
      createdAt: today,
      notes:
        "- 프로세스/스레드 개념 정리\n- 프로세스 상태 전이\n- 스케줄링 알고리즘(FCFS, SJF, RR)\n- 동기화와 세마포어\n- 교착상태 조건",
      learningNoteStatus: "ready",
      quizStats: { attempts: 2, correct: 15, total: 20 },
    },
    {
      id: "doc_ds",
      title: "자료구조 개념 정리.pdf",
      type: "pdf",
      progress: 56,
      conceptsCount: 18,
      createdAt: today,
      notes:
        "- 배열, 연결리스트 비교\n- 스택/큐, 덱\n- 트리/그래프 기본 용어\n- 시간 복잡도 개념(O, Ω, Θ)",
      learningNoteStatus: "ready",
      quizStats: { attempts: 1, correct: 6, total: 10 },
    },
  ];

  const reviews = [];
  docs.forEach((doc, idx) => {
    const base = addDays(today, idx === 0 ? 0 : -1);
    [1, 3, 7, 14].forEach((d, stage) => {
      reviews.push({
        id: `rev_${doc.id}_${d}`,
        docId: doc.id,
        dueDate: addDays(base, d),
        stage: stage + 1,
        priority: 1,
      });
    });
  });

  const currentUserId = "user_me";

  return {
    user: {
      name: "Data Rookie",
      level: 12,
      streak: 3,
      totalMinutes: 13 * 60 + 22,
      totalAnswers: 30,
      correctAnswers: 21,
      bestRankDiff: 23,
    },
    docs,
    reviews,
    lastLoginDate: today,
    quizSessions: [],
    currentUserId,
    upcomingExamDate: addDays(today, 30),
    leaderboard: [
      { id: "u0", name: "랭킹 지배자", score: 1680, streak: 10 },
      { id: currentUserId, name: "Data Rookie", score: 1240, streak: 3 },
      { id: "u2", name: "AI Explorer", score: 1180, streak: 5 },
      { id: "u3", name: "알고리즘 장인", score: 1130, streak: 2 },
      { id: "u4", name: "통계 고수", score: 980, streak: 4 },
      { id: "u5", name: "CS Fresh", score: 910, streak: 1 },
    ],
  };
}

function buildFallbackLeaderboard(state) {
  const baseScore = 1000 + (state.user?.correctAnswers || 0) * 5;
  return [
    {
      id: state.currentUserId,
      name: state.user?.name || "나",
      score: baseScore,
      streak: state.user?.streak || 0,
    },
    { id: "u2", name: "AI Explorer", score: baseScore - 30, streak: 5 },
    { id: "u3", name: "알고리즘 장인", score: baseScore - 60, streak: 2 },
  ];
}

function ensureLeaderboardSeed() {
  const entries = appState.leaderboard || [];
  const hasBoss = entries.some((entry) => entry.id === "u0");
  if (!hasBoss) {
    entries.push({ id: "u0", name: "랭킹 지배자", score: 1680, streak: 10 });
  }

  const userId = appState.currentUserId;
  const seen = new Set();
  appState.leaderboard = entries
    .filter((entry) => {
      if (!entry?.id) return false;
      if (seen.has(entry.id)) return false;
      seen.add(entry.id);
      return true;
    })
    .map((entry) =>
      entry.id === userId
        ? { ...entry, name: appState.user?.name || entry.name }
        : entry
    )
    .sort((a, b) => b.score - a.score);
}

function ensureDocsDefaults() {
  if (!Array.isArray(appState.docs)) {
    appState.docs = [];
    return;
  }
  appState.docs = appState.docs.map((doc) => {
    if (!doc) return doc;
    const status = doc.learningNoteStatus || (doc.notes ? "ready" : "pending");
    return { ...doc, learningNoteStatus: status };
  });
}
