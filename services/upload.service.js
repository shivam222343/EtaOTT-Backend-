import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.config.js';
import path from 'path';

// File type validation
const ALLOWED_FILE_TYPES = {
    pdf: ['application/pdf'],
    video: ['video/mp4', 'video/mpeg', 'video/quicktime', 'video/x-msvideo', 'video/webm'],
    presentation: [
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    ],
    document: [
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'text/plain'
    ],
    image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'],
    audio: ['audio/mpeg', 'audio/wav', 'audio/ogg'],
    code: ['text/plain', 'application/javascript', 'text/x-python', 'text/x-java']
};

// File size limits (in bytes)
const FILE_SIZE_LIMITS = {
    pdf: 100 * 1024 * 1024,          // 100MB (increased to be safe)
    video: 500 * 1024 * 1024,       // 500MB
    presentation: 100 * 1024 * 1024,  // 100MB
    document: 50 * 1024 * 1024,      // 50MB
    image: 50 * 1024 * 1024,         // 50MB
    audio: 100 * 1024 * 1024,        // 100MB
    code: 50 * 1024 * 1024            // 50MB
};

// Determine content type from mimetype
const getContentType = (mimetype) => {
    for (const [type, mimetypes] of Object.entries(ALLOWED_FILE_TYPES)) {
        if (mimetypes.includes(mimetype)) {
            return type;
        }
    }
    return 'other';
};

// Configure Cloudinary storage
const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        const contentType = getContentType(file.mimetype);
        const fileExtension = path.extname(file.originalname).substring(1);

        // Determine resource type for Cloudinary
        let resourceType = 'auto';
        if (contentType === 'video') resourceType = 'video';
        else if (contentType === 'image') resourceType = 'image';
        else if (contentType === 'pdf') resourceType = 'image'; // PDFs are treated as images for better processing/size limits
        else resourceType = 'auto';

        return {
            folder: `eta-content/${contentType}`,
            resource_type: resourceType,
            public_id: `${Date.now()}-${file.originalname.replace(/\.[^/.]+$/, '')}${resourceType === 'raw' ? `.${fileExtension}` : ''}`,
            format: resourceType === 'raw' ? undefined : fileExtension,
            // Add transformation for videos (generate thumbnail)
            ...(contentType === 'video' && {
                eager: [
                    { width: 640, height: 360, crop: 'limit', format: 'jpg', page: 1 }
                ]
            })
        };
    }
});

// File filter
const fileFilter = (req, file, cb) => {
    const contentType = getContentType(file.mimetype);

    if (contentType === 'other') {
        cb(new Error(`File type ${file.mimetype} is not supported`), false);
    } else {
        cb(null, true);
    }
};

// Create multer upload instance
const upload = multer({
    storage: storage,
    fileFilter: fileFilter,
    limits: {
        fileSize: Math.max(...Object.values(FILE_SIZE_LIMITS)) // Use max limit
    }
});

// Middleware to validate file size based on type
export const validateFileSize = (req, res, next) => {
    const files = req.file ? [req.file] : (req.files?.file ? [req.files.file[0]] : []);
    const thumbnail = req.files?.thumbnail ? req.files.thumbnail[0] : null;

    if (files.length === 0 && !req.body.url) {
        return next();
    }

    // Validate main files
    for (const file of files) {
        const contentType = getContentType(file.mimetype);
        const maxSize = FILE_SIZE_LIMITS[contentType] || FILE_SIZE_LIMITS.document;

        if (file.size > maxSize) {
            return res.status(400).json({
                success: false,
                message: `File size exceeds limit for ${contentType} files (max ${(maxSize / (1024 * 1024)).toFixed(0)}MB)`
            });
        }
    }

    // Validate thumbnail if present
    if (thumbnail) {
        const maxSize = FILE_SIZE_LIMITS.image;
        if (thumbnail.size > maxSize) {
            return res.status(400).json({
                success: false,
                message: `Thumbnail size exceeds limit (max ${(maxSize / (1024 * 1024)).toFixed(0)}MB)`
            });
        }
    }

    next();
};

// Single file upload
export const uploadSingle = upload.single('file');

// Upload with optional thumbnail
export const uploadWithThumbnail = upload.fields([
    { name: 'file', maxCount: 1 },
    { name: 'thumbnail', maxCount: 1 }
]);

// Multiple files upload (max 10)
export const uploadMultiple = upload.array('files', 10);

// Export utilities
export {
    getContentType,
    ALLOWED_FILE_TYPES,
    FILE_SIZE_LIMITS
};

export default upload;
