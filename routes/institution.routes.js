import express from 'express';
import { authenticate, attachUser } from '../middleware/auth.middleware.js';
import { requireFaculty, requireFacultyOrAdmin, requireAdmin } from '../middleware/role.middleware.js';
import Notification from '../models/Notification.model.js';
import { sendNotification } from '../services/websocket.service.js';
import Institution from '../models/Institution.model.js';
import User from '../models/User.model.js';
import { runNeo4jQuery } from '../config/neo4j.config.js';

const router = express.Router();

// Create institution (Faculty only)
router.post('/', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const { name, description, logo, website, address } = req.body;

        // Create institution (approved by default - Temporarily removed admin verification)
        const institution = await Institution.create({
            name,
            createdBy: req.dbUser._id,
            facultyIds: [req.dbUser._id],
            metadata: {
                description,
                logo,
                website,
                address
            },
            isActive: true,
            status: 'approved'
        });

        // Notify all admins
        const admins = await User.find({ role: 'admin' });
        for (const admin of admins) {
            const notification = await Notification.create({
                recipientId: admin._id,
                type: 'institution_created',
                title: 'New Institution Approval Required',
                message: `A new institution "${name}" has been created by ${req.dbUser.profile.name} and requires your approval.`,
                metadata: {
                    institutionId: institution._id,
                    facultyId: req.dbUser._id
                }
            });
            sendNotification(admin._id, notification);
        }

        res.status(201).json({
            success: true,
            message: 'Institution created successfully',
            data: { institution }
        });
    } catch (error) {
        console.error('Create institution error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create institution',
            error: error.message
        });
    }
});

// Join institution via access key (Faculty only)
router.post('/join', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const { accessKey } = req.body;

        // Find institution by access key
        const institution = await Institution.findOne({ facultyAccessKey: accessKey });
        if (!institution) {
            return res.status(404).json({
                success: false,
                message: 'Invalid access key'
            });
        }

        // Removed temporarily
        /*
        if (institution.status !== 'approved') {
            return res.status(400).json({
                success: false,
                message: 'This institution is still pending admin approval'
            });
        }
        */

        // Check if already a member
        if (institution.facultyIds.includes(req.dbUser._id)) {
            return res.status(400).json({
                success: false,
                message: 'Already a member of this institution'
            });
        }

        // Add faculty to institution
        institution.facultyIds.push(req.dbUser._id);
        await institution.save();

        // Add institution to user's institutionIds
        await User.findByIdAndUpdate(req.dbUser._id, {
            $addToSet: { institutionIds: institution._id }
        });

        res.json({
            success: true,
            message: 'Successfully joined institution',
            data: { institution }
        });
    } catch (error) {
        console.error('Join institution error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to join institution',
            error: error.message
        });
    }
});

// Leave institution (Faculty only)
router.post('/:id/leave', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const institution = await Institution.findById(req.params.id);
        if (!institution) {
            return res.status(404).json({
                success: false,
                message: 'Institution not found'
            });
        }

        // Check if user is the creator
        if (institution.createdBy.toString() === req.dbUser._id.toString()) {
            return res.status(400).json({
                success: false,
                message: 'Creators cannot leave their own institution. You must delete it instead.'
            });
        }

        // Remove faculty from institution
        await Institution.findByIdAndUpdate(req.params.id, {
            $pull: { facultyIds: req.dbUser._id }
        });

        // Remove institution from user's institutionIds
        await User.findByIdAndUpdate(req.dbUser._id, {
            $pull: { institutionIds: institution._id }
        });

        res.json({
            success: true,
            message: 'Successfully left institution'
        });
    } catch (error) {
        console.error('Leave institution error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to leave institution',
            error: error.message
        });
    }
});

// Get pending institutions (Admin only)
router.get('/admin/pending', authenticate, attachUser, requireAdmin, async (req, res) => {
    try {
        const institutions = await Institution.find({ status: 'pending' })
            .populate('createdBy', 'profile.name email');

        res.json({
            success: true,
            data: { institutions }
        });
    } catch (error) {
        console.error('Get pending institutions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get pending institutions',
            error: error.message
        });
    }
});

// Get institution by ID
router.get('/:id', authenticate, attachUser, async (req, res) => {
    try {
        const institution = await Institution.findById(req.params.id)
            .populate('createdBy', 'profile.name email')
            .populate('facultyIds', 'profile.name email');

        if (!institution) {
            return res.status(404).json({
                success: false,
                message: 'Institution not found'
            });
        }

        res.json({
            success: true,
            data: { institution }
        });
    } catch (error) {
        console.error('Get institution error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get institution',
            error: error.message
        });
    }
});


// Update institution
router.put('/:id', authenticate, attachUser, requireFacultyOrAdmin, async (req, res) => {
    try {
        const { name, description, logo, website, address } = req.body;

        const institution = await Institution.findById(req.params.id);
        if (!institution) {
            return res.status(404).json({
                success: false,
                message: 'Institution not found'
            });
        }

        // Check if user is creator or admin
        if (institution.createdBy.toString() !== req.dbUser._id.toString() && req.dbUser.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Only the creator or admin can update this institution'
            });
        }

        // Update institution
        if (name) institution.name = name;
        if (description !== undefined) institution.metadata.description = description;
        if (logo !== undefined) institution.metadata.logo = logo;
        if (website !== undefined) institution.metadata.website = website;
        if (address !== undefined) institution.metadata.address = address;

        await institution.save();

        // Update Neo4j
        await runNeo4jQuery(
            `MATCH (i:Institution {id: $id})
       SET i.name = $name`,
            { id: institution._id.toString(), name: institution.name }
        );

        res.json({
            success: true,
            message: 'Institution updated successfully',
            data: { institution }
        });
    } catch (error) {
        console.error('Update institution error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update institution',
            error: error.message
        });
    }
});

// Get user's institutions
router.get('/user/my-institutions', authenticate, attachUser, async (req, res) => {
    try {
        const institutions = await Institution.find({
            _id: { $in: req.dbUser.institutionIds }
        })
            .populate('createdBy', 'profile.name email')
            .populate('facultyIds', 'profile.name email');

        res.json({
            success: true,
            data: { institutions }
        });
    } catch (error) {
        console.error('Get my institutions error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to get institutions',
            error: error.message
        });
    }
});

// Delete institution
router.delete('/:id', authenticate, attachUser, requireFacultyOrAdmin, async (req, res) => {
    try {
        const institution = await Institution.findById(req.params.id);
        if (!institution) {
            return res.status(404).json({
                success: false,
                message: 'Institution not found'
            });
        }

        // Check if user is creator or admin
        if (institution.createdBy.toString() !== req.dbUser._id.toString() && req.dbUser.role !== 'admin') {
            return res.status(403).json({
                success: false,
                message: 'Only the creator or admin can delete this institution'
            });
        }

        // Delete from Neo4j
        await runNeo4jQuery(
            `MATCH (i:Institution {id: $id}) DETACH DELETE i`,
            { id: institution._id.toString() }
        );

        // Remove institution from all users
        await User.updateMany(
            { institutionIds: institution._id },
            { $pull: { institutionIds: institution._id } }
        );

        // Delete institution
        await Institution.findByIdAndDelete(req.params.id);

        res.json({
            success: true,
            message: 'Institution deleted successfully'
        });
    } catch (error) {
        console.error('Delete institution error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete institution',
            error: error.message
        });
    }
});


// Approve/Reject institution (Admin only)
router.patch('/:id/moderate', authenticate, attachUser, requireAdmin, async (req, res) => {
    try {
        const { status } = req.body; // 'approved' or 'rejected'
        if (!['approved', 'rejected'].includes(status)) {
            return res.status(400).json({ success: false, message: 'Invalid status' });
        }

        const institution = await Institution.findById(req.params.id);
        if (!institution) {
            return res.status(404).json({ success: false, message: 'Institution not found' });
        }

        institution.status = status;
        institution.isActive = status === 'approved';
        await institution.save();

        if (status === 'approved') {
            // Add institution to creator's institutionIds and create Neo4j node
            await User.findByIdAndUpdate(institution.createdBy, {
                $addToSet: { institutionIds: institution._id }
            });

            await runNeo4jQuery(
                `CREATE (i:Institution {
                    id: $id,
                    name: $name,
                    createdAt: datetime()
                })`,
                { id: institution._id.toString(), name: institution.name }
            );
        }

        // Notify faculty
        const notification = await Notification.create({
            recipientId: institution.createdBy,
            type: status === 'approved' ? 'institution_approved' : 'institution_rejected',
            title: status === 'approved' ? 'Institution Approved' : 'Institution Rejected',
            message: status === 'approved'
                ? `Your institution "${institution.name}" has been approved!`
                : `Your institution "${institution.name}" was rejected.`,
            metadata: {
                institutionId: institution._id
            }
        });
        sendNotification(institution.createdBy, notification);

        res.json({
            success: true,
            message: `Institution ${status} successfully`,
            data: { institution }
        });
    } catch (error) {
        console.error('Moderate institution error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to moderate institution',
            error: error.message
        });
    }
});

export default router;
