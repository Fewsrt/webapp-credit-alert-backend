# LINE Bot Backend

## การตั้งค่า Environment Variables

### 1. สร้างไฟล์ .env
```bash
cp env.example .env
```

### 2. แก้ไขไฟล์ .env
เปิดไฟล์ `.env` และแก้ไขค่าต่อไปนี้:

```env
# LINE Bot Configuration (จำเป็น)
CHANNEL_ACCESS_TOKEN=your_actual_line_channel_access_token
CHANNEL_SECRET=your_actual_line_channel_secret

# Firebase Configuration (ตรวจสอบให้ถูกต้อง)
FIREBASE_API_KEY=your_firebase_api_key
FIREBASE_AUTH_DOMAIN=your_firebase_auth_domain
FIREBASE_DATABASE_URL=your_firebase_database_url
FIREBASE_PROJECT_ID=your_firebase_project_id
FIREBASE_STORAGE_BUCKET=your_firebase_storage_bucket
FIREBASE_MESSAGING_SENDER_ID=your_firebase_messaging_sender_id
FIREBASE_APP_ID=your_firebase_app_id
FIREBASE_MEASUREMENT_ID=your_firebase_measurement_id

# Server Configuration
PORT=4001
NODE_ENV=development
```

## การรัน

### 1. Development (Local)
```bash
npm install
npm start
# หรือ
node app.js
```

### 2. Production (Docker)
```bash
# Build และรัน
docker-compose up -d

# ดู logs
docker-compose logs -f

# หยุดการทำงาน
docker-compose down
```

## API Endpoints

- `GET /health` - Health check
- `POST /callback` - LINE Webhook
- `POST /send-flex-message` - ส่ง Flex Message

## Health Check
```bash
curl http://localhost:4001/health
```

## ตัวอย่างการส่ง Flex Message
```bash
curl -X POST http://localhost:4001/send-flex-message \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "YOUR_LINE_USER_ID",
    "statementMonth": "2025-08",
    "transactionData": [
      {
        "transaction": "ทดสอบ",
        "amount": 1000
      }
    ]
  }'
```
