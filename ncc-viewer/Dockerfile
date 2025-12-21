FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public ./public

EXPOSE 4321

ENV PORT=4321
CMD ["node", "server.js"]
