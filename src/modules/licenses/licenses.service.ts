import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { License } from '../../database/entities/license.entity';
import { CreateLicenseDto } from './dto/create-license.dto';
import { UpdateLicenseDto } from './dto/update-license.dto';
import { FilterLicensesDto } from './dto/filter-licenses.dto';
import { ValidateLicenseDto } from './dto/validate-license.dto';
import { LogsService } from '../logs/logs.service';
import { LogModule } from '../../database/entities/log.entity';

@Injectable()
export class LicensesService {
  constructor(
    @InjectRepository(License)
    private licenseRepository: Repository<License>,
    private logsService: LogsService,
  ) {}

  /**
   * Generate a random license key
   * Format: XXXXX-XXXXX-XXXXX-XXXXX (5 groups of 5 alphanumeric characters)
   */
  private generateLicenseKey(): string {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    const segments = 4;
    const segmentLength = 5;
    const segmentsArray: string[] = [];

    for (let i = 0; i < segments; i++) {
      let segment = '';
      for (let j = 0; j < segmentLength; j++) {
        segment += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      segmentsArray.push(segment);
    }

    return segmentsArray.join('-');
  }

  /**
   * Normalize domain (lowercase, trim, remove protocol)
   */
  private normalizeDomain(domain: string): string {
    let normalized = domain.trim().toLowerCase();

    // Remove protocol if present
    normalized = normalized.replace(/^https?:\/\//, '');

    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');

    // Remove www. prefix (optional, but common)
    normalized = normalized.replace(/^www\./, '');

    return normalized;
  }

  /**
   * Validate domain format
   */
  private validateDomain(domain: string): void {
    const normalized = this.normalizeDomain(domain);
    const domainRegex = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i;

    if (!domainRegex.test(normalized) && normalized !== 'localhost') {
      throw new BadRequestException('Invalid domain format');
    }
  }

  async create(createLicenseDto: CreateLicenseDto): Promise<License> {
    const { domain, expiry_date, is_active } = createLicenseDto;

    // Normalize and validate domain
    const normalizedDomain = this.normalizeDomain(domain);
    this.validateDomain(normalizedDomain);

    // Check if domain already exists
    const existingLicense = await this.licenseRepository.findOne({
      where: { domain: normalizedDomain },
    });

    if (existingLicense) {
      throw new ConflictException(
        `License for domain "${normalizedDomain}" already exists`,
      );
    }

    // Generate unique license key
    let licenseKey: string;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!isUnique && attempts < maxAttempts) {
      licenseKey = this.generateLicenseKey();
      const existingKey = await this.licenseRepository.findOne({
        where: { license_key: licenseKey },
      });

      if (!existingKey) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      throw new BadRequestException(
        'Failed to generate unique license key. Please try again.',
      );
    }

    // Create license
    const license = this.licenseRepository.create({
      domain: normalizedDomain,
      license_key: licenseKey!,
      expiry_date: expiry_date ? new Date(expiry_date) : null,
      is_active: is_active !== undefined ? is_active : true,
    });

    const savedLicense = await this.licenseRepository.save(license);

    // Log license creation
    this.logsService
      .createLog({
        module: LogModule.LICENSES,
        action: 'create',
        entity_id: savedLicense.id,
        details: {
          license_id: savedLicense.id,
          domain: savedLicense.domain,
          is_active: savedLicense.is_active,
          has_expiry: !!savedLicense.expiry_date,
        },
      })
      .catch((err) => console.error('Error logging license creation:', err));

    return savedLicense;
  }

  async findAll(filterDto?: FilterLicensesDto): Promise<License[]> {
    const queryBuilder = this.licenseRepository.createQueryBuilder('license');

    if (filterDto && filterDto.is_active !== undefined) {
      queryBuilder.andWhere('license.is_active = :isActive', {
        isActive: filterDto.is_active,
      });
    }

    return queryBuilder.orderBy('license.created_at', 'DESC').getMany();
  }

  async findOne(id: number): Promise<License> {
    const license = await this.licenseRepository.findOne({
      where: { id },
    });

    if (!license) {
      throw new NotFoundException(`License with ID ${id} not found`);
    }

    return license;
  }

  async findByDomain(domain: string): Promise<License | null> {
    const normalizedDomain = this.normalizeDomain(domain);
    return this.licenseRepository.findOne({
      where: { domain: normalizedDomain },
    });
  }

  async findByLicenseKey(licenseKey: string): Promise<License | null> {
    if (!licenseKey) {
      return null;
    }
    
    // Trim whitespace and normalize (remove any extra spaces, convert to uppercase for consistency)
    const trimmedKey = licenseKey.trim().toUpperCase();
    
    console.log('[LicensesService] Finding license by key:', {
      originalKey: licenseKey,
      trimmedKey: trimmedKey,
      keyLength: trimmedKey.length,
    });
    
    // Try exact match first (license keys are stored in uppercase)
    // Also try with the original key (in case it's stored with different case)
    let license = await this.licenseRepository.findOne({
      where: [
        { license_key: trimmedKey },
        { license_key: licenseKey.trim() }, // Try original case too
      ],
    });
    
    // If not found, try case-insensitive search (in case database has different case)
    if (!license) {
      console.log('[LicensesService] Exact match failed, trying case-insensitive search...');
      const allLicenses = await this.licenseRepository.find({
        select: ['id', 'license_key', 'domain', 'is_active'],
      });
      
      // Log all existing license keys with full comparison details for debugging
      console.log('[LicensesService] All licenses in database:', 
        allLicenses.map(l => {
          const storedKey = l.license_key;
          const storedKeyNormalized = storedKey.trim().toUpperCase();
          const matches = storedKeyNormalized === trimmedKey;
          return {
            id: l.id,
            key: storedKey,
            keyNormalized: storedKeyNormalized,
            searchedKey: trimmedKey,
            matches: matches,
            keyLength: storedKey.length,
            searchedKeyLength: trimmedKey.length,
            domain: l.domain,
            isActive: l.is_active,
          };
        })
      );
      
      // Try multiple comparison methods
      license = allLicenses.find(
        (l) => {
          const storedKey = l.license_key.trim().toUpperCase();
          const matches = storedKey === trimmedKey;
          if (matches) {
            console.log('[LicensesService] Found matching license:', {
              id: l.id,
              storedKey: l.license_key,
              storedKeyNormalized: storedKey,
              searchedKey: trimmedKey,
            });
          }
          return matches;
        }
      ) || null;
      
      // If still not found, try without dashes (in case format is different)
      if (!license) {
        console.log('[LicensesService] Trying comparison without dashes...');
        const trimmedKeyNoDashes = trimmedKey.replace(/-/g, '');
        license = allLicenses.find(
          (l) => {
            const storedKeyNoDashes = l.license_key.trim().toUpperCase().replace(/-/g, '');
            const matches = storedKeyNoDashes === trimmedKeyNoDashes;
            if (matches) {
              console.log('[LicensesService] Found matching license (no dashes):', {
                id: l.id,
                storedKey: l.license_key,
                storedKeyNoDashes: storedKeyNoDashes,
                searchedKeyNoDashes: trimmedKeyNoDashes,
              });
            }
            return matches;
          }
        ) || null;
      }
    }
    
    console.log('[LicensesService] License lookup result:', {
      found: !!license,
      licenseId: license?.id,
      licenseDomain: license?.domain,
      licenseIsActive: license?.is_active,
      storedLicenseKey: license ? `${license.license_key.substring(0, 5)}...` : 'N/A',
    });
    
    return license;
  }

  async update(id: number, updateLicenseDto: UpdateLicenseDto): Promise<License> {
    const license = await this.findOne(id);

    const { domain, expiry_date, is_active } = updateLicenseDto;

    // If domain is being updated, check for duplicates
    if (domain) {
      const normalizedDomain = this.normalizeDomain(domain);
      this.validateDomain(normalizedDomain);

      const existingLicense = await this.findByDomain(normalizedDomain);
      if (existingLicense && existingLicense.id !== id) {
        throw new ConflictException(
          `License for domain "${normalizedDomain}" already exists`,
        );
      }

      license.domain = normalizedDomain;
    }

    if (expiry_date !== undefined) {
      license.expiry_date = expiry_date ? new Date(expiry_date) : null;
    }

    if (is_active !== undefined) {
      license.is_active = is_active;
    }

    const updatedLicense = await this.licenseRepository.save(license);

    // Log license update
    this.logsService
      .createLog({
        module: LogModule.LICENSES,
        action: 'update',
        entity_id: id,
        details: {
          license_id: id,
          updated_fields: Object.keys(updateLicenseDto),
        },
      })
      .catch((err) => console.error('Error logging license update:', err));

    return updatedLicense;
  }

  async remove(id: number): Promise<void> {
    const license = await this.findOne(id);

    // Log license deletion
    this.logsService
      .createLog({
        module: LogModule.LICENSES,
        action: 'delete',
        entity_id: id,
        details: {
          license_id: id,
          domain: license.domain,
        },
      })
      .catch((err) => console.error('Error logging license deletion:', err));

    await this.licenseRepository.remove(license);
  }

  /**
   * Validate license key for plugin usage
   * Checks if license exists, is active, and matches domain
   */
  async validateLicense(validateLicenseDto: ValidateLicenseDto): Promise<{
    valid: boolean;
    message: string;
    license?: License;
  }> {
    const { license_key, domain } = validateLicenseDto;

    console.log('[LicensesService] Validating license:', {
      licenseKey: license_key ? `${license_key.substring(0, 5)}...` : 'missing',
      domain: domain,
    });

    // Find license by key (trim whitespace)
    const trimmedLicenseKey = license_key?.trim();
    const license = await this.findByLicenseKey(trimmedLicenseKey);

    if (!license) {
      return {
        valid: false,
        message: `License key "${license_key}" does not exist in the system`,
      };
    }

    // Check if license is active
    if (!license.is_active) {
      return {
        valid: false,
        message: `License key "${license_key}" is inactive. Please activate the license to use it`,
        license,
      };
    }

    // Check if license matches domain
    // Normalize both the provided domain and the stored license domain for comparison
    // (in case the license was created before normalization was implemented)
    const normalizedDomain = this.normalizeDomain(domain);
    const normalizedLicenseDomain = this.normalizeDomain(license.domain);
    
    // Special handling for localhost: if either domain is localhost (with or without port), they should match
    // Extract base domain (remove port for localhost comparison)
    const getBaseDomain = (d: string): string => {
      if (d === 'localhost' || d.startsWith('localhost:')) {
        return 'localhost';
      }
      return d;
    };
    
    const baseDomain = getBaseDomain(normalizedDomain);
    const baseLicenseDomain = getBaseDomain(normalizedLicenseDomain);
    
    console.log('[LicensesService] Domain comparison:', {
      originalDomain: domain,
      normalizedDomain: normalizedDomain,
      baseDomain: baseDomain,
      licenseDomain: license.domain,
      normalizedLicenseDomain: normalizedLicenseDomain,
      baseLicenseDomain: baseLicenseDomain,
      match: baseLicenseDomain === baseDomain,
    });
    
    if (baseLicenseDomain !== baseDomain) {
      // Create a more user-friendly error message
      let errorMessage = `Your license key is registered for "${license.domain}" but you are using it on "${domain}".`;
      
      // Add helpful suggestions based on the domains
      if (license.domain === 'localhost' && domain.includes('localhost')) {
        errorMessage += ` Both are localhost, but the port numbers might be different. Please ensure you're using the same domain configuration.`;
      } else if (license.domain.includes('localhost') && !domain.includes('localhost')) {
        errorMessage += ` Your license is for localhost, but you're using a different domain. Please use localhost or update your license domain.`;
      } else if (!license.domain.includes('localhost') && domain.includes('localhost')) {
        errorMessage += ` Your license is for "${license.domain}", but you're using localhost. Please use the registered domain or update your license.`;
      } else {
        errorMessage += ` Please update your domain in the plugin settings to match the registered domain.`;
      }
      
      return {
        valid: false,
        message: errorMessage,
        license,
      };
    }

    // Check if license has expired
    if (license.expiry_date) {
      const now = new Date();
      const expiry = new Date(license.expiry_date);

      if (now > expiry) {
        return {
          valid: false,
          message: `License key "${license_key}" has expired on ${expiry.toISOString().split('T')[0]}. Please renew the license`,
          license,
        };
      }
    }

    return {
      valid: true,
      message: 'License is valid',
      license,
    };
  }

  /**
   * Regenerate license key for an existing license
   */
  async regenerateLicenseKey(id: number): Promise<License> {
    const license = await this.findOne(id);

    // Generate unique license key
    let licenseKey: string;
    let isUnique = false;
    let attempts = 0;
    const maxAttempts = 10;

    while (!isUnique && attempts < maxAttempts) {
      licenseKey = this.generateLicenseKey();
      const existingKey = await this.findByLicenseKey(licenseKey);
      if (!existingKey || existingKey.id === id) {
        isUnique = true;
      }
      attempts++;
    }

    if (!isUnique) {
      throw new BadRequestException(
        'Failed to generate unique license key. Please try again.',
      );
    }

    license.license_key = licenseKey!;
    const updatedLicense = await this.licenseRepository.save(license);

    // Log license key regeneration
    this.logsService
      .createLog({
        module: LogModule.LICENSES,
        action: 'regenerate_key',
        entity_id: id,
        details: {
          license_id: id,
          domain: updatedLicense.domain,
        },
      })
      .catch((err) => console.error('Error logging license key regeneration:', err));

    return updatedLicense;
  }
}

