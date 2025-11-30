# 모르노닝고 현황 요약

## 프런트 구조
- `preview/`는 SPA 형태로 구성, CSS는 `styles/base|components|screens|intro.css`, JS는 `scripts/` 모듈로 분할
- 라우터(`router.js`)는 해시 기반 네비게이션, 인트로(`intro.js`)는 스킵 가능하며 자동 종료
- `constants.js`가 API_BASE를 자동 결정해 프런트/백이 같은 호스트로 통신

## 주요 화면/기능
- 홈: 학습 카드/진도/추천/랭킹 요약, 퀴즈 허브 이동 버튼
- 랭킹: 리스트 클릭 시 모달로 친구 정보 + "덤벼봐" 버튼 (상대/본인 여부에 따라 문구 다름)
- 퀴즈 허브: 업로드 카드와 "랜덤 퀴즈" 버튼, 자료 상세, 퀴즈 대기 카드와 로딩 블록
- 퀴즈 패널: 전면 패널에서 문제 풀이, 결과 요약(정답 수/재생성 버튼) 제공
- 복습: 오늘 복습 리스트 + 에빙하우스 추천(1/3/7/14일) 리스트
- My: 개인 통계/배지/랭킹 안내 텍스트

## 상태/데이터
- `state.js`: `currentUserId`, `leaderboard`, `upcomingExamDate` 등을 보정, 한글 파일명도 NFC 정규화
- `runtime.js`: 퀴즈 세션/선택 상태 + 마지막 문서 ID 추적

## 백엔드 (server/)
- FastAPI (`main.py`)가 프론트 정적 자산을 함께 서빙하며 `/api/*` 엔드포인트를 제공
- 업로드 파일은 `server/upload`, 생성된 퀴즈 기록은 JSON 스토리지(`server/data/quizzes.json`)에 저장
- PDF는 `pypdf`, PPTX는 단순 XML 파싱으로 텍스트를 추출하고 `normalize_text`로 정리 후 Gemini 2.0 Flash 호출
- 주요 API: `/api/upload`, `/api/generate-quiz`, `/api/generate-quiz-from-file`, `/health`

## UX 흐름
1. 자료 업로드 → 상태 `pending`
2. "퀴즈 풀기" 클릭 → 로딩 UI, 추출 상태 `processing`
3. AI 응답 수신 시 상태 `ready`, "퀴즈 풀러가기" 버튼 활성화
4. 퀴즈 패널에서 문제 풀이, 완료 후 정답 수/재생성 UI 표시
