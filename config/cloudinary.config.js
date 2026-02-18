import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true
});

export default cloudinary;

// Helper function to upload file
export async function uploadToCloudinary(file, folder = 'eta-content') {
    try {
        const result = await cloudinary.uploader.upload(file.path, {
            folder,
            resource_type: 'auto',
            use_filename: true,
            unique_filename: true
        });
        return {
            url: result.secure_url,
            publicId: result.public_id,
            format: result.format,
            resourceType: result.resource_type
        };
    } catch (error) {
        console.error('Cloudinary upload error:', error);
        throw error;
    }
}

// Helper function to delete file
export async function deleteFromCloudinary(publicId) {
    try {
        const result = await cloudinary.uploader.destroy(publicId);
        return result;
    } catch (error) {
        console.error('Cloudinary delete error:', error);
        throw error;
    }
}
// Helper function to upload buffer
export async function uploadBufferToCloudinary(buffer, folder = 'eta-content/pdf', fileName = 'generated_notes') {
    return new Promise((resolve, reject) => {
        const uploadStream = cloudinary.uploader.upload_stream(
            {
                folder,
                resource_type: 'raw',
                public_id: `${fileName}_${Date.now()}`,
                format: 'pdf'
            },
            (error, result) => {
                if (error) {
                    console.error('Cloudinary buffer upload error:', error);
                    reject(error);
                } else {
                    resolve({
                        url: result.secure_url,
                        publicId: result.public_id,
                        format: result.format,
                        resourceType: result.resource_type
                    });
                }
            }
        );
        uploadStream.end(buffer);
    });
}
