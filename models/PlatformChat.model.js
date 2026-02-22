import mongoose from 'mongoose';

const platformChatSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    role: {
        type: String,
        enum: ['user', 'assistant'],
        required: true
    },
    content: {
        type: String,
        required: true
    },
    language: {
        type: String,
        default: 'english'
    }
}, {
    timestamps: true
});

platformChatSchema.index({ userId: 1, createdAt: 1 });

const PlatformChat = mongoose.model('PlatformChat', platformChatSchema);

export default PlatformChat;
