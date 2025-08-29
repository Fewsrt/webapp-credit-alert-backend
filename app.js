require('dotenv').config();

const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const logger = require('./utils/logger');
const { httpLogger, requestLogger, errorLogger, lineWebhookLogger, apiLogger } = require('./middleware/logger');
const { db } = require('./utils/firebase');
const { addDoc, collection, setDoc, doc, getDoc } = require('firebase/firestore');
const line = require('@line/bot-sdk');
const crypto = require('crypto');
const generatePayload = require('promptpay-qr');
const QRCode = require('qrcode');
const { getStorage, ref, uploadString, getDownloadURL } = require('firebase/storage');
const storage = getStorage();

const app = express();
const PORT = process.env.PORT || 4001;

// ตั้งค่า LINE SDK config จาก environment variables
const config = {
    channelSecret: process.env.CHANNEL_SECRET,
};

// สร้างไคลเอนต์ของ LINE SDK ด้วย MessagingApiClient
const client = new line.messagingApi.MessagingApiClient({
    channelAccessToken: process.env.CHANNEL_ACCESS_TOKEN,
});

// Logging middleware
app.use(httpLogger);
app.use(requestLogger);

app.use(bodyParser.json());
app.use(cors());

// LINE webhook specific logging
app.use(lineWebhookLogger);

// Health check endpoint สำหรับ Docker
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        port: PORT 
    });
});

// ฟังก์ชันตรวจสอบ signature
function validateSignature(req) {
    const channelSecret = config.channelSecret;
    const body = JSON.stringify(req.body);
    const signature = crypto
        .createHmac('SHA256', channelSecret)
        .update(body)
        .digest('base64');

    // ตรวจสอบ signature
    const headerSignature = req.headers['x-line-signature'];
    return signature === headerSignature;
}

// ฟังก์ชันดึงโปรไฟล์ผู้ใช้จาก LINE SDK
async function getUserProfile(userId) {
    try {
        const profile = await client.getProfile(userId);
        return { userId: profile.userId, displayName: profile.displayName, status: 'active' }; // บันทึกสถานะ active
    } catch (error) {
        if (error.response && error.response.status === 403) {
            // ผู้ใช้บล็อกหรือยกเลิกเป็นเพื่อน
            return { userId, status: 'blocked' };
        } else {
            console.error('Error getting user profile:', error);
            return null;
        }
    }
}

// Webhook สำหรับรับ event จาก LINE
app.post('/callback', apiLogger('LINE Callback'), async (req, res) => {
    if (!validateSignature(req)) {
        logger.warn('LINE Webhook signature validation failed', {
            signature: req.headers['x-line-signature'],
            ip: req.ip
        });
        return res.status(401).send('Unauthorized request: Signature validation failed');
    }

    const events = req.body.events;
    for (let event of events) {
        if (event.type === 'follow' || event.type === 'message') {
            const userId = event.source.userId;

            // ดึงข้อมูลผู้ใช้จาก Firebase เพื่อตรวจสอบว่าบันทึกแล้วหรือยัง
            const userDocRef = doc(db, 'line_users', userId);
            const userDocSnap = await getDoc(userDocRef);

            if (!userDocSnap.exists()) {
                // ผู้ใช้ยังไม่ถูกบันทึก บันทึกครั้งแรก
                const userProfile = await getUserProfile(userId);

                if (userProfile) {
                    try {
                        await setDoc(userDocRef, userProfile);  // บันทึกข้อมูลผู้ใช้เพียงครั้งเดียว
                        logger.info('New user registered', {
                            userId,
                            displayName: userProfile.displayName,
                            status: userProfile.status
                        });
                    } catch (error) {
                        logger.error('Error adding user profile to Firebase', {
                            userId,
                            error: error.message,
                            stack: error.stack
                        });
                    }
                }
            } else {
                // ตรวจสอบสถานะของผู้ใช้ (ยังเป็นเพื่อนหรือถูกบล็อก)
                const userProfile = await getUserProfile(userId);

                if (userProfile && userProfile.status === 'blocked') {
                    try {
                        await setDoc(userDocRef, userProfile, { merge: true }); // อัปเดตสถานะเป็น blocked
                        logger.warn('User blocked or unfriended', {
                            userId,
                            status: 'blocked'
                        });
                    } catch (error) {
                        logger.error('Error updating user profile to blocked', {
                            userId,
                            error: error.message,
                            stack: error.stack
                        });
                    }
                }
            }
        }
    }

    res.sendStatus(200);
});
// Function สำหรับอัพโหลด QR code ไปยัง Firebase Storage
async function uploadQRCodeToFirebase(qrCodeDataUrl, userId) {
    try {
        // สร้างชื่อไฟล์ที่ไม่ซ้ำกัน
        const fileName = `qrcodes/qr_${userId}_${Date.now()}.png`;
        const storageRef = ref(storage, fileName);

        // แปลง Data URL เป็นรูปแบบที่ Firebase Storage ต้องการ
        const base64Data = qrCodeDataUrl.split(',')[1];

        // อัพโหลดไฟล์
        await uploadString(storageRef, base64Data, 'base64', {
            contentType: 'image/png'
        });

        // ดึง URL สำหรับดาวน์โหลด
        const downloadURL = await getDownloadURL(storageRef);
        return downloadURL;

    } catch (error) {
        console.error('Error uploading QR code:', error);
        throw error;
    }
}

// API สำหรับบันทึกบิลใบแจ้งยอดและส่ง Flex Message
app.post('/send-flex-message', apiLogger('Send Flex Message'), async (req, res) => {
    try {
        const { userId, statementMonth, transactionData } = req.body;
        const promptPayId = "0909944974";

        const totalAmount = transactionData.reduce((sum, item) => sum + Number(item.amount), 0);

        // สร้าง QR Code และอัพโหลด
        logger.info('Generating QR Code for payment', {
            userId,
            totalAmount,
            promptPayId,
            statementMonth
        });
        
        const payload = generatePayload(promptPayId, { amount: totalAmount });
        const qrCodeDataUrl = await QRCode.toDataURL(payload);
        const qrCodeUrl = await uploadQRCodeToFirebase(qrCodeDataUrl, userId);
        
        logger.info('QR Code generated and uploaded successfully', {
            userId,
            qrCodeUrl: qrCodeUrl.substring(0, 50) + '...' // แค่ส่วนแรกของ URL
        });

        // สร้าง Flex Messages แยกเป็น 2 ส่วน
        const qrCodeFlex = {
            type: 'flex',
            altText: 'QR Code PromptPay',
            contents: {
                type: 'bubble',
                body: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                        {
                            type: 'image',
                            url: qrCodeUrl,
                            size: 'full',
                            aspectMode: 'cover',
                            aspectRatio: '1:1',
                            gravity: 'center'
                        }
                    ],
                    paddingAll: '0px'
                }
            }
        };

        // สร้างรายการธุรกรรมสำหรับ Flex Message
        const transactionItems = transactionData.map(item => ({
            type: 'box',
            layout: 'horizontal',
            contents: [
                {
                    type: 'text',
                    text: item.transaction,
                    size: 'sm',
                    color: '#555555',
                    flex: 0,
                },
                {
                    type: 'text',
                    text: `${item.amount} บาท`,
                    size: 'sm',
                    color: '#111111',
                    align: 'end',
                },
            ],
        }));

        // สร้าง Flex Message
        const flexMessage = {
            type: 'flex',
            altText: `บิลใบแจ้งยอดประจำเดือน ${statementMonth}`,
            contents: {
                type: 'bubble',
                body: {
                    type: 'box',
                    layout: 'vertical',
                    contents: [
                        {
                            type: 'text',
                            text: 'บิลค่าใช้จ่าย',
                            weight: 'bold',
                            color: '#1DB446',
                            size: 'lg',
                        },
                        {
                            type: 'text',
                            text: `ยอด : ${totalAmount.toFixed(2)} บาท`,
                            weight: 'bold',
                            size: 'xxl',
                            margin: 'md',
                        },
                        {
                            type: 'text',
                            text: `ประจำเดือน ${statementMonth}`,
                            size: 'md',
                            color: '#aaaaaa',
                            wrap: true,
                        },
                        {
                            type: 'separator',
                            margin: 'xxl',
                        },
                        {
                            type: 'box',
                            layout: 'vertical',
                            margin: 'xxl',
                            spacing: 'sm',
                            contents: transactionItems,
                        },
                        {
                            type: 'separator',
                            margin: 'xxl',
                        },
                        {
                            type: 'box',
                            layout: 'horizontal',
                            contents: [
                                {
                                    type: 'text',
                                    text: 'รวม',
                                    size: 'sm',
                                    color: '#555555',
                                },
                                {
                                    type: 'text',
                                    text: `${totalAmount.toFixed(2)} บาท`,
                                    size: 'sm',
                                    color: '#111111',
                                    align: 'end',
                                },
                            ],
                        },
                        {
                            type: 'separator',
                            margin: 'xxl',
                        },
                        {
                            type: 'box',
                            layout: 'horizontal',
                            margin: 'md',
                            contents: [
                                {
                                    type: 'text',
                                    text: 'PAYMENT ID',
                                    size: 'xs',
                                    color: '#aaaaaa',
                                    flex: 0,
                                },
                                {
                                    type: 'text',
                                    text: `#${Math.floor(Math.random() * 10000000000)}`, // สร้าง PAYMENT ID แบบสุ่ม
                                    color: '#aaaaaa',
                                    size: 'xs',
                                    align: 'end',
                                },
                            ],
                        },
                    ],
                },
                styles: {
                    footer: {
                        separator: true,
                    },
                },
            },
        };

        // ส่งทั้ง 2 messages โดยใช้ multicast
        const request1 = {
            to: [userId],
            messages: [qrCodeFlex],
            retryKey: crypto.randomUUID()
        };
        
        const request2 = {
            to: [userId],
            messages: [flexMessage],
            retryKey: crypto.randomUUID()
        };
        
        await client.multicast(request1);
        await client.multicast(request2);
        
        logger.info('Flex messages sent successfully', {
            userId,
            totalAmount,
            messageCount: 2,
            paymentId: `#${Math.floor(Math.random() * 10000000000)}`
        });


        // บันทึกข้อมูล
        await addDoc(collection(db, 'credit_card_transactions'), {
            userId,
            statementMonth,
            transactionData,
            totalAmount,
            qrCodeUrl,
            promptPayId,
            createdAt: new Date()
        });
        
        logger.info('Transaction data saved to Firebase', {
            userId,
            statementMonth,
            totalAmount,
            transactionCount: transactionData.length
        });

        res.status(200).send('ส่งข้อความและบันทึกข้อมูลสำเร็จ');

    } catch (error) {
        logger.error('Error in send-flex-message API', {
            error: error.message,
            stack: error.stack,
            userId: req.body.userId,
            statementMonth: req.body.statementMonth
        });
        res.status(500).send('เกิดข้อผิดพลาด');
    }
});

// เพิ่ม Cleanup function สำหรับลบ QR codes เก่า (optional)
async function cleanupOldQRCodes() {
    try {
        const qrcodesRef = ref(storage, 'qrcodes');
        const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

        // ดึงรายการไฟล์ทั้งหมดใน qrcodes folder
        const fileList = await listAll(qrcodesRef);

        for (const item of fileList.items) {
            const metadata = await getMetadata(item);
            if (metadata.timeCreated < oneWeekAgo) {
                await deleteObject(item);
                console.log(`Deleted old QR code: ${item.name}`);
            }
        }
        logger.info('QR codes cleanup completed');
    } catch (error) {
        logger.error('Error cleaning up QR codes', {
            error: error.message,
            stack: error.stack
        });
    }
}

// รัน cleanup ทุก 24 ชั่วโมง
setInterval(cleanupOldQRCodes, 24 * 60 * 60 * 1000);

// Error handling middleware (ต้องอยู่หลังสุด)
app.use(errorLogger);

// Global error handler
app.use((err, req, res, next) => {
    logger.error('Unhandled error', {
        error: err.message,
        stack: err.stack,
        url: req.originalUrl,
        method: req.method
    });
    
    res.status(500).json({
        error: 'Internal Server Error',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
    });
});

// เริ่มเซิร์ฟเวอร์
app.listen(PORT, () => {
    logger.info('Server started successfully', {
        port: PORT,
        environment: process.env.NODE_ENV,
        timestamp: new Date().toISOString()
    });
});
