#!/bin/bash
set -eo pipefail

KEYFILE="/data/configdb/keyfile"

# 1. Replica set 내부 통신용 Keyfile 준비 (없는 경우 신규 생성 및 권한 부여)
if [ ! -f "$KEYFILE" ]; then
    echo "[mongo-init] Generating keyfile at $KEYFILE..."
    mkdir -p /data/configdb
    openssl rand -base64 756 > "$KEYFILE"
    chmod 400 "$KEYFILE"
    chown mongodb:mongodb "$KEYFILE"
fi

# 2. 백그라운드에서 Replica set 및 사용자 계정 초기화 실행
(
    echo "[mongo-init] Waiting for mongod to accept local connections..."
    until mongosh --port 27017 --quiet --eval "db.adminCommand('ping')" >/dev/null 2>&1; do
        sleep 1
    done

    echo "[mongo-init] Checking replica set initialization status..."
    # db.hello()는 무인증 상태에서도 호출 가능
    mongosh --port 27017 --quiet <<'EOF'
    try {
        var hello = db.hello();
        if (!hello.setName || !hello.isWritablePrimary) {
            console.log("[mongo-init] Initiating replica set rs0...");
            rs.initiate({ _id: "rs0", members: [{ _id: 0, host: "mongo:27017" }] });
        } else {
            console.log("[mongo-init] Replica set rs0 already initialized and writable.");
        }
    } catch (e) {
        if (e.code === 23 || e.codeName === "AlreadyInitialized") {
            console.log("[mongo-init] Replica set already initialized.");
        } else {
            console.log("[mongo-init] rs.initiate note:", e.message);
        }
    }
EOF

    echo "[mongo-init] Waiting for replica set primary election..."
    until mongosh --port 27017 --quiet --eval "Boolean(db.hello().isWritablePrimary)" 2>/dev/null | grep -q 'true'; do
        sleep 1
    done

    # 3. 루트 사용자 생성 또는 인증 확인 (재시작 시 이미 auth가 켜져 있어도 정상 처리)
    if [ -n "$MONGO_ROOT_USERNAME" ] && [ -n "$MONGO_ROOT_PASSWORD" ]; then
        echo "[mongo-init] Verifying or configuring root user..."
        mongosh --port 27017 --quiet <<EOF
        var adminDb = db.getSiblingDB("admin");
        var authed = false;
        try {
            authed = adminDb.auth("${MONGO_ROOT_USERNAME}", "${MONGO_ROOT_PASSWORD}");
        } catch (e) {
            authed = false;
        }
        if (authed) {
            console.log("[mongo-init] Root user already authenticated.");
        } else {
            try {
                adminDb.createUser({
                    user: "${MONGO_ROOT_USERNAME}",
                    pwd: "${MONGO_ROOT_PASSWORD}",
                    roles: [{ role: "root", db: "admin" }]
                });
                console.log("[mongo-init] Root user created successfully.");
            } catch (err) {
                if (err.code === 51003 || err.codeName === "UserAlreadyExists") {
                    console.log("[mongo-init] Root user already exists.");
                } else {
                    console.error("[mongo-init] Root user creation failed:", err.message);
                }
            }
        }
EOF
    fi

    # 4. 애플리케이션 사용자 생성 (root 인증 후 확인)
    if [ -n "$MONGO_APP_USERNAME" ] && [ -n "$MONGO_APP_PASSWORD" ]; then
        echo "[mongo-init] Verifying or configuring app user..."
        mongosh --port 27017 -u "$MONGO_ROOT_USERNAME" -p "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin --quiet <<EOF
        var targetDbName = "${DB_NAME:-labhub}";
        var appDb = db.getSiblingDB(targetDbName);
        var existingUser = appDb.getUser("${MONGO_APP_USERNAME}");
        if (!existingUser) {
            console.log("[mongo-init] Creating app user: ${MONGO_APP_USERNAME}");
            appDb.createUser({
                user: "${MONGO_APP_USERNAME}",
                pwd: "${MONGO_APP_PASSWORD}",
                roles: [{ role: "readWrite", db: targetDbName }]
            });
            console.log("[mongo-init] App user created successfully.");
        } else {
            console.log("[mongo-init] App user already exists.");
        }
EOF
    fi

    echo "[mongo-init] Replica set and user initialization completed successfully."
) &

# 5. 공식 MongoDB 엔트리포인트를 통해 mongod 실행
exec docker-entrypoint.sh mongod --replSet rs0 --keyFile "$KEYFILE" --bind_ip_all
