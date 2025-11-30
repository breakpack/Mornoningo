# AIapp 배포 가이드

## 구성

-   `server/`: FastAPI 기반 API 서버 (PDF/PPTX 텍스트 추출 → Gemini로 퀴즈 생성)
-   `preview/`: 정적 프론트엔드. 서버가 정적으로 서빙하도록 설정됨.

## 환경 변수

`.env`를 프로젝트 루트(`Mornoningo/server/.env`)에 생성:

```env
GEMINI_API_KEY=your_gemini_api_key_here
# 선택: 기본값 gemini-2.0-flash
# GEMINI_MODEL=gemini-2.0-flash-exp
```

## 설치 및 실행

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 4000 --reload
```

서버 기동 후 `http://localhost:4000` 접속 시 프론트가 열리고 API는 동일 호스트로 호출됩니다.

## 프론트 실행

- FastAPI가 `preview/` 디렉터리를 정적 자원으로 서빙하므로 별도 빌드 없이 위의 `uvicorn` 명령만 실행하면 됩니다.
- 브라우저가 `/scripts`, `/styles`, `/assets`를 같은 오리진으로 요청하기 때문에 추가 설정 없이 최신 UI를 바로 확인할 수 있습니다.

## 엔드포인트

-   `GET /health` 헬스체크
-   `POST /api/upload` multipart `file` 업로드 → `{ ok, fileId, originalName }`
-   `POST /api/generate-quiz` `{ sourceText, numQuestions?, difficulty? }`
-   `POST /api/generate-quiz-from-file` `{ fileId, numQuestions? }` (업로드된 PDF/PPTX 사용)

## 배포

-   프론트/백이 같은 FastAPI 인스턴스에서 서빙되므로 CORS 단순화.
-   업로드 파일은 `server/upload`, 생성된 퀴즈는 `server/data/quizzes.json`에 저장됩니다.
-   정적 자산 캐싱을 원하면 리버스 프록시(Nginx 등) 앞단에 캐시 헤더 추가.
-   프로덕션에서는 `uvicorn` 혹은 `gunicorn -k uvicorn.workers.UvicornWorker` 조합을 사용하고 프로세스 매니저(systemd, Supervisor 등)로 감시하세요.
