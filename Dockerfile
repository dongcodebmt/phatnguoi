FROM node:alpine AS environment

FROM environment AS build
WORKDIR /app
COPY . ./
RUN npm install
RUN npm run build

FROM environment AS production
WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/package*.json ./
ENV NODE_ENV=production
RUN npm install --omit=dev
ENTRYPOINT ["npm", "run", "start"]