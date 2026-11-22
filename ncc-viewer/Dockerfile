FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
COPY package-lock.json ./
RUN npm ci

COPY server.js ./
COPY public ./public
COPY vite.config.js ./
RUN npm run build

EXPOSE 4321

ENV PORT=4321
CMD ["node", "server.js"]
