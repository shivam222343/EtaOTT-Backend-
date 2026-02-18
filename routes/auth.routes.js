import express from 'express';
import jwt from 'jsonwebtoken';
import User from '../models/User.model.js';
import { verifyFirebaseToken } from '../config/firebase.config.js';

import { authenticate, attachUser } from '../middleware/auth.middleware.js';
import upload from '../services/upload.service.js';

const router = express.Router();

// Signup
router.post('/signup', async (req, res) => {
    try {
        const { firebaseUid, email, role, name } = req.body;

        // Check if user already exists
        const existingUser = await User.findOne({ $or: [{ firebaseUid }, { email }] });
        if (existingUser) {
            return res.status(409).json({
                success: false,
                message: 'User already exists'
            });
        }

        // Create new user
        const user = await User.create({
            firebaseUid,
            email,
            role: role || 'student',
            profile: { name }
        });

        // Generate JWT
        const token = jwt.sign(
            { firebaseUid: user.firebaseUid, userId: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        res.status(201).json({
            success: true,
            message: 'User created successfully',
            data: {
                user: {
                    id: user._id,
                    email: user.email,
                    role: user.role,
                    profile: user.profile
                },
                token
            }
        });
    } catch (error) {
        console.error('Signup error:', error);
        res.status(500).json({
            success: false,
            message: 'Signup failed',
            error: error.message
        });
    }
});

// Login
router.post('/login', async (req, res) => {
    try {
        const { firebaseToken } = req.body;

        // Verify Firebase token
        const decodedToken = await verifyFirebaseToken(firebaseToken);

        // Find user
        const user = await User.findOne({ firebaseUid: decodedToken.uid });
        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found. Please sign up first.'
            });
        }

        // Generate JWT
        const token = jwt.sign(
            { firebaseUid: user.firebaseUid, userId: user._id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
        );

        res.json({
            success: true,
            message: 'Login successful',
            data: {
                user: {
                    id: user._id,
                    email: user.email,
                    role: user.role,
                    profile: user.profile,
                    institutionIds: user.institutionIds,
                    branchIds: user.branchIds
                },
                token
            }
        });
    } catch (error) {
        console.error('Login error full details:', {
            message: error.message,
            stack: error.stack,
            code: error.code
        });
        res.status(500).json({
            success: false,
            message: 'Login failed',
            error: error.message,
            details: error.code || 'Internal Server Error'
        });
    }
});

// Verify token
router.post('/verify-token', async (req, res) => {
    try {
        const { token } = req.body;

        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-__v +groqApiKey');

        if (!user) {
            return res.status(404).json({
                success: false,
                message: 'User not found'
            });
        }

        res.json({
            success: true,
            data: { user }
        });
    } catch (error) {
        res.status(401).json({
            success: false,
            message: 'Invalid or expired token'
        });
    }
});

// Get profile (requires authentication)
router.get('/profile', async (req, res) => {
    try {
        const authHeader = req.headers.authorization;
        if (!authHeader) {
            return res.status(401).json({ success: false, message: 'No token provided' });
        }

        const token = authHeader.split(' ')[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const user = await User.findById(decoded.userId).select('-__v +groqApiKey');

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        res.json({
            success: true,
            data: { user }
        });
    } catch (error) {
        res.status(401).json({
            success: false,
            message: 'Invalid token'
        });
    }
});

// Update profile
router.put('/profile', authenticate, attachUser, upload.fields([
    { name: 'avatar', maxCount: 1 },
    { name: 'banner', maxCount: 1 }
]), async (req, res) => {
    try {
        const {
            name, bio, phone, avatarUrl,
            department, designation, specialization,
            semester, prnNumber, interests
        } = req.body;
        const user = await User.findById(req.dbUser._id);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        // Basic profile fields
        if (name) user.profile.name = name;
        if (bio !== undefined) user.profile.bio = bio;
        if (phone !== undefined) user.profile.phone = phone;

        // Faculty-specific fields
        if (department !== undefined) user.profile.department = department;
        if (designation !== undefined) user.profile.designation = designation;
        if (specialization !== undefined) user.profile.specialization = specialization;

        // Student-specific fields
        if (semester !== undefined) user.profile.semester = semester;
        if (prnNumber !== undefined) user.profile.prnNumber = prnNumber;
        if (interests !== undefined) user.profile.interests = interests;

        // Handle avatar upload
        if (req.files && req.files.avatar && req.files.avatar[0]) {
            user.profile.avatar = req.files.avatar[0].path;
        } else if (avatarUrl) {
            // If avatar URL provided (e.g., from DiceBear)
            user.profile.avatar = avatarUrl;
        }

        // Handle banner upload
        if (req.files && req.files.banner && req.files.banner[0]) {
            user.profile.banner = req.files.banner[0].path;
        }

        await user.save();

        res.json({
            success: true,
            message: 'Profile updated successfully',
            data: {
                user: {
                    id: user._id,
                    email: user.email,
                    role: user.role,
                    profile: user.profile,
                    institutionIds: user.institutionIds,
                    branchIds: user.branchIds,
                    groqApiKey: user.groqApiKey,
                    aiOnboarding: user.aiOnboarding,
                    createdAt: user.createdAt
                }
            }
        });
    } catch (error) {
        console.error('Update profile error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update profile',
            error: error.message
        });
    }
});

export default router;
