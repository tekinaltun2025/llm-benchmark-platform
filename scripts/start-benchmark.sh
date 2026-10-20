#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# LLM Benchmark Platform — Masaüstü Başlatıcı
# Uygulama çalışmıyorsa dev server'ı arka planda başlatır ve
# tarayıcıyı http://localhost:3000 adresine açar.
# ═══════════════════════════════════════════════════════════════════
set -u

PORT=3000
URL="http://localhost:${PORT}"
PROJECT_DIR="/home/tekinaltun/Documents/LLM_Benchmark"
LOG_FILE="${PROJECT_DIR}/dev-server.log"

# Uygulama zaten çalışıyor mu? Çalışıyorsa sadece tarayıcıyı aç.
if curl -s -o /dev/null --max-time 2 "${URL}"; then
  echo "Uygulama zaten çalışıyor — tarayıcı açılıyor..."
  xdg-open "${URL}" >/dev/null 2>&1 &
  exit 0
fi

# Bağımlılıklar kurulu değilse kur.
if [ ! -d "${PROJECT_DIR}/node_modules" ]; then
  echo "Bağımlılıklar kuruluyor..."
  npm --prefix "${PROJECT_DIR}" install >/dev/null 2>&1
fi

# Dev server'ı arka planda başlat.
cd "${PROJECT_DIR}" || exit 1
nohup npm run dev > "${LOG_FILE}" 2>&1 &
SERVER_PID=$!
echo "Dev server başlatıldı (PID: ${SERVER_PID}) — hazır olması bekleniyor..."

# Sunucunun hazır olmasını bekle (maksimum 90 saniye).
for _ in $(seq 1 90); do
  if curl -s -o /dev/null --max-time 2 "${URL}"; then
    echo "Sunucu hazır — tarayıcı açılıyor..."
    xdg-open "${URL}" >/dev/null 2>&1 &
    exit 0
  fi
  sleep 1
done

echo "HATA: Sunucu 90 saniyede hazır olmadı. Log dosyası: ${LOG_FILE}"
exit 1
