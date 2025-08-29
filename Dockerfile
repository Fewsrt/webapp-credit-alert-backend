# ใช้ Node.js 18 Alpine เป็น base image
FROM node:18-alpine

# ตั้งค่า working directory
WORKDIR /usr/src/app

# คัดลอก package.json และ package-lock.json
COPY package*.json ./

# ติดตั้ง dependencies
RUN npm ci --only=production

# คัดลอกไฟล์ source code
COPY . .

# สร้าง user ที่ไม่ใช่ root เพื่อความปลอดภัย
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodeuser -u 1001

# เปลี่ยน ownership ของไฟล์ให้กับ nodeuser
RUN chown -R nodeuser:nodejs /usr/src/app
USER nodeuser

# เปิด port 4001
EXPOSE 4001

# ตั้งค่า environment variables
ENV NODE_ENV=production
ENV PORT=4001

# ตั้งค่า health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node healthcheck.js

# รัน application
CMD ["node", "app.js"]
