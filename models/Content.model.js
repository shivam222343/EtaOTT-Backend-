import mongoose from 'mongoose';

const contentSchema = new mongoose.Schema({
    // Course and Institution references
    courseId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Course',
        required: true,
        index: true
    },
    branchIds: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Branch'
    }],
    institutionId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Institution',
        required: true,
        index: true
    },

    // Basic Information
    title: {
        type: String,
        required: true,
        trim: true
    },
    description: {
        type: String,
        trim: true
    },
    type: {
        type: String,
        enum: ['pdf', 'video', 'presentation', 'code', 'document', 'image', 'audio', 'web', 'other'],
        required: true,
        index: true
    },

    // File Information
    file: {
        url: {
            type: String,
            required: true
        },
        publicId: String,        // Cloudinary public ID
        format: String,          // File extension (pdf, mp4, etc.)
        size: Number,            // File size in bytes
        duration: Number,        // For videos/audio (in seconds)
        pages: Number,           // For PDFs/presentations
        dimensions: {            // For images/videos
            width: Number,
            height: Number
        },
        thumbnail: {             // Thumbnail URL and public ID
            url: String,
            publicId: String
        }
    },

    // Metadata
    metadata: {
        author: String,
        createdDate: Date,
        language: {
            type: String,
            default: 'en'
        },
        tags: [String],
        difficulty: {
            type: String,
            enum: ['beginner', 'intermediate', 'advanced'],
            default: 'intermediate'
        },
        category: String,        // Lecture, Assignment, Reference, etc.
        version: {
            type: String,
            default: '1.0'
        }
    },

    // Extracted Data (from AI/ML processing)
    extractedData: {
        text: String,            // Full text content
        summary: String,         // AI-generated summary
        topics: [String],        // Extracted topics
        keywords: [String],      // Key terms
        concepts: [{             // Main concepts covered
            name: String,
            description: String,
            importance: Number   // 0-1 scale
        }],
        structure: {             // Hierarchical structure
            type: mongoose.Schema.Types.Mixed
        },
        entities: [{             // Named entities (people, places, terms)
            name: String,
            type: String,
            frequency: Number
        }],
        questions: [{            // Auto-generated questions
            question: String,
            answer: String,
            difficulty: String
        }]
    },

    // Graph Database Reference
    graphNodeId: String,         // Neo4j node ID

    // Access Control
    accessRules: {
        isPublic: {
            type: Boolean,
            default: false
        },
        allowedRoles: [{
            type: String,
            enum: ['student', 'faculty', 'admin']
        }],
        requiredPrerequisites: [{
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Content'
        }]
    },

    // Upload Information
    uploadedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    uploadedAt: {
        type: Date,
        default: Date.now
    },

    // Processing Status
    processingStatus: {
        type: String,
        enum: ['pending', 'processing', 'completed', 'failed'],
        default: 'pending'
    },
    processingProgress: {
        type: Number,
        default: 0,
        min: 0,
        max: 100
    },
    processingError: String,

    // Analytics
    stats: {
        viewCount: {
            type: Number,
            default: 0
        },
        downloadCount: {
            type: Number,
            default: 0
        },
        averageRating: {
            type: Number,
            default: 0,
            min: 0,
            max: 5
        },
        totalRatings: {
            type: Number,
            default: 0
        },
        completionRate: {
            type: Number,
            default: 0,
            min: 0,
            max: 100
        },
        averageTimeSpent: Number  // in seconds
    },

    // Status
    isActive: {
        type: Boolean,
        default: true
    },
    isPublished: {
        type: Boolean,
        default: false
    },
    publishedAt: Date

}, {
    timestamps: true
});

// Indexes for better query performance
contentSchema.index({ courseId: 1, type: 1 });
contentSchema.index({ institutionId: 1, isPublished: 1 });
contentSchema.index({ 'metadata.tags': 1 });
contentSchema.index({ uploadedBy: 1, createdAt: -1 });
contentSchema.index({ processingStatus: 1 });

// Virtual for file size in MB
contentSchema.virtual('fileSizeMB').get(function () {
    return this.file.size ? (this.file.size / (1024 * 1024)).toFixed(2) : 0;
});

// Method to increment view count
contentSchema.methods.incrementViews = async function () {
    this.stats.viewCount += 1;
    await this.save();
};

// Method to increment download count
contentSchema.methods.incrementDownloads = async function () {
    this.stats.downloadCount += 1;
    await this.save();
};

// Method to add rating
contentSchema.methods.addRating = async function (rating) {
    const totalRatings = this.stats.totalRatings;
    const currentAverage = this.stats.averageRating;

    this.stats.totalRatings += 1;
    this.stats.averageRating = ((currentAverage * totalRatings) + rating) / this.stats.totalRatings;

    await this.save();
};

// Static method to get popular content
contentSchema.statics.getPopular = function (limit = 10) {
    return this.find({ isActive: true, isPublished: true })
        .sort({ 'stats.viewCount': -1 })
        .limit(limit)
        .populate('courseId', 'name code')
        .populate('uploadedBy', 'profile.name');
};

// Static method to get recent content
contentSchema.statics.getRecent = function (limit = 10) {
    return this.find({ isActive: true, isPublished: true })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('courseId', 'name code')
        .populate('uploadedBy', 'profile.name');
};

const Content = mongoose.model('Content', contentSchema);

export default Content;
