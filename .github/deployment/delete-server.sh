#!/bin/bash
# ====================================================
# delete-server.sh
# Удаляет игровые серверы TANK BATTLE.
# ====================================================

echo "=================================================="
echo "           🗑️ УДАЛЕНИЕ СЕРВЕРА TANK BATTLE               "
echo "=================================================="

# Папка, где находятся игровые проекты
PROJECTS_ROOT="$HOME/vimp_projects"

# ----------------------------------------------------
# 1. Поиск существующих серверов TANK BATTLE
# ----------------------------------------------------
# Логика: берём конфиги Nginx и проверяем, есть ли для них папки проектов.
RAW_SITES=$(ls /etc/nginx/sites-enabled/ | grep -v "default")
TANK_BATTLE_SITES=""

for site in $RAW_SITES; do
  if [ -d "$PROJECTS_ROOT/$site" ]; then
    TANK_BATTLE_SITES="$TANK_BATTLE_SITES $site"
  fi
done

# Если серверов нет
if [ -z "$TANK_BATTLE_SITES" ]; then
  echo "❌ Игровых серверов TANK BATTLE не найдено."
  echo "   (Проверено: конфиги Nginx + наличие папок в $PROJECTS_ROOT)"
  exit 0
fi

# ----------------------------------------------------
# 2. Меню выбора сервера
# ----------------------------------------------------
PS3="👉 Выберите сервер для УДАЛЕНИЯ (введите номер): "
select DOMAIN in $TANK_BATTLE_SITES "Отмена"; do
  if [[ "$DOMAIN" == "Отмена" ]]; then
    echo "Действие отменено."
    exit 0

  elif [[ -n "$DOMAIN" ]]; then
    echo ""
    echo "🚨 ВНИМАНИЕ! Вы собираетесь удалить сервер TANK BATTLE: $DOMAIN"
    echo "   Будет выполнено удаление:"
    echo "   - Конфига Nginx  (/etc/nginx/sites-enabled/$DOMAIN)"
    echo "   - SSL-сертификатов (через Certbot)"
    echo "   - Docker-контейнера (tank-battle-$DOMAIN)"
    echo "   - Папки проекта ($PROJECTS_ROOT/$DOMAIN)"
    echo ""
    read -p "Для подтверждения введите 'yes': " CONFIRM

    if [[ "$CONFIRM" == "yes" ]]; then
      break
    else
      echo "❌ Удаление отменено."
      exit 0
    fi

  else
    echo "Неверный выбор. Попробуйте снова."
  fi
done

echo ""
echo "🔥 Удаление сервера: $DOMAIN..."

# ----------------------------------------------------
# 1. Docker
# ----------------------------------------------------
CONTAINER_NAME="tank-battle-$DOMAIN"
echo "🐳 Остановка Docker-контейнера: $CONTAINER_NAME..."
docker stop "$CONTAINER_NAME" 2>/dev/null || true
docker rm "$CONTAINER_NAME" 2>/dev/null || true

# ----------------------------------------------------
# 2. Папка проекта
# ----------------------------------------------------
TARGET_DIR="$PROJECTS_ROOT/$DOMAIN"
if [ -d "$TARGET_DIR" ]; then
  echo "📂 Удаление папки проекта: $TARGET_DIR..."
  rm -rf "$TARGET_DIR"
fi

# ----------------------------------------------------
# 3. Конфиги Nginx
# ----------------------------------------------------
echo "🌐 Удаление конфигураций Nginx..."
sudo rm -f /etc/nginx/sites-enabled/$DOMAIN
sudo rm -f /etc/nginx/sites-available/$DOMAIN

# ----------------------------------------------------
# 4. SSL сертификаты
# ----------------------------------------------------
echo "🔐 Удаление SSL-сертификатов..."
sudo certbot delete --cert-name "$DOMAIN" --non-interactive 2>/dev/null \
  || echo "   ⚠️  Certbot: сертификат не найден или уже удалён."

# ----------------------------------------------------
# 5. Перезагрузка Nginx
# ----------------------------------------------------
echo "🔄 Перезагрузка Nginx..."
if sudo nginx -t; then
  sudo systemctl reload nginx
  echo "✅ ГОТОВО! Сервер $DOMAIN успешно удалён."
  echo "👉 Не забудьте удалить его конфигурацию из переменной SERVERS_MATRIX"
  echo "   в настройках репозитория GitHub (Settings -> Secrets and variables)!"
else
  echo "❌ Ошибка: некорректная конфигурация Nginx."
  sudo nginx -t
fi
