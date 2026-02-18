import mongoose from 'mongoose';
import { nanoid } from 'nanoid';

const branchSchema = new mongoose.Schema({
    institutionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Institution',
        required: true
    },
    name: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        default: ''
    },
    accessKey: {
        type: String,
        unique: true,
        default: () => `BR-${nanoid(10).toUpperCase()}`
    },
    qrCodeUrl: {
        type: String,
        default: null
    },
    enrolledStudents: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    stats: {
        totalCourses: {
            type: Number,
            default: 0
        },
        totalStudents: {
            type: Number,
            default: 0
        },
        totalContent: {
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
branchSchema.index({ institutionId: 1 });
branchSchema.index({ name: 'text' });

const Branch = mongoose.model('Branch', branchSchema);

export default Branch;
