# NCPMI Chatbot — backend server + static widget
#
# Node 24 (LTS) ships the built-in node:sqlite module without the
# experimental flag, so no native build tools are required.
FROM node:24-alpine

WORKDIR /app

# Install server dependencies first for better layer caching.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --omit=dev

# Copy the rest of the project (widget, index.html, knowledge base, etc.).
# .dockerignore keeps node_modules, .env and data/ out of the image.
COPY . .

EXPOSE 3002

# Simple healthcheck against the server's /api/health endpoint.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost:3002/api/health || exit 1

CMD ["node", "server/server.js"]
