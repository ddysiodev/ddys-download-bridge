FROM node:20-alpine
WORKDIR /app
COPY . .
EXPOSE 8788
CMD ["node", "src/server.mjs"]
