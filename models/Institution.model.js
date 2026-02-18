import mongoose from 'mongoose';
import { nanoid } from 'nanoid';

const institutionSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },
    createdBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    facultyAccessKey: {
        type: String,
        unique: true,
        default: () => `FAC-${nanoid(10).toUpperCase()}`
    },
    facultyIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    metadata: {
        description: {
            type: String,
            default: ''
        },
        logo: {
            type: String,
            default: null
        },
        website: {
            type: String,
            default: null
        },
        address: {
            type: String,
            default: ''
        }
    },
    stats: {
        totalBranches: {
            type: Number,
            default: 0
        },
        totalStudents: {
            type: Number,
            default: 0
        },
        totalCourses: {
            type: Number,
            default: 0
        }
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Indexes
institutionSchema.index({ createdBy: 1 });
institutionSchema.index({ name: 'text' });

const Institution = mongoose.model('Institution', institutionSchema);

export default Institution;
