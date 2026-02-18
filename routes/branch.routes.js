import express from 'express';
import QRCode from 'qrcode';
import { authenticate, attachUser } from '../middleware/auth.middleware.js';
import { requireFaculty, requireStudent } from '../middleware/role.middleware.js';
import Branch from '../models/Branch.model.js';
import Institution from '../models/Institution.model.js';
import User from '../models/User.model.js';
import cloudinary from '../config/cloudinary.config.js';
import { runNeo4jQuery } from '../config/neo4j.config.js';

const router = express.Router();

// Create branch (Faculty only)
router.post('/', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const { institutionId, name, description } = req.body;

        // Verify institution exists and user is a member
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
                message: 'You are not a member of this institution'
            });
        }

        // Create branch
        const branch = await Branch.create({
            institutionId,
            name,
            description
        });

        // Generate QR code
        const qrData = JSON.stringify({
            type: 'branch_enrollment',
            branchId: branch._id.toString(),
            accessKey: branch.accessKey,
            institutionName: institution.name,
            branchName: branch.name
        });

        const qrCodeDataURL = await QRCode.toDataURL(qrData, {
            width: 500,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });

        // Upload QR code to Cloudinary
        const uploadResult = await cloudinary.uploader.upload(qrCodeDataURL, {
            folder: 'eta-qr-codes',
            public_id: `branch-${branch._id}`
        });

        branch.qrCodeUrl = uploadResult.secure_url;
        await branch.save();

        // Update institution stats
        await Institution.findByIdAndUpdate(institutionId, {
            $inc: { 'stats.totalBranches': 1 }
        });

        // Create branch node in Neo4j and link to institution
        await runNeo4jQuery(
            `MATCH (i:Institution {id: $institutionId})
       CREATE (b:Branch {
         id: $branchId,
         name: $name,
         createdAt: datetime()
       })
       CREATE (i)-[:CONTAINS]->(b)`,
            {
                institutionId: institutionId.toString(),
                branchId: branch._id.toString(),
                name: branch.name
            }
        );

        res.status(201).json({
            success: true,
            message: 'Branch created successfully',
            data: { branch }
        });
    } catch (error) {
        console.error('Create branch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create branch',
            error: error.message
        });
    }
});

// Join branch via access key or QR (Student)
router.post('/join', authenticate, attachUser, requireStudent, async (req, res) => {
    try {
        const { accessKey, branchId } = req.body;

        let branch;
        if (branchId) {
            branch = await Branch.findById(branchId);
        } else if (accessKey) {
            branch = await Branch.findOne({ accessKey });
        }

        if (!branch) {
            return res.status(404).json({
                success: false,
                message: 'Branch not found'
            });
        }

        // Check if already enrolled
        if (branch.enrolledStudents.includes(req.dbUser._id)) {
            return res.status(400).json({
                success: false,
                message: 'Already enrolled in this branch'
            });
        }

        // Add student to branch
        branch.enrolledStudents.push(req.dbUser._id);
        branch.stats.totalStudents += 1;
        await branch.save();

        // Add branch to user's branchIds
        await User.findByIdAndUpdate(req.dbUser._id, {
            $addToSet: {
                branchIds: branch._id,
                institutionIds: branch.institutionId
            }
        });

        // Update institution stats
        await Institution.findByIdAndUpdate(branch.institutionId, {
            $inc: { 'stats.totalStudents': 1 }
        });

        res.json({
            success: true,
            message: 'Successfully joined branch',
            data: { branch }
        });
    } catch (error) {
        console.error('Join branch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to join branch',
            error: error.message
        });
    }
});

// Get branch by ID
router.get('/:id', authenticate, attachUser, async (req, res) => {
    try {
        const branch = await Branch.findById(req.params.id)
            .populate('institutionId', 'name metadata')
            .populate('enrolledStudents', 'profile.name email');

        if (!branch) {
            return res.status(404).json({
                success: false,
                message: 'Branch not found'
            });
        }

        res.json({
            success: true,
            data: { branch }
        });
    } catch (error) {
        console.error('Get branch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get branch',
            error: error.message
        });
    }
});

// Update branch
router.put('/:id', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const { name, description } = req.body;

        const branch = await Branch.findById(req.params.id);
        if (!branch) {
            return res.status(404).json({
                success: false,
                message: 'Branch not found'
            });
        }

        // Verify user is faculty of the institution
        const institution = await Institution.findById(branch.institutionId);
        if (!institution.facultyIds.includes(req.dbUser._id)) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to update this branch'
            });
        }

        if (name) branch.name = name;
        if (description !== undefined) branch.description = description;

        await branch.save();

        // Update Neo4j
        await runNeo4jQuery(
            `MATCH (b:Branch {id: $id})
       SET b.name = $name`,
            { id: branch._id.toString(), name: branch.name }
        );

        res.json({
            success: true,
            message: 'Branch updated successfully',
            data: { branch }
        });
    } catch (error) {
        console.error('Update branch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update branch',
            error: error.message
        });
    }
});

// Delete branch
router.delete('/:id', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const branch = await Branch.findById(req.params.id);
        if (!branch) {
            return res.status(404).json({
                success: false,
                message: 'Branch not found'
            });
        }

        // Verify user is faculty of the institution
        const institution = await Institution.findById(branch.institutionId);
        if (!institution.facultyIds.includes(req.dbUser._id)) {
            return res.status(403).json({
                success: false,
                message: 'You are not authorized to delete this branch'
            });
        }

        // Delete from Neo4j
        await runNeo4jQuery(
            `MATCH (b:Branch {id: $id}) DETACH DELETE b`,
            { id: branch._id.toString() }
        );

        // Remove branch from all users
        await User.updateMany(
            { branchIds: branch._id },
            { $pull: { branchIds: branch._id } }
        );

        // Update institution stats
        await Institution.findByIdAndUpdate(branch.institutionId, {
            $inc: {
                'stats.totalBranches': -1,
                'stats.totalStudents': -(branch.enrolledStudents?.length || 0)
            }
        });

        // Soft delete courses in this branch (update branchIds array)
        const Course = (await import('../models/Course.model.js')).default;
        await Course.updateMany(
            { branchIds: branch._id },
            { $pull: { branchIds: branch._id } }
        );

        // Delete branch
        await Branch.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'Branch deleted successfully'
        });
    } catch (error) {
        console.error('Delete branch error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete branch',
            error: error.message
        });
    }
});

// Get all branches for an institution
router.get('/institution/:institutionId', authenticate, attachUser, async (req, res) => {
    try {
        const branches = await Branch.find({ institutionId: req.params.institutionId })
            .populate('institutionId', 'name');

        res.json({
            success: true,
            data: { branches }
        });
    } catch (error) {
        console.error('Get institution branches error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get branches',
            error: error.message
        });
    }
});

// Get current student's enrolled branches
router.get('/student/my-branches', authenticate, attachUser, requireStudent, async (req, res) => {
    try {
        const branches = await Branch.find({
            _id: { $in: req.dbUser.branchIds }
        }).populate('institutionId', 'name metadata');

        res.json({
            success: true,
            data: { branches }
        });
    } catch (error) {
        console.error('Get my branches error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get your branches',
            error: error.message
        });
    }
});

export default router;
