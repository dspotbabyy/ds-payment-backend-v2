import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class FileUploadService {
  private readonly uploadDir: string;
  private readonly publicUrl: string;

  constructor(private configService: ConfigService) {
    // Use persistent disk path if available (Render.com mounts to /var/data)
    // Otherwise use project root for development
    const persistentDiskPath = this.configService.get('PERSISTENT_DISK_PATH') || '/var/data';
    const usePersistentDisk = fs.existsSync(persistentDiskPath);
    
    if (usePersistentDisk) {
      // Use persistent disk on Render
      this.uploadDir = path.join(persistentDiskPath, 'uploads', 'id-cards');
      console.log(`[FileUploadService] Using persistent disk at: ${persistentDiskPath}`);
    } else {
      // Use project root for development
      this.uploadDir = path.join(process.cwd(), 'uploads', 'id-cards');
      console.log(`[FileUploadService] Using project directory (development mode)`);
    }
    
    console.log(`[FileUploadService] Upload directory: ${this.uploadDir}`);
    console.log(`[FileUploadService] Current working directory: ${process.cwd()}`);
    
    // Ensure upload directory exists
    try {
      if (!fs.existsSync(this.uploadDir)) {
        fs.mkdirSync(this.uploadDir, { recursive: true });
        console.log(`[FileUploadService] Created upload directory: ${this.uploadDir}`);
      } else {
        console.log(`[FileUploadService] Upload directory already exists: ${this.uploadDir}`);
      }
      
      // Verify directory is writable
      fs.accessSync(this.uploadDir, fs.constants.W_OK);
      console.log(`[FileUploadService] Upload directory is writable`);
    } catch (error) {
      console.error(`[FileUploadService] Error setting up upload directory:`, error);
      throw new Error(`Failed to create upload directory: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Get public URL from config or use default
    const baseUrl = this.configService.get('BASE_URL') || 'http://localhost:3000';
    this.publicUrl = `${baseUrl}/api/uploads/id-cards`;
    console.log(`[FileUploadService] Public URL: ${this.publicUrl}`);
  }

  /**
   * Save base64 image to file
   */
  async saveBase64Image(base64Data: string, orderId: number): Promise<string> {
    try {
      let imageType: string;
      let imageData: string;

      // Check if it's a data URI format (data:image/[type];base64,[data])
      const dataUriRegex = /^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/i;
      const dataUriMatch = base64Data.match(dataUriRegex);
      
      if (dataUriMatch) {
        // Full data URI format
        imageType = dataUriMatch[1].toLowerCase();
        // Normalize jpg to jpeg
        if (imageType === 'jpg') {
          imageType = 'jpeg';
        }
        imageData = dataUriMatch[2];
      } else {
        // Just base64 data without prefix - try to detect image type
        const trimmedData = base64Data.trim();
        
        // Check if it's valid base64
        const base64Regex = /^[A-Za-z0-9+/=\s]+$/;
        if (!base64Regex.test(trimmedData)) {
          throw new BadRequestException('Invalid base64 image format. Expected data:image/[type];base64,[data] or valid base64 string');
        }

        // Remove whitespace
        const cleanData = trimmedData.replace(/\s/g, '');
        
        // Try to detect image type from base64 data magic bytes
        // Decode first few bytes to check magic numbers
        try {
          const buffer = Buffer.from(cleanData, 'base64');
          const header = buffer.slice(0, 12);
          
          // PNG: starts with 89 50 4E 47 0D 0A 1A 0A
          if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
            imageType = 'png';
          }
          // JPEG: starts with FF D8 FF
          else if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
            imageType = 'jpeg';
          }
          // GIF: starts with 47 49 46 38 (GIF8)
          else if (header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x38) {
            imageType = 'gif';
          }
          // WEBP: starts with 52 49 46 46 (RIFF) followed by WEBP
          else if (header[0] === 0x52 && header[1] === 0x49 && header[2] === 0x46 && header[3] === 0x46) {
            // Check for WEBP signature at offset 8
            if (buffer.length > 12 && buffer.slice(8, 12).toString() === 'WEBP') {
              imageType = 'webp';
            } else {
              imageType = 'jpeg'; // Default fallback
            }
          }
          else {
            // Default to jpeg if we can't determine
            imageType = 'jpeg';
          }
          
          imageData = cleanData;
        } catch (decodeError) {
          throw new BadRequestException('Invalid base64 image data. Could not decode base64 string');
        }
      }

      // Validate image type
      const allowedTypes = ['png', 'jpeg', 'jpg', 'gif', 'webp'];
      if (!allowedTypes.includes(imageType.toLowerCase())) {
        throw new BadRequestException(`Invalid image type. Allowed types: ${allowedTypes.join(', ')}`);
      }

      // Generate unique filename
      const filename = `order-${orderId}-${uuidv4()}.${imageType}`;
      const filePath = path.join(this.uploadDir, filename);

      // Convert base64 to buffer and save
      const buffer = Buffer.from(imageData, 'base64');
      
      console.log(`[FileUploadService] Decoded image buffer size: ${buffer.length} bytes`);
      
      // Validate file size (max 10MB)
      const maxSize = 10 * 1024 * 1024; // 10MB
      if (buffer.length > maxSize) {
        throw new BadRequestException('Image file too large. Maximum size is 10MB');
      }

      // Ensure directory exists before writing
      if (!fs.existsSync(this.uploadDir)) {
        fs.mkdirSync(this.uploadDir, { recursive: true });
        console.log(`[FileUploadService] Recreated upload directory before writing: ${this.uploadDir}`);
      }

      // Write file
      console.log(`[FileUploadService] Writing file to: ${filePath}`);
      fs.writeFileSync(filePath, buffer);
      
      // Verify file was written
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        console.log(`[FileUploadService] File written successfully. Size: ${stats.size} bytes`);
      } else {
        throw new Error('File was not created after write operation');
      }

      // Return relative path for database storage
      return `id-cards/${filename}`;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(`Failed to save image: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get public URL for a file path
   */
  getPublicUrl(filePath: string | null): string | null {
    if (!filePath) {
      return null;
    }

    // If it's already a full URL, return as is
    if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
      return filePath;
    }

    // Extract filename from path
    const filename = path.basename(filePath);
    return `${this.publicUrl}/${filename}`;
  }

  /**
   * Delete file
   */
  async deleteFile(filePath: string | null): Promise<void> {
    if (!filePath) {
      return;
    }

    try {
      // Extract filename from path
      const filename = path.basename(filePath);
      const fullPath = path.join(this.uploadDir, filename);
      
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
    } catch (error) {
      console.error(`Error deleting file ${filePath}:`, error);
      // Don't throw - file deletion failure shouldn't break the flow
    }
  }
}

