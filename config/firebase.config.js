import dotenv from 'dotenv';
import admin from 'firebase-admin';

// Load environment variables
dotenv.config();

// Validate required environment variables
if (!process.env.FIREBASE_PROJECT_ID) {
    throw new Error('FIREBASE_PROJECT_ID is not defined in .env file');
}
if (!process.env.FIREBASE_PRIVATE_KEY) {
    throw new Error('FIREBASE_PRIVATE_KEY is not defined in .env file');
}
if (!process.env.FIREBASE_CLIENT_EMAIL) {
    throw new Error('FIREBASE_CLIENT_EMAIL is not defined in .env file');
}

// Initialize Firebase Admin SDK
const serviceAccount = {
    type: 'service_account',
    project_id: process.env.FIREBASE_PROJECT_ID,
    private_key: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    client_email: process.env.FIREBASE_CLIENT_EMAIL
};

console.log('Firebase Admin Initializing with Project ID:', serviceAccount.project_id);
console.log('Client Email:', serviceAccount.client_email);
console.log('Private Key present:', !!serviceAccount.private_key);

try {
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin initialized successfully');
} catch (error) {
    console.error('Firebase Admin initialization error:', error);
}

export const auth = admin.auth();
export default admin;

// Helper function to verify Firebase token
export async function verifyFirebaseToken(token) {
    try {
        if (!token) {
            throw new Error('No Firebase token provided');
        }
        return await auth.verifyIdToken(token);
    } catch (error) {
        // We catch this error in the middleware and try JWT fallback, 
        // so we don't log it here to avoid spamming the console.
        throw error;
    }
}
