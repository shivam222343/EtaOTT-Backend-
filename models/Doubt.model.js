import mongoose from 'mongoose';

const doubtSchema = new mongoose.Schema({
    studentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    courseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: true
    },
    contentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Content',
        default: null
    },
    query: {
        type: String,
        required: true,
        trim: true
    },
    selectedText: {
        type: String,
        default: null
    },
    context: {
        type: String,
        default: null
    },
    aiResponse: {
        type: String,
        default: null
    },
    confidence: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
    },
    escalated: {
        type: Boolean,
        default: false
    },
    facultyAnswer: {
        type: String,
        default: null
    },
    answeredBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        default: null
    },
    status: {
        type: String,
        enum: ['pending', 'answered', 'escalated', 'resolved'],
        default: 'pending'
    },
    resolvedAt: {
        type: Date,
        default: null
    },
    feedback: {
        helpful: {
            type: Boolean,
            default: null
        },
        rating: {
            type: Number,
            min: 1,
            max: 5,
            default: null
        }
    },
    visualContext: {
        x: Number,
        y: Number,
        width: Number,
        height: Number
    },
    suggestedVideo: {
        id: String,
        url: String,
        title: String,
        thumbnail: String
    },
    confidenceBreakdown: {
        type: Object,
        default: null
    },
    isFromCache: {
        type: Boolean,
        default: false
    },
    source: {
        type: String,
        default: 'AI_API' // 'KNOWLEDGE_GRAPH' or 'AI_API'
    }
}, {
    timestamps: true
});

// Indexes
doubtSchema.index({ studentId: 1 });
doubtSchema.index({ courseId: 1 });
doubtSchema.index({ status: 1 });
doubtSchema.index({ escalated: 1 });
doubtSchema.index({ createdAt: -1 });

const Doubt = mongoose.model('Doubt', doubtSchema);

export default Doubt;
