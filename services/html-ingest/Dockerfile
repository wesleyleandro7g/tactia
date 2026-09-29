FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/html-ingest/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir --require-hashes -r requirements.txt
COPY services/html-ingest/app ./app
RUN useradd -m -u 10001 ingest && mkdir -p /data/adaptive && chown -R ingest:ingest /app /data/adaptive
USER ingest
ENV PYTHONUNBUFFERED=1
EXPOSE 8770
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8770"]
