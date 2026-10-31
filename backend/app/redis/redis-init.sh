#!/bin/sh
# =============================================================================
# redis init script
# REDIS_PASSWORD now arrives directly via compose's env_file (root .env)
# instead of a mounted secret file.
# =============================================================================

echo "🔧 Configuring Redis..."

if [ -n "$REDIS_PASSWORD" ]; then
  cat > /tmp/redis.conf <<EOF
bind 0.0.0.0
port 6479
timeout 0
save 900 1
save 300 10
save 60 10000
rdbcompression yes
dbfilename dump.rdb
dir /data
# Sessions, presence, match/game state and the notification bell must survive a
# container restart, so the append-only file is on. RDB saves stay: cold restore.
appendonly yes
appendfsync everysec
aof-use-rdb-preamble yes
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
maxmemory 256mb
maxmemory-policy allkeys-lru
# Keyevent + expired notifications: MailService
# (backend/src/auth/mail.service.ts) subscribes to __keyevent@0__:expired to
# email the "your email change lapsed" notice. 'Ex' is the minimum needed;
# it keeps pub/sub overhead negligible (Redis reports the flags reordered, as "xE").
notify-keyspace-events Ex
EOF

  echo "🚀 Starting Redis with authentication..."

  # Use requirepass instead of ACL (simpler, works in Redis 7)
  exec redis-server /tmp/redis.conf --requirepass "${REDIS_PASSWORD}" --notify-keyspace-events Ex "$@"
else
  echo "⚠️  No Redis password set, starting without auth (NOT recommended for production)"
  exec redis-server --notify-keyspace-events Ex "$@"
fi
