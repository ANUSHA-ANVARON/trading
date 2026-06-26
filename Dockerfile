FROM node:20-slim

RUN apt-get update && apt-get install -y \
    libfontconfig1 \
    libpixman-1-0 \
    libfreetype6 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .

EXPOSE 3000
CMD ["npm", "run", "start"]
