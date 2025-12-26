import { getState } from "../state.js";

export function renderProfile() {
  const state = getState();
  const user = state.user;
  const nameEl = document.getElementById("profile-name");
  if (nameEl) nameEl.textContent = `Lv.${user.level} Data Rookie 🔥`;

  const hours = Math.floor(user.totalMinutes / 60);
  const minutes = user.totalMinutes % 60;
  const timeEl = document.getElementById("profile-time");
  if (timeEl) timeEl.textContent = `${hours}h ${minutes}m`;

  const accuracy =
    user.totalAnswers === 0
      ? 0
      : Math.round((user.correctAnswers / user.totalAnswers) * 100);
  const accuracyEl = document.getElementById("profile-accuracy");
  if (accuracyEl) accuracyEl.textContent = `${accuracy}%`;

  const rankingEl = document.getElementById("profile-ranking");
  if (rankingEl) {
    rankingEl.textContent = `친구 평균보다 +${user.bestRankDiff || 0}점`;
  }

  renderBadges(user);
}

function renderBadges(user) {
  const list = document.getElementById("badge-list");
  list.innerHTML = "";

  const badges = [];
  if (user.totalAnswers >= 10) badges.push("첫 10문제 돌파");
  if (user.totalAnswers >= 30) badges.push("퀴즈 장인");
  if (user.streak >= 3) badges.push("3일 연속 학습");
  if (user.correctAnswers >= 20) badges.push("정답 왕");

  if (!badges.length) {
    const li = document.createElement("li");
    li.className = "badge-item";
    li.textContent = "아직 획득한 뱃지가 없습니다. 퀴즈를 풀어보세요!";
    list.appendChild(li);
    return;
  }

  badges.forEach((badge) => {
    const li = document.createElement("li");
    li.className = "badge-item";
    li.textContent = `🏅 ${badge}`;
    list.appendChild(li);
  });
}
