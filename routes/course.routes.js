import express from 'express';
import { authenticate, attachUser } from '../middleware/auth.middleware.js';
import { requireFaculty } from '../middleware/role.middleware.js';
import Course from '../models/Course.model.js';
import Branch from '../models/Branch.model.js';
import Institution from '../models/Institution.model.js';
import Content from '../models/Content.model.js';
import Doubt from '../models/Doubt.model.js';
import { runNeo4jQuery } from '../config/neo4j.config.js';
import { deleteFromCloudinary } from '../config/cloudinary.config.js';
import { deleteContentNode } from '../services/graph/content.graph.js';
import User from '../models/User.model.js';

const router = express.Router();

// Get courses for current user (Faculty: owned, Student: joined branches)
router.get('/user/my-courses', authenticate, attachUser, async (req, res) => {
    try {
        let query = { isActive: true };

        if (req.dbUser.role === 'faculty') {
            query.facultyIds = req.dbUser._id;
        } else if (req.dbUser.role === 'student') {
            // Courses belonging to branches the student has joined
            query.branchIds = { $in: req.dbUser.branchIds || [] };
        } else if (req.dbUser.role === 'admin') {
            // Admins can see everything
        }

        const courses = await Course.find(query)
            .populate('branchIds', 'name')
            .populate('institutionId', 'name icon')
            .populate('facultyIds', 'profile.name')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: { courses }
        });
    } catch (error) {
        console.error('Get my courses error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get courses',
            error: error.message
        });
    }
});

// Create course (Faculty only)
router.post('/', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const { branchIds, institutionId, name, description, code, metadata, accessRules } = req.body;

        // Validate input
        if (!branchIds || !Array.isArray(branchIds) || branchIds.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'At least one branch must be selected'
            });
        }

        if (!institutionId) {
            return res.status(400).json({
                success: false,
                message: 'Institution ID is required'
            });
        }

        // Verify institution exists and user is faculty
        const institution = await Institution.findById(institutionId);
        if (!institution) {
            return res.status(404).json({
                success: false,
                message: 'Institution not found'
            });
        }

        if (!institution.facultyIds.includes(req.dbUser._id)) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to create courses in this institution'
            });
        }

        // Verify all branches exist and belong to the institution
        const branches = await Branch.find({
            _id: { $in: branchIds },
            institutionId: institutionId
        });

        if (branches.length !== branchIds.length) {
            return res.status(404).json({
                success: false,
                message: 'One or more branches not found or do not belong to this institution'
            });
        }

        // Create course
        const course = await Course.create({
            branchIds,
            institutionId,
            name,
            description,
            code,
            metadata: metadata || {},
            facultyIds: [req.dbUser._id],
            accessRules: accessRules || {}
        });

        // Update branch stats for all branches
        await Branch.updateMany(
            { _id: { $in: branchIds } },
            { $inc: { 'stats.totalCourses': 1 } }
        );

        // Update institution stats
        await Institution.findByIdAndUpdate(institutionId, {
            $inc: { 'stats.totalCourses': 1 }
        });

        // Create course node in Neo4j and link to all branches
        for (const branchId of branchIds) {
            await runNeo4jQuery(
                `MERGE (c:Course {id: $courseId})
                 ON CREATE SET c.name = $name, c.code = $code, c.createdAt = datetime()
                 WITH c
                 OPTIONAL MATCH (b:Branch {id: $branchId})
                 FOREACH (x IN CASE WHEN b IS NOT NULL THEN [1] ELSE [] END |
                   MERGE (b)-[:HAS]->(c)
                 )`,
                {
                    branchId: branchId.toString(),
                    courseId: course._id.toString(),
                    name: course.name,
                    code: course.code || ''
                }
            );
        }

        // Populate and return
        const populatedCourse = await Course.findById(course._id)
            .populate('branchIds', 'name')
            .populate('institutionId', 'name')
            .populate('facultyIds', 'profile.name email');

        res.status(201).json({
            success: true,
            message: 'Course created successfully',
            data: { course: populatedCourse }
        });
    } catch (error) {
        console.error('Create course error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create course',
            error: error.message
        });
    }
});

// Get course by ID
router.get('/:id', authenticate, attachUser, async (req, res) => {
    try {
        const course = await Course.findById(req.params.id)
            .populate('branchIds', 'name institutionId')
            .populate('facultyIds', 'profile.name email')
            .populate('contentIds');

        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        res.json({
            success: true,
            data: { course }
        });
    } catch (error) {
        console.error('Get course error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get course',
            error: error.message
        });
    }
});

// Update course
router.put('/:id', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const { name, description, code, branchIds, metadata, accessRules } = req.body;

        const course = await Course.findById(req.params.id);
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        // Verify user is faculty of the course
        if (!course.facultyIds.includes(req.dbUser._id)) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to update this course'
            });
        }

        // Update basic fields
        if (name) course.name = name;
        if (description !== undefined) course.description = description;
        if (code !== undefined) course.code = code;
        if (accessRules) course.accessRules = { ...course.accessRules, ...accessRules };

        // Update metadata
        if (metadata) {
            course.metadata = { ...course.metadata, ...metadata };
        }

        // Update branchIds if provided
        if (branchIds && Array.isArray(branchIds)) {
            const oldBranchIds = course.branchIds.map(id => id.toString());
            const newBranchIds = branchIds.map(id => id.toString());

            // Find added and removed branches
            const addedBranches = newBranchIds.filter(id => !oldBranchIds.includes(id));
            const removedBranches = oldBranchIds.filter(id => !newBranchIds.includes(id));

            // Update Neo4j relationships
            for (const branchId of addedBranches) {
                await runNeo4jQuery(
                    `MERGE (c:Course {id: $courseId})
                     ON CREATE SET c.name = $name, c.code = $code
                     WITH c
                     OPTIONAL MATCH (b:Branch {id: $branchId})
                     FOREACH (x IN CASE WHEN b IS NOT NULL THEN [1] ELSE [] END |
                       MERGE (b)-[:HAS]->(c)
                     )`,
                    {
                        branchId: branchId,
                        courseId: course._id.toString(),
                        name: course.name,
                        code: course.code || ''
                    }
                );
            }

            for (const branchId of removedBranches) {
                await runNeo4jQuery(
                    `MATCH (b:Branch {id: $branchId})-[r:HAS]->(c:Course {id: $courseId})
                     DELETE r`,
                    {
                        branchId: branchId,
                        courseId: course._id.toString()
                    }
                );
            }

            course.branchIds = branchIds;
        }

        await course.save();

        // Update Neo4j course properties
        await runNeo4jQuery(
            `MATCH (c:Course {id: $id})
       SET c.name = $name, c.code = $code`,
            {
                id: course._id.toString(),
                name: course.name,
                code: course.code || ''
            }
        );

        // Populate and return
        const populatedCourse = await Course.findById(course._id)
            .populate('branchIds', 'name')
            .populate('institutionId', 'name')
            .populate('facultyIds', 'profile.name email');

        res.json({
            success: true,
            message: 'Course updated successfully',
            data: { course: populatedCourse }
        });
    } catch (error) {
        console.error('Update course error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update course',
            error: error.message
        });
    }
});

// Delete course
router.delete('/:id', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const course = await Course.findById(req.params.id);
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        // Verify user is faculty of the course
        if (!course.facultyIds.includes(req.dbUser._id)) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to delete this course'
            });
        }

        // 1. Find all content related to this course
        const contents = await Content.find({ courseId: course._id });

        // 2. Delete each content (Files + Graph + DB)
        for (const content of contents) {
            // Delete files from Cloudinary
            if (content.file && content.file.publicId) {
                await deleteFromCloudinary(content.file.publicId).catch(err => console.error('Cloudinary file delete error:', err));
            }
            if (content.file && content.file.thumbnail && content.file.thumbnail.publicId) {
                await deleteFromCloudinary(content.file.thumbnail.publicId).catch(err => console.error('Cloudinary thumbnail delete error:', err));
            }
            // Delete Word document from Cloudinary if it exists (for web content)
            if (content.extractedData?.metadata?.docxPublicId) {
                await deleteFromCloudinary(content.extractedData.metadata.docxPublicId).catch(err => console.error('Cloudinary docx delete error:', err));
            }
            // Delete from Neo4j
            await deleteContentNode(content._id).catch(err => console.error('Neo4j content delete error:', err));

            // Delete associated Doubts
            await Doubt.deleteMany({ contentId: content._id });
        }

        // 3. Delete all content records from MongoDB
        await Content.deleteMany({ courseId: course._id });

        // 4. Update branch stats (decrement both courses and content)
        const totalContentCount = contents.length;
        await Branch.updateMany(
            { _id: { $in: course.branchIds } },
            {
                $inc: {
                    'stats.totalCourses': -1,
                    'stats.totalContent': -totalContentCount
                }
            }
        );

        // 5. Delete Course from Neo4j
        await runNeo4jQuery(
            `MATCH (c:Course {id: $id}) DETACH DELETE c`,
            { id: course._id.toString() }
        );

        // 6. Hard delete Course from MongoDB
        await Course.findByIdAndDelete(course._id);

        res.json({
            success: true,
            message: 'Course and all related resources deleted successfully'
        });
    } catch (error) {
        console.error('Delete course error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete course',
            error: error.message
        });
    }
});

// Get all courses for a branch
router.get('/branch/:branchId', authenticate, attachUser, async (req, res) => {
    try {
        const courses = await Course.find({
            branchIds: req.params.branchId,
            isActive: true
        })
            .populate('branchIds', 'name')
            .populate('institutionId', 'name')
            .populate('facultyIds', 'profile.name email')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: { courses }
        });
    } catch (error) {
        console.error('Get branch courses error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get courses',
            error: error.message
        });
    }
});

// Get all courses for an institution
router.get('/institution/:institutionId', authenticate, attachUser, async (req, res) => {
    try {
        const courses = await Course.find({
            institutionId: req.params.institutionId,
            isActive: true
        })
            .populate('branchIds', 'name')
            .populate('institutionId', 'name')
            .populate('facultyIds', 'profile.name email')
            .sort({ createdAt: -1 });

        res.json({
            success: true,
            data: { courses }
        });
    } catch (error) {
        console.error('Get institution courses error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get courses',
            error: error.message
        });
    }
});

// Get all enrolled students for a course
router.get('/:id/students', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const course = await Course.findById(req.params.id);
        if (!course) {
            return res.status(404).json({ success: false, message: 'Course not found' });
        }

        // Verify authorization
        const isFaculty = course.facultyIds.some(id => id.toString() === req.dbUser._id.toString());
        if (!isFaculty) {
            return res.status(403).json({ success: false, message: 'Not authorized' });
        }

        // Find students who are in the same branches as the course
        const students = await User.find({
            role: 'student',
            branchIds: { $in: course.branchIds },
            isActive: true
        }).select('profile email progressStats confidenceScore branchIds');

        res.json({
            success: true,
            data: { students }
        });
    } catch (error) {
        console.error('Get enrolled students error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get enrolled students',
            error: error.message
        });
    }
});

export default router;
