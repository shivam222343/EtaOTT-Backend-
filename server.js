import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server } from 'socket.io';

// Import configurations
import { connectMongoDB } from './config/mongo.config.js';
import { connectRedis } from './config/redis.config.js';
import { connectNeo4j, initializeGraphSchema } from './config/neo4j.config.js';
import { initQdrant } from './config/qdrant.config.js';

// Import middleware
import { errorHandler } from './middleware/error.middleware.js';

// Import routes
import authRoutes from './routes/auth.routes.js';
import institutionRoutes from './routes/institution.routes.js';
import branchRoutes from './routes/branch.routes.js';
import courseRoutes from './routes/course.routes.js';
import contentRoutes from './routes/content.routes.js';
import doubtRoutes from './routes/doubt.routes.js';
import analyticsRoutes from './routes/analytics.routes.js';
import aiUtilityRoutes from './routes/ai.routes.js';
import youtubeRoutes from './routes/youtube.routes.js';

// Import WebSocket service
import { initializeWebSocket } from './services/websocket.service.js';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
        credentials: true
    }
});

// Middleware
app.use(helmet({
    crossOriginOpenerPolicy: { policy: "unsafe-none" },
    crossOriginResourcePolicy: { policy: "cross-origin" },
    crossOriginEmbedderPolicy: false,
    contentSecurityPolicy: false
}));
app.use(morgan('dev'));
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:5173'],
    credentials: true
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Rate limiting (disabled in development)
if (process.env.NODE_ENV === 'production') {
    const limiter = rateLimit({
        windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000, // 15 minutes
        max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
        message: 'Too many requests from this IP, please try again later.'
    });
    app.use('/api/', limiter);
} else {
    console.log('⚠️  Rate limiting disabled in development mode');
}


// Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'Eta Backend'
    });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/institutions', institutionRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/doubts', doubtRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/ai', aiUtilityRoutes);
app.use('/api/youtube', youtubeRoutes);

// Error handling middleware (must be last)
app.use(errorHandler);

// Initialize databases and start server
const PORT = process.env.PORT || 5000;

async function startServer() {
    try {
        // Connect to databases
        console.log('🔌 Connecting to databases...');
        await connectMongoDB();
        await connectRedis();
        await connectNeo4j();
        await initializeGraphSchema();
        await initQdrant();

        // Initialize WebSocket
        initializeWebSocket(io);

        // Start server
        httpServer.listen(PORT, () => {
            console.log(`🚀 Server running on port ${PORT}`);
            console.log(`📡 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🌐 CORS enabled for: ${process.env.ALLOWED_ORIGINS}`);
        });
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully...');
    httpServer.close(() => {
        console.log('Server closed');
        process.exit(0);
    });
});

startServer();

export { io };
