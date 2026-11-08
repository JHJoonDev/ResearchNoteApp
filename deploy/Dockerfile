# ==========================================
# 1단계: 프런트엔드 정적 파일 빌드
# ==========================================
FROM node:24-bookworm-slim AS frontend-builder
WORKDIR /app

# 프런트엔드가 참조하는 공유 패키지만 복사 (file:../packages/* 상대 경로 매핑)
COPY packages/note-format/ ./packages/note-format/
COPY packages/note-editor/ ./packages/note-editor/
COPY packages/label-kit/ ./packages/label-kit/
RUN cd packages/note-format && npm ci
RUN cd packages/note-editor && npm ci
RUN cd packages/label-kit && npm ci

# 프런트엔드 의존성 파일 복사 및 설치
COPY frontend/package*.json ./frontend/
WORKDIR /app/frontend
RUN npm ci

# 프런트엔드 소스 코드 복사 및 프로덕션 빌드
COPY frontend/ ./
RUN npm run build

# ==========================================
# 2단계: 백엔드 런타임 이미지
# ==========================================
FROM node:24-bookworm-slim AS runner
WORKDIR /app

ENV NODE_ENV=production \
    PORT=5000 \
    HOST=0.0.0.0 \
    DATA_DIR=/app/backend/data \
    MONGOMS_DISABLE_POSTINSTALL=1

# RFC 3161 CMS 서명 검증 및 암호 연동용 openssl 바이너리 설치
RUN apt-get update && \
    apt-get install -y --no-install-recommends openssl && \
    rm -rf /var/lib/apt/lists/*

# 백엔드가 참조하는 공유 패키지만 복사 (note-format, search-index, label-kit, ai-core)
COPY packages/note-format/ ./packages/note-format/
COPY packages/search-index/ ./packages/search-index/
COPY packages/ai-core/ ./packages/ai-core/
COPY packages/label-kit/ ./packages/label-kit/
RUN cd packages/note-format && npm ci --omit=dev
RUN cd packages/search-index && npm ci --omit=dev
RUN cd packages/ai-core && npm ci --omit=dev
RUN cd packages/label-kit && npm ci --omit=dev

# 백엔드 프로덕션 의존성 설치
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev && npm cache clean --force

# 백엔드 소스 코드 복사
COPY backend/ ./backend/

# 프런트엔드 빌드 결과물 복사
# backend/app.js에서 path.resolve(root, '../frontend/dist')로 서빙
COPY --from=frontend-builder --chown=node:node /app/frontend/dist /app/frontend/dist

# 데이터, 업로드, 봉인 PDF, 키 디렉토리 생성 및 권한 설정
RUN mkdir -p /app/backend/data/uploads /app/backend/data/seals /app/backend/data/keys && \
    chown -R node:node /app

# 비 root 사용자로 실행
USER node

WORKDIR /app/backend

# 헬스체크 (/api/health 기반, Node 24 내장 fetch 활용)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/api/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

EXPOSE 5000

CMD ["node", "server.js"]
