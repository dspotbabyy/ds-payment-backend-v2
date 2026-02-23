import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Merchant } from '../../database/entities/merchant.entity';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { UpdateMerchantDto } from './dto/update-merchant.dto';
import { FilterMerchantsDto } from './dto/filter-merchants.dto';
import { LogsService } from '../logs/logs.service';
import { LogModule } from '../../database/entities/log.entity';

@Injectable()
export class MerchantsService {
  constructor(
    @InjectRepository(Merchant)
    private merchantRepository: Repository<Merchant>,
    private logsService: LogsService,
  ) {}

  /**
   * Normalize domain (lowercase, trim, remove protocol)
   */
  private normalizeDomain(domain: string): string {
    let normalized = domain.trim().toLowerCase();

    // Remove protocol if present
    normalized = normalized.replace(/^https?:\/\//, '');

    // Remove trailing slash
    normalized = normalized.replace(/\/$/, '');

    return normalized;
  }

  /**
   * Validate domain format
   */
  private validateDomain(domain: string): void {
    const normalized = this.normalizeDomain(domain);
    const domainRegex = /^([a-z0-9]+(-[a-z0-9]+)*\.)+[a-z]{2,}$/i;

    if (!domainRegex.test(normalized)) {
      throw new BadRequestException('Invalid domain format');
    }
  }

  async create(createMerchantDto: CreateMerchantDto, userId?: number, ipAddress?: string): Promise<Merchant> {
    const { domain, contact_email, contact_phone } = createMerchantDto;

    // Normalize and validate domain
    const normalizedDomain = this.normalizeDomain(domain);
    this.validateDomain(normalizedDomain);

    // Check if merchant with this domain already exists
    const existingMerchant = await this.merchantRepository.findOne({
      where: { domain: normalizedDomain },
    });

    if (existingMerchant) {
      throw new ConflictException(
        `Merchant with domain "${normalizedDomain}" already exists`,
      );
    }

    // Create merchant
    const merchant = this.merchantRepository.create({
      domain: normalizedDomain,
      contact_email: contact_email.trim().toLowerCase(),
      contact_phone: contact_phone ? contact_phone.trim() : null,
    });

    const savedMerchant = await this.merchantRepository.save(merchant);

    // Log the action
    await this.logsService.createLog({
      module: LogModule.MERCHANTS,
      action: 'create',
      user_id: userId || null,
      entity_id: savedMerchant.id,
      details: {
        domain: savedMerchant.domain,
        contact_email: savedMerchant.contact_email,
        contact_phone: savedMerchant.contact_phone || null,
      },
      ip_address: ipAddress || null,
    });

    return savedMerchant;
  }

  async findAll(filterDto: FilterMerchantsDto): Promise<{
    data: Merchant[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const { domain, contact_email, limit = 50, offset = 0 } = filterDto;

    const queryBuilder = this.merchantRepository.createQueryBuilder('merchant');

    if (domain) {
      const normalizedDomain = this.normalizeDomain(domain);
      queryBuilder.andWhere('merchant.domain LIKE :domain', {
        domain: `%${normalizedDomain}%`,
      });
    }

    if (contact_email) {
      queryBuilder.andWhere('merchant.contact_email LIKE :contact_email', {
        contact_email: `%${contact_email.toLowerCase()}%`,
      });
    }

    queryBuilder.orderBy('merchant.created_at', 'DESC');

    const [data, total] = await queryBuilder
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    return {
      data,
      total,
      limit,
      offset,
    };
  }

  async findOne(id: number): Promise<Merchant> {
    const merchant = await this.merchantRepository.findOne({
      where: { id },
    });

    if (!merchant) {
      throw new NotFoundException(`Merchant with ID ${id} not found`);
    }

    return merchant;
  }

  async update(
    id: number,
    updateMerchantDto: UpdateMerchantDto,
    userId?: number,
    ipAddress?: string,
  ): Promise<Merchant> {
    const merchant = await this.findOne(id);

    const updateData: Partial<Merchant> = {};

    if (updateMerchantDto.domain !== undefined) {
      const normalizedDomain = this.normalizeDomain(updateMerchantDto.domain);
      this.validateDomain(normalizedDomain);

      // Check if another merchant with this domain exists
      const existingMerchant = await this.merchantRepository.findOne({
        where: { domain: normalizedDomain },
      });

      if (existingMerchant && existingMerchant.id !== id) {
        throw new ConflictException(
          `Merchant with domain "${normalizedDomain}" already exists`,
        );
      }

      updateData.domain = normalizedDomain;
    }

    if (updateMerchantDto.contact_email !== undefined) {
      updateData.contact_email = updateMerchantDto.contact_email.trim().toLowerCase();
    }

    if (updateMerchantDto.contact_phone !== undefined) {
      updateData.contact_phone = updateMerchantDto.contact_phone ? updateMerchantDto.contact_phone.trim() : null;
    }

    if (updateMerchantDto.rotation_interval !== undefined) {
      // Validate rotation_interval is a positive integer
      const interval = parseInt(String(updateMerchantDto.rotation_interval), 10);
      if (isNaN(interval) || interval < 1) {
        throw new BadRequestException('Rotation interval must be a positive integer');
      }
      updateData.rotation_interval = interval;
    }

    // Update merchant
    Object.assign(merchant, updateData);
    const updatedMerchant = await this.merchantRepository.save(merchant);

    // Log the action
    await this.logsService.createLog({
      module: LogModule.MERCHANTS,
      action: 'update',
      user_id: userId || null,
      entity_id: updatedMerchant.id,
      details: {
        domain: updatedMerchant.domain,
        contact_email: updatedMerchant.contact_email,
        contact_phone: updatedMerchant.contact_phone || null,
        rotation_interval: updatedMerchant.rotation_interval,
        updated_fields: Object.keys(updateData),
      },
      ip_address: ipAddress || null,
    });

    return updatedMerchant;
  }

  /**
   * Find merchant by domain (normalized)
   */
  async findByDomain(domain: string): Promise<Merchant | null> {
    if (!domain) {
      return null;
    }

    const normalizedDomain = this.normalizeDomain(domain);
    return await this.merchantRepository.findOne({
      where: { domain: normalizedDomain },
    });
  }
}

