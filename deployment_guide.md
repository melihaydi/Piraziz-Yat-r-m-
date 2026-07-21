# BIP Monorepo Production Deployment Guide

Bu rehber, BIST Intelligence Platform (BIP) uygulamasının bir Linux VPS (Ubuntu 22.04+) sunucusu üzerinde Docker Compose ve Nginx Reverse Proxy kullanılarak canlı ortama (production) nasıl kurulacağını açıklar.

---

## 1. Sunucu Hazırlığı ve Docker Kurulumu

Sunucunuzda paketleri güncelleyin ve Docker ile Docker Compose eklentisini kurun:

```bash
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git nginx certbot python3-certbot-nginx

# Docker Kurulumu
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Mevcut kullanıcının Docker grubuna eklenmesi (opsiyonel)
sudo usermod -aG docker $USER
newgrp docker
```

---

## 2. Proje Kurulumu ve Çevre Değişkenleri (.env)

Projeyi sunucuya klonlayın ve `.env` dosyasını oluşturun:

```bash
git clone <PROJE_DEPO_LINKI> bip-platform
cd bip-platform
cp .env.example .env
nano .env
```

### Production İçin Kritik Parametreler
Production ortamında şifrelerin, anahtarların ve debug modlarının güncellendiğinden emin olun:
```ini
# Database & Cache
DATABASE_URL=postgresql://bip_prod_user:SECURE_RANDOM_PASSWORD@db:5432/bip_prod_db
REDIS_URL=redis://redis:6379/0

# JWT Security
SECRET_KEY=GENERATE_A_VERY_LONG_SECURE_RANDOM_JWT_SECRET_KEY
ACCESS_TOKEN_EXPIRE_MINUTES=60

# API Keys
GEMINI_API_KEY=YOUR_PRODUCTION_GOOGLE_GEMINI_API_KEY
FMP_API_KEY=YOUR_FINANCIAL_MODELING_PREP_KEY
FINNHUB_API_KEY=YOUR_FINNHUB_KEY
ALPHA_VANTAGE_API_KEY=YOUR_ALPHA_VANTAGE_KEY
```

---

## 3. Production Docker Compose Ayarı

Production ortamında uvicorn'un `--reload` parametresi kaldırılmalı ve yerel dosyaları container içerisine mount eden local volume eşleşmeleri iptal edilmelidir.

Aşağıdaki `docker-compose.prod.yml` dosyasını oluşturun:

```yaml
version: '3.8'

services:
  db:
    image: postgres:15-alpine
    container_name: bip_postgres
    restart: always
    environment:
      POSTGRES_USER: bip_prod_user
      POSTGRES_PASSWORD: SECURE_RANDOM_PASSWORD
      POSTGRES_DB: bip_prod_db
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U bip_prod_user -d bip_prod_db"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:7-alpine
    container_name: bip_redis
    restart: always
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: bip_backend
    restart: always
    # Uvicorn production modda (reload kapalı, worker sayısı ayarlı)
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
    ports:
      - "8000:8000"
    env_file:
      - .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy

  celery_worker:
    build:
      context: ./backend
      dockerfile: Dockerfile
    container_name: bip_celery_worker
    restart: always
    command: celery -A app.workers.celery_app.celery_app worker --loglevel=info
    env_file:
      - .env
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy

  frontend:
    build:
      context: ./frontend
      dockerfile: Dockerfile
    container_name: bip_frontend
    restart: always
    ports:
      - "3000:3000"
    env_file:
      - .env
    environment:
      - NEXT_TELEMETRY_DISABLED=1
    depends_on:
      - backend

volumes:
  postgres_data:
  redis_data:
```

Projeyi ayağa kaldırmak için:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

---

## 4. Nginx Reverse Proxy ve Let's Encrypt SSL Kurulumu

Domain trafiğini Docker container'larına yönlendirmek için Nginx konfigüre edin.

`/etc/nginx/sites-available/bip.conf` dosyasını oluşturun:

```nginx
server {
    listen 80;
    server_name bip-terminal.com www.bip-terminal.com; # Kendi domaininizi yazın

    # Next.js Frontend
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }

    # FastAPI Backend APIs
    location /api {
        proxy_pass http://localhost:8000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Konfigürasyonu aktif edin ve Nginx servisini test edin:
```bash
sudo ln -s /etc/nginx/sites-available/bip.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### Let's Encrypt Ücretsiz SSL Sertifikası
```bash
sudo certbot --nginx -d bip-terminal.com -d www.bip-terminal.com
```
Certbot, Nginx konfigürasyonunu otomatik olarak güncelleyip SSL sertifikası (HTTPS) tanımlayacaktır.

---

## 5. PostgreSQL Otomatik Yedekleme (Cron Job)

Veritabanını günlük olarak yedeklemek için bir cron job ayarlayın:

```bash
# Yedekleme scripti oluşturun
mkdir -p ~/backups
nano ~/backup_db.sh
```

`backup_db.sh` içeriği:
```bash
#!/bin/bash
BACKUP_DIR="/home/ubuntu/backups"
DB_CONTAINER="bip_postgres"
DB_USER="bip_prod_user"
DB_NAME="bip_prod_db"
DATE=$(date +%Y-%m-%d_%H%M%S)

docker exec -t $DB_CONTAINER pg_dump -U $DB_USER $DB_NAME > $BACKUP_DIR/backup_$DATE.sql
find $BACKUP_DIR -type f -mtime +7 -name "*.sql" -delete # 7 günden eski yedekleri sil
```

Script'i çalıştırılabilir yapın ve cron job ekleyin:
```bash
chmod +x ~/backup_db.sh
crontab -e
```

Her gece 02:00'de çalışması için crontab satırı:
```text
0 2 * * * /home/ubuntu/backup_db.sh > /dev/null 2>&1
```
