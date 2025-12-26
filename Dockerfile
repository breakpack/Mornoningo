FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY server/requirements.txt /app/server/requirements.txt
RUN pip install --no-cache-dir -r /app/server/requirements.txt

COPY server /app/server
COPY preview /app/preview

EXPOSE 4000

ENV GEMINI_MODEL=gemini-2.0-flash

CMD ["uvicorn", "server.main:app", "--host", "0.0.0.0", "--port", "4000"]
