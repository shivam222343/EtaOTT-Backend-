import express from 'express';
import Doubt from '../models/Doubt.model.js';
import User from '../models/User.model.js';
import Course from '../models/Course.model.js';
import mongoose from 'mongoose';
import { authenticate, attachUser } from '../middleware/auth.middleware.js';

const router = express.Router();

/**
 * Get Student Analytics
 */
router.get('/student/:id', authenticate, attachUser, async (req, res) => {
    try {
        const studentId = new mongoose.Types.ObjectId(req.params.id);
        const user = await User.findById(studentId);

        if (!user) return res.status(404).json({ success: false, message: 'User not found' });

        // 1. Activity Trend (last 7 days)
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const activityTrend = await Doubt.aggregate([
            { $match: { studentId, createdAt: { $gte: sevenDaysAgo } } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt" } },
                    count: { $sum: 1 }
                }
            },
            { $sort: { "_id": 1 } }
        ]);

        // 2. Subject Mastery (Doubts per Course)
        const subjectMastery = await Doubt.aggregate([
            { $match: { studentId } },
            { $group: { _id: "$courseId", doubtCount: { $sum: 1 }, resolvedCount: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } } } },
            { $lookup: { from: 'courses', localField: '_id', foreignField: '_id', as: 'course' } },
            { $unwind: "$course" },
            { $project: { name: "$course.name", proficiency: { $multiply: [{ $divide: ["$resolvedCount", { $max: ["$doubtCount", 1] }] }, 100] } } }
        ]);

        // 3. Overall Stats
        const stats = {
            totalDoubts: await Doubt.countDocuments({ studentId }),
            resolvedDoubts: await Doubt.countDocuments({ studentId, status: 'resolved' }),
            coursesEnrolled: user.progressStats?.coursesEnrolled || 0,
            completionRate: user.progressStats?.coursesCompleted / (user.progressStats?.coursesEnrolled || 1) * 100 || 0
        };

        // 4. Doubt Engagement (AI vs Faculty)
        const engagement = await Doubt.aggregate([
            { $match: { studentId } },
            { $group: { _id: "$source", count: { $sum: 1 } } }
        ]);

        res.json({
            success: true,
            data: {
                activityTrend,
                subjectMastery,
                stats,
                engagement
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

/**
 * Get Faculty Analytics
 */
router.get('/faculty/:id', authenticate, attachUser, async (req, res) => {
    try {
        const facultyId = new mongoose.Types.ObjectId(req.params.id);

        // Find courses taught by this faculty (assuming courses have faculty references or createdBy)
        // For now, let's assume courses linked to branch/institution are what they oversee
        const user = await User.findById(facultyId);
        const branchIds = user.branchIds || [];

        // Pre-fetch course IDs to make aggregation simpler and more reliable
        const relevantCourseIds = await Course.find({
            $or: [
                { branchIds: { $in: branchIds } },
                { facultyIds: facultyId }
            ]
        }).distinct('_id');

        if (!relevantCourseIds || relevantCourseIds.length === 0) {
            return res.json({
                success: true,
                data: {
                    engagementTrend: [],
                    coursePerformance: [],
                    avgResolutionTime: 0
                }
            });
        }

        // 1. Engagement (Monthly Active Users in their courses)
        const engagementTrend = await Doubt.aggregate([
            { $match: { courseId: { $in: relevantCourseIds } } },
            {
                $group: {
                    _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
                    doubts: { $sum: 1 },
                    activeStudents: { $addToSet: "$studentId" }
                }
            },
            { $project: { month: "$_id", doubts: 1, activeStudents: { $size: "$activeStudents" } } },
            { $sort: { "month": 1 } }
        ]);

        // 2. Course Performance
        const coursePerformance = await Doubt.aggregate([
            { $match: { courseId: { $in: relevantCourseIds } } },
            {
                $group: {
                    _id: "$courseId",
                    avgConfidence: { $avg: "$confidence" },
                    totalDoubts: { $sum: 1 },
                    resolved: { $sum: { $cond: [{ $eq: ["$status", "resolved"] }, 1, 0] } }
                }
            },
            { $lookup: { from: 'courses', localField: '_id', foreignField: '_id', as: 'course' } },
            { $unwind: "$course" },
            { $project: { name: "$course.name", load: "$totalDoubts", health: { $multiply: [{ $divide: ["$resolved", { $max: ["$totalDoubts", 1] }] }, 100] } } }
        ]);

        // 3. Resolution Speed (Filtered for faculty courses)
        const resolutionData = await Doubt.aggregate([
            {
                $match: {
                    courseId: { $in: relevantCourseIds },
                    status: 'resolved',
                    resolvedAt: { $ne: null }
                }
            },
            { $project: { timeToResolve: { $subtract: ["$resolvedAt", "$createdAt"] } } },
            { $group: { _id: null, avgTime: { $avg: "$timeToResolve" } } }
        ]);

        res.json({
            success: true,
            data: {
                engagementTrend,
                coursePerformance,
                avgResolutionTime: resolutionData[0]?.avgTime || 0
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;
