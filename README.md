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
- 프론트가 다른 도메인/호스트(예: GitHub Pages, S3)에서 서비스된다면 아래 "원격 호스팅" 절차에 따라 API 주소를 지정해야 합니다.

## 원격 호스팅

프론트와 FastAPI 서버를 같은 프로세스에서 제공하지 않을 경우 업로드, AI 호출 등은 API 엔드포인트를 명시적으로 알려 주어야 합니다.

선호하는 방법을 하나만 선택해 적용하세요.

1. **메타 태그 사용**: `preview/index.html`의 `<head>` 안쪽에 `<meta name="app-api-base" content="https://your-api-host">` 추가
2. **전역 변수 사용**: 스크립트 로딩 전에 `<script>window.__APP_API_BASE__ = "https://your-api-host";</script>` 추가
3. **쿼리 파라미터**: 배포 URL에 `?apiBase=https://your-api-host`를 한 번만 붙여 접속 (localStorage에 기억됨)

`https://your-api-host` 부분에는 FastAPI가 동작 중인 실제 오리진(프로토콜+도메인+포트)을 적어 주세요. 값 끝의 `/`는 자동으로 제거됩니다.

## Docker 배포

컨테이너 하나로 FastAPI와 정적 프론트엔드를 동시에 호스팅할 수 있습니다.

1. `cp server/.env.example server/.env` 후 실제 `GEMINI_API_KEY`를 채우세요.
2. 업로드/데이터 영속화를 위해 `mkdir -p server/upload server/data`로 호스트 디렉터리를 준비하세요.
3. **docker compose**  
   ```bash
   APP_PORT=4000 docker compose up --build -d
   ```  
   - `APP_PORT`를 변경하면 외부에서 접근할 포트가 바뀝니다. 컨테이너 내부 포트는 항상 4000입니다.
   - `server/upload`, `server/data`가 볼륨으로 마운트되어 컨테이너 재시작에도 파일이 유지됩니다.
4. **docker run (수동 실행)**  
   ```bash
   docker build -t mornoningo .
   docker run -d \
     --name mornoningo \
     --env-file server/.env \
     -p 4000:4000 \
     -v "$(pwd)/server/upload:/app/server/upload" \
     -v "$(pwd)/server/data:/app/server/data" \
     mornoningo
   ```  
   필요 시 `-p` 옵션의 왼쪽 포트 번호를 수정하세요.
5. 배포 후 `http://<서버IP>:APP_PORT`에 접속해 프론트를 확인하고, 별도로 정적 호스팅을 한다면 "원격 호스팅" 절차로 API 주소를 주입하세요.

## 엔드포인트

-   `GET /health` 헬스체크
-   `POST /api/upload` multipart `file` 업로드 → `{ ok, fileId, originalName }`
-   `POST /api/generate-quiz` `{ sourceText, numQuestions?, difficulty? }`
-   `POST /api/generate-quiz-from-file` `{ fileId, numQuestions? }` (업로드된 PDF/PPTX 사용)
-   `POST /api/generate-learning-note` `{ fileId, windowSize?, force? }` (페이지별 요약 + Markdown)
-   `GET /api/learning-note/{fileId}` 업로드된 파일의 학습노트 조회

## 배포

-   프론트/백이 같은 FastAPI 인스턴스에서 서빙되므로 CORS 단순화.
-   단일 서버에 배포할 경우 `uvicorn main:app --host 0.0.0.0 --port 4000` 혹은 `gunicorn -k uvicorn.workers.UvicornWorker main:app` 조합을 사용하고 리버스 프록시(Nginx 등) 뒤에서 서비스하면 됩니다.
-   정적 자산만을 CDN 등에서 별도로 호스팅할 때는 위 "원격 호스팅" 섹션의 API 베이스 설정을 반드시 적용하세요.
-   업로드 파일은 `server/upload`, 생성된 퀴즈는 `server/data/quizzes.json`에 저장됩니다.
-   정적 자산 캐싱을 원하면 리버스 프록시(Nginx 등) 앞단에 캐시 헤더 추가.
-   프로덕션에서는 `uvicorn` 혹은 `gunicorn -k uvicorn.workers.UvicornWorker` 조합을 사용하고 프로세스 매니저(systemd, Supervisor 등)로 감시하세요.
