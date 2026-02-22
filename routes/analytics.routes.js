import express from 'express';
import Doubt from '../models/Doubt.model.js';
import User from '../models/User.model.js';
import Course from '../models/Course.model.js';
import Content from '../models/Content.model.js';
import mongoose from 'mongoose';
import { authenticate, attachUser } from '../middleware/auth.middleware.js';
import { analyzeDifficultMaterial } from '../services/ai.service.js';

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

        // Find courses taught by this faculty
        const user = await User.findById(facultyId);
        const branchIds = user.branchIds || [];

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

        // 3. Resolution Speed
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

/**
 * Get Material Difficulty Reports for Faculty
 */
router.get('/faculty/:id/difficulty-reports', authenticate, attachUser, async (req, res) => {
    try {
        const facultyId = new mongoose.Types.ObjectId(req.params.id);
        const user = await User.findById(facultyId);

        if (!user) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }

        const branchIds = user.branchIds || [];

        const relevantCourseIds = await Course.find({
            $or: [
                { branchIds: { $in: branchIds } },
                { facultyIds: facultyId }
            ]
        }).distinct('_id');

        if (!relevantCourseIds || relevantCourseIds.length === 0) {
            return res.json({ success: true, data: [] });
        }

        // Aggregate doubts by contentId to find most problematic materials
        const reports = await Doubt.aggregate([
            {
                $match: {
                    courseId: { $in: relevantCourseIds },
                    contentId: { $ne: null }
                    // We also consider non-escalated doubts if there are many of them
                }
            },
            {
                $group: {
                    _id: "$contentId",
                    courseId: { $first: "$courseId" },
                    totalDoubts: { $sum: 1 },
                    escalatedDoubts: { $sum: { $cond: [{ $eq: ["$escalated", true] }, 1, 0] } },
                    queries: { $push: "$query" }
                }
            },
            // Prioritize materials with escalations or high doubt count
            { $sort: { escalatedDoubts: -1, totalDoubts: -1 } },
            { $limit: 20 },
            {
                $lookup: {
                    from: 'contents',
                    localField: '_id',
                    foreignField: '_id',
                    as: 'content'
                }
            },
            { $unwind: "$content" },
            {
                $lookup: {
                    from: 'courses',
                    localField: 'courseId',
                    foreignField: '_id',
                    as: 'course'
                }
            },
            { $unwind: "$course" }
        ]);

        // Process with AI for each material
        const processedReports = await Promise.all(reports.map(async (report) => {
            const aiAnalysis = await analyzeDifficultMaterial(
                report.queries.slice(0, 10),
                report.content.title,
                report.course.name
            );

            return {
                materialId: report._id,
                materialTitle: report.content.title,
                subjectId: report.courseId,
                subjectName: report.course.name,
                totalDoubts: report.totalDoubts,
                escalationCount: report.escalatedDoubts,
                aiAnalysis
            };
        }));

        res.json({
            success: true,
            data: processedReports
        });
    } catch (error) {
        console.error('Difficulty reports error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

export default router;
