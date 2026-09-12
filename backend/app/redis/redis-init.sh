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
# Session persistence: append every write to disk within ~1s so a restart
# (compose recreate, docker daemon hiccup) cannot silently log users out —
# the RDB policy above only snapshots after 15 min, so a fresh login would
# otherwise be lost if Redis restarts shortly after.
appendonly yes
appendfsync everysec
rdbcompression yes
dbfilename dump.rdb
dir /data
maxmemory 256mb
maxmemory-policy allkeys-lru
EOF

  echo "🚀 Starting Redis with authentication..."

  # Use requirepass instead of ACL (simpler, works in Redis 7)
  exec redis-server /tmp/redis.conf --requirepass "${REDIS_PASSWORD}" "$@"
else
  echo "⚠️  No Redis password set, starting without auth (NOT recommended for production)"
  exec redis-server "$@"
fi
