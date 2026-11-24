FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PYTHON_PATH=/opt/venv/bin/python \
    PORT=10000

RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 python3-venv ffmpeg ca-certificates \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/venv/bin/pip install --no-cache-dir --upgrade "yt-dlp[default]"

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

EXPOSE 10000
CMD ["npm", "start"]
