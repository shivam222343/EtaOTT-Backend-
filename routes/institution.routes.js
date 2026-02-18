import express from 'express';
import { authenticate, attachUser } from '../middleware/auth.middleware.js';
import { requireFaculty, requireFacultyOrAdmin } from '../middleware/role.middleware.js';
import Institution from '../models/Institution.model.js';
import User from '../models/User.model.js';
import { runNeo4jQuery } from '../config/neo4j.config.js';

const router = express.Router();

// Create institution (Faculty only)
router.post('/', authenticate, attachUser, requireFaculty, async (req, res) => {
    try {
        const { name, description, logo, website, address } = req.body;

        // Create institution
        const institution = await Institution.create({
            name,
            createdBy: req.dbUser._id,
            facultyIds: [req.dbUser._id],
            metadata: {
                description,
                logo,
                website,
                address
            }
        });

        // Add institution to user's institutionIds
        await User.findByIdAndUpdate(req.dbUser._id, {
            $addToSet: { institutionIds: institution._id }
        });

        // Create institution node in Neo4j
        await runNeo4jQuery(
            `CREATE (i:Institution {
        id: $id,
        name: $name,
        createdAt: datetime()
      })`,
            { id: institution._id.toString(), name: institution.name }
        );

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

export default router;
