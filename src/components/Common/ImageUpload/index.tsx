import { PhotoIcon, XMarkIcon } from '@heroicons/react/24/outline';
import axios from 'axios';
import { useRef, useState } from 'react';
import { defineMessages, useIntl } from 'react-intl';
import { useToasts } from 'react-toast-notifications';

const messages = defineMessages({
  uploadImage: 'Upload Image',
  pasteImage: 'Paste from clipboard or drag & drop',
  uploading: 'Uploading...',
  remove: 'Remove',
  uploadFailed: 'Image upload failed.',
  fileTooLarge: 'File is too large. Maximum size is 10MB.',
  invalidFileType:
    'Invalid file type. Only JPEG, PNG, GIF, and WebP are allowed.',
});

interface ImageUploadProps {
  onImageUploaded: (path: string) => void;
  onImageRemoved: () => void;
  currentImage?: string;
}

const ImageUpload = ({
  onImageUploaded,
  onImageRemoved,
  currentImage,
}: ImageUploadProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | undefined>(currentImage);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);

  const uploadImage = async (file: File) => {
    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      addToast(intl.formatMessage(messages.fileTooLarge), {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    // Validate file type
    const allowedTypes = [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/gif',
      'image/webp',
    ];
    if (!allowedTypes.includes(file.type)) {
      addToast(intl.formatMessage(messages.invalidFileType), {
        appearance: 'error',
        autoDismiss: true,
      });
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('image', file);

      const response = await axios.post<{ path: string }>(
        '/api/v1/image/upload',
        formData,
        {
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        }
      );

      setPreview(response.data.path);
      onImageUploaded(response.data.path);
    } catch (error) {
      addToast(intl.formatMessage(messages.uploadFailed), {
        appearance: 'error',
        autoDismiss: true,
      });
    } finally {
      setUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      uploadImage(file);
    }
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.type.indexOf('image') !== -1) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) {
          uploadImage(file);
        }
        break;
      }
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.classList.add('ring-2', 'ring-indigo-500');
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.classList.remove('ring-2', 'ring-indigo-500');
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneRef.current?.classList.remove('ring-2', 'ring-indigo-500');

    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      uploadImage(files[0]);
    }
  };

  const handleRemove = () => {
    setPreview(undefined);
    onImageRemoved();
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className="my-4">
      {preview ? (
        <div className="relative inline-block">
          <img
            src={preview}
            alt="Uploaded"
            className="max-h-64 rounded-lg border border-gray-600"
          />
          <button
            type="button"
            onClick={handleRemove}
            className="absolute -right-2 -top-2 rounded-full bg-red-600 p-1 text-white hover:bg-red-700"
            title={intl.formatMessage(messages.remove)}
          >
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>
      ) : (
        <div
          ref={dropZoneRef}
          onPaste={handlePaste}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              fileInputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
          className="relative flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-gray-600 bg-gray-800 px-6 py-8 transition hover:border-gray-500"
        >
          <PhotoIcon className="mb-3 h-12 w-12 text-gray-400" />
          <p className="mb-2 text-sm font-medium text-gray-300">
            {uploading
              ? intl.formatMessage(messages.uploading)
              : intl.formatMessage(messages.uploadImage)}
          </p>
          <p className="text-xs text-gray-500">
            {intl.formatMessage(messages.pasteImage)}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/jpg,image/png,image/gif,image/webp"
            onChange={handleFileSelect}
            className="hidden"
            disabled={uploading}
          />
        </div>
      )}
    </div>
  );
};

export default ImageUpload;
