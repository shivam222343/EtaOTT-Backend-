import jwt from 'jsonwebtoken';
import { verifyFirebaseToken } from '../config/firebase.config.js';

export async function authenticate(req, res, next) {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                success: false,
                message: 'No token provided'
            });
        }

        const token = authHeader.split(' ')[1]?.trim();

        if (!token || token === 'null' || token === 'undefined') {
            return res.status(401).json({
                success: false,
                message: 'Invalid token provided'
            });
        }

        // Try Firebase token first
        try {
            const decodedToken = await verifyFirebaseToken(token);
            req.user = {
                firebaseUid: decodedToken.uid,
                email: decodedToken.email
            };
            return next();
        } catch (firebaseError) {
            // If Firebase fails, try JWT
            try {
                const decoded = jwt.verify(token, process.env.JWT_SECRET);
                req.user = decoded;
                return next();
            } catch (jwtError) {
                return res.status(401).json({
                    success: false,
                    message: 'Invalid or expired token'
                });
            }
        }
    } catch (error) {
        console.error('Authentication error:', error);
        return res.status(500).json({
            success: false,
            message: 'Authentication failed'
        });
    }
}

// Middleware to attach user from database
export async function attachUser(req, res, next) {
    try {
        const User = (await import('../models/User.model.js')).default;
        const user = await User.findOne({
            firebaseUid: req.user.firebaseUid
        }).select('-__v');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        req.dbUser = user;
        next();
    } catch (error) {
        console.error('Attach user error:', error);
        return res.status(500).json({
            success: false,
            message: 'Failed to fetch user data'
        });
    }
}
