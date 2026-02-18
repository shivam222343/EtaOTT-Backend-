import mongoose from 'mongoose';

const GeneratedPDFSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        required: true
    },
    originalUrl: {
        type: String,
        required: true
    },
    pdfUrl: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

export default mongoose.model('GeneratedPDF', GeneratedPDFSchema);
