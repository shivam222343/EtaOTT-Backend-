import mongoose from 'mongoose';

const courseSchema = new mongoose.Schema({
    branchIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Branch',
        required: true
    }],
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
    code: {
        type: String,
        trim: true,
        uppercase: true
    },
    metadata: {
        credits: {
            type: Number,
            default: 0
        },
        semester: {
            type: String,
            default: ''
        }
    },
    facultyIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }],
    contentIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Content'
    }],
    accessRules: {
        timeBasedAccess: {
            enabled: {
                type: Boolean,
                default: false
            },
            startDate: {
                type: Date,
                default: null
            },
            endDate: {
                type: Date,
                default: null
            }
        },
        completionRequired: {
            enabled: {
                type: Boolean,
                default: false
            },
            prerequisiteCourseIds: [{
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Course'
            }]
        }
    },
    stats: {
        totalContent: {
            type: Number,
            default: 0
        },
        totalStudents: {
            type: Number,
            default: 0
        },
        totalDoubts: {
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
courseSchema.index({ branchIds: 1 });
courseSchema.index({ institutionId: 1 });
courseSchema.index({ code: 1 });
courseSchema.index({ name: 'text', description: 'text' });

const Course = mongoose.model('Course', courseSchema);

export default Course;
