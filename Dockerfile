# --- build stage: build the React app ---
FROM node:22-bookworm AS build
WORKDIR /app
COPY package*.json ./
# NOTE: --legacy-peer-deps required due to vite@8 / @vitejs/plugin-react@4 peer conflict
RUN npm ci --legacy-peer-deps
COPY . .
RUN npm run build

# --- runtime stage ---
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
# NOTE: --legacy-peer-deps required due to vite@8 / @vitejs/plugin-react@4 peer conflict
RUN npm ci --omit=dev --legacy-peer-deps
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
EXPOSE 3000
CMD ["node", "server/index.js"]
