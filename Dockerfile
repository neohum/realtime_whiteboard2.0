FROM node:16-alpine

WORKDIR /app

# 패키지 파일 복사 및 설치
COPY package*.json ./
RUN npm install

# 소스 코드 복사
COPY . .

# 로그 디렉토리 생성
RUN mkdir -p logs

# 포트 설정
EXPOSE 3000

# 시작 명령어
CMD ["node", "backend/server.js"]