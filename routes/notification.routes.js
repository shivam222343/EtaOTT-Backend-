import express from 'express';
import { authenticate, attachUser } from '../middleware/auth.middleware.js';
import Notification from '../models/Notification.model.js';

const router = express.Router();

// Get user's notifications with pagination
router.get('/', authenticate, attachUser, async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const skip = (page - 1) * limit;

        const notifications = await Notification.find({ recipientId: req.dbUser._id })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit);

        const total = await Notification.countDocuments({ recipientId: req.dbUser._id });
        const unreadCount = await Notification.countDocuments({ recipientId: req.dbUser._id, read: false });

        res.json({
            success: true,
            data: {
                notifications,
                pagination: {
                    total,
                    page,
                    limit,
                    pages: Math.ceil(total / limit)
                },
                unreadCount
            }
        });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get notifications',
            error: error.message
        });
    }
});

// Mark notification as read
router.patch('/:id/read', authenticate, attachUser, async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            { _id: req.params.id, recipientId: req.dbUser._id },
            { read: true, readAt: new Date() },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        res.json({
            success: true,
            message: 'Notification marked as read',
            data: { notification }
        });
    } catch (error) {
        console.error('Mark notification read error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update notification',
            error: error.message
        });
    }
});

// Mark all as read
router.patch('/read-all', authenticate, attachUser, async (req, res) => {
    try {
        await Notification.updateMany(
            { recipientId: req.dbUser._id, read: false },
            { read: true, readAt: new Date() }
        );

        res.json({
            success: true,
            message: 'All notifications marked as read'
        });
    } catch (error) {
        console.error('Mark all read error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update notifications',
            error: error.message
        });
    }
});

// Delete specific notification
router.delete('/:id', authenticate, attachUser, async (req, res) => {
    try {
        const result = await Notification.deleteOne({
            _id: req.params.id,
            recipientId: req.dbUser._id
        });

        if (result.deletedCount === 0) {
            return res.status(404).json({
                success: false,
                message: 'Notification not found'
            });
        }

        res.json({
            success: true,
            message: 'Notification deleted'
        });
    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete notification',
            error: error.message
        });
    }
});

// Delete all notifications
router.delete('/delete-all', authenticate, attachUser, async (req, res) => {
    try {
        await Notification.deleteMany({ recipientId: req.dbUser._id });

        res.json({
            success: true,
            message: 'All notifications deleted'
        });
    } catch (error) {
        console.error('Delete all notifications error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete notifications',
            error: error.message
        });
    }
});

export default router;
