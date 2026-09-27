FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates fonts-liberation libnss3 libatk-bridge2.0-0 libgbm1 libasound2 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY services/browser-runtime/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY services/browser-runtime/app ./app
COPY services/browser-runtime/tests ./tests
RUN useradd -m -u 10001 browser && chown -R browser:browser /app
USER browser
ENV PYTHONUNBUFFERED=1 BROWSER_USE_HEADLESS=true BROWSER_USE_VERSION_CHECK=false
EXPOSE 8765
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8765"]
