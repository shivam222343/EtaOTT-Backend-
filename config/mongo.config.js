import mongoose from 'mongoose';

let isConnected = false;

export async function connectMongoDB() {
    if (isConnected) {
        console.log('✅ MongoDB already connected');
        return;
    }

    const maxRetries = 5;
    let retries = 0;

    while (retries < maxRetries) {
        try {
            const conn = await mongoose.connect(process.env.MONGODB_URI, {
                serverSelectionTimeoutMS: 5000,
                socketTimeoutMS: 45000,
            });

            isConnected = true;
            console.log(`✅ MongoDB Connected: ${conn.connection.host}`);

            // Handle connection events
            mongoose.connection.on('error', (err) => {
                console.error('❌ MongoDB connection error:', err);
                isConnected = false;
            });

            mongoose.connection.on('disconnected', () => {
                console.warn('⚠️  MongoDB disconnected');
                isConnected = false;
            });

            return conn;
        } catch (error) {
            retries++;
            console.error(`❌ MongoDB connection attempt ${retries}/${maxRetries} failed:`, error.message);

            if (retries === maxRetries) {
                throw new Error('Failed to connect to MongoDB after maximum retries');
            }

            // Wait before retrying (exponential backoff)
            await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, retries), 10000)));
        }
    }
}

export function getMongoConnection() {
    return mongoose.connection;
}
