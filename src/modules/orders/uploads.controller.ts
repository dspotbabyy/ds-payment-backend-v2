import {
  Controller,
  Get,
  Param,
  NotFoundException,
  Res,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import * as fs from 'fs';
import * as path from 'path';

@Controller('uploads')
export class UploadsController {
  private readonly uploadDir: string;

  constructor(private configService: ConfigService) {
    // Use persistent disk path if available (Render.com mounts to /var/data)
    // Otherwise use project root for development
    const persistentDiskPath = this.configService.get('PERSISTENT_DISK_PATH') || '/var/data';
    const usePersistentDisk = fs.existsSync(persistentDiskPath);
    
    if (usePersistentDisk) {
      // Use persistent disk on Render
      this.uploadDir = path.join(persistentDiskPath, 'uploads', 'id-cards');
    } else {
      // Use project root for development
      this.uploadDir = path.join(process.cwd(), 'uploads', 'id-cards');
    }
  }

  /**
   * Serve ID card images
   */
  @Get('id-cards/:filename')
  async getIdCardImage(@Param('filename') filename: string, @Res() res: Response) {
    const filePath = path.join(this.uploadDir, filename);

    // Security: Validate filename to prevent directory traversal
    if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
      throw new NotFoundException('Invalid filename');
    }

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      throw new NotFoundException('File not found');
    }

    // Determine content type based on file extension
    const ext = path.extname(filename).toLowerCase();
    let contentType = 'image/jpeg';
    if (ext === '.png') contentType = 'image/png';
    else if (ext === '.gif') contentType = 'image/gif';
    else if (ext === '.webp') contentType = 'image/webp';

    // Set headers and send file
    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.sendFile(filePath);
  }
}

