const morgan = require('morgan');
const logger = require('../utils/logger');

// Custom Morgan format
const morganFormat = ':remote-addr - :remote-user [:date[clf]] ":method :url HTTP/:http-version" :status :res[content-length] ":referrer" ":user-agent" - :response-time ms';

// Morgan middleware สำหรับ HTTP request logging
const httpLogger = morgan(morganFormat, {
    stream: logger.stream,
    skip: (req, res) => {
        // Skip logging สำหรับ health check
        return req.originalUrl === '/health';
    }
});

// Custom logging middleware สำหรับ request/response details
const requestLogger = (req, res, next) => {
    const start = Date.now();
    
    // Log request
    logger.info('Incoming Request', {
        method: req.method,
        url: req.originalUrl,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        contentType: req.get('Content-Type'),
        bodySize: req.get('Content-Length'),
        timestamp: new Date().toISOString()
    });

    // Capture response
    const originalSend = res.send;
    res.send = function(data) {
        const duration = Date.now() - start;
        
        // Log response
        logger.info('Outgoing Response', {
            method: req.method,
            url: req.originalUrl,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            contentType: res.get('Content-Type'),
            responseSize: data ? data.length : 0,
            timestamp: new Date().toISOString()
        });

        originalSend.call(this, data);
    };

    next();
};

// Error logging middleware
const errorLogger = (err, req, res, next) => {
    logger.error('Error occurred', {
        error: {
            message: err.message,
            stack: err.stack,
            name: err.name
        },
        request: {
            method: req.method,
            url: req.originalUrl,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            body: req.body
        },
        timestamp: new Date().toISOString()
    });

    next(err);
};

// LINE webhook specific logger
const lineWebhookLogger = (req, res, next) => {
    if (req.originalUrl === '/callback') {
        logger.info('LINE Webhook Event', {
            events: req.body.events,
            signature: req.headers['x-line-signature'],
            timestamp: new Date().toISOString()
        });
    }
    next();
};

// API endpoint specific logger
const apiLogger = (endpoint) => {
    return (req, res, next) => {
        logger.info(`${endpoint} API Call`, {
            endpoint,
            method: req.method,
            body: req.body,
            query: req.query,
            params: req.params,
            ip: req.ip,
            timestamp: new Date().toISOString()
        });
        next();
    };
};

module.exports = {
    httpLogger,
    requestLogger,
    errorLogger,
    lineWebhookLogger,
    apiLogger
};
