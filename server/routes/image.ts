import { Permission } from '@server/lib/permissions';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';
import fs from 'fs';
import multer from 'multer';
import path from 'path';

const imageRoutes = Router();

// Ensure upload directory exists
const uploadDir = path.join(__dirname, '../../config/issue-attachments');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    // Generate unique filename with timestamp
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1e9);
    const ext = path.extname(file.originalname);
    cb(null, `issue-${uniqueSuffix}${ext}`);
  },
});

// File filter to only accept images
const fileFilter = (
  _req: Express.Request,
  file: Express.Multer.File,
  cb: multer.FileFilterCallback
) => {
  const allowedMimeTypes = [
    'image/jpeg',
    'image/jpg',
    'image/png',
    'image/gif',
    'image/webp',
  ];

  if (allowedMimeTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error(
        'Invalid file type. Only JPEG, PNG, GIF, and WebP images are allowed.'
      )
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB max file size
  },
});

// Upload endpoint for issue attachments
imageRoutes.post(
  '/upload',
  isAuthenticated([Permission.MANAGE_ISSUES, Permission.CREATE_ISSUES], {
    type: 'or',
  }),
  upload.single('image'),
  async (req, res, next) => {
    try {
      if (!req.file) {
        return next({ status: 400, message: 'No image file provided.' });
      }

      logger.info('Image uploaded successfully', {
        label: 'Image Upload',
        filename: req.file.filename,
        userId: req.user?.id,
      });

      // Return the relative path that can be used to access the image
      return res.status(200).json({
        path: `/issue-attachments/${req.file.filename}`,
        filename: req.file.filename,
      });
    } catch (e) {
      logger.error('Error uploading image', {
        label: 'Image Upload',
        errorMessage: e.message,
      });
      return next({ status: 500, message: 'Failed to upload image.' });
    }
  }
);

export default imageRoutes;
