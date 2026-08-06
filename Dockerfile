# Container image for the AgentSync hub — works on Fly.io, Railway, and any container host.
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
# Hosts inject PORT; the hub reads it. Set AGENTSYNC_TOKEN as a secret/env var.
ENV PORT=7777
EXPOSE 7777
CMD ["node", "src/cli/index.js", "hub"]
