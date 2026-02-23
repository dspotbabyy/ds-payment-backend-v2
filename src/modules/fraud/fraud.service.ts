import {
  Injectable,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FraudRule, FraudRuleType } from '../../database/entities/fraud-rule.entity';
import { CreateFraudRuleDto } from './dto/create-fraud-rule.dto';
import { UpdateFraudRuleDto } from './dto/update-fraud-rule.dto';
import { FilterFraudRulesDto } from './dto/filter-fraud-rules.dto';
import { LogsService } from '../logs/logs.service';
import { LogModule } from '../../database/entities/log.entity';

@Injectable()
export class FraudService {
  constructor(
    @InjectRepository(FraudRule)
    private fraudRuleRepository: Repository<FraudRule>,
    private logsService: LogsService,
  ) {}

  async create(createFraudRuleDto: CreateFraudRuleDto): Promise<FraudRule> {
    const { type, value, reason, is_active } = createFraudRuleDto;

    // Validate value based on type
    this.validateFraudRuleValue(type, value);

    // Normalize value based on type
    const normalizedValue = this.normalizeValue(type, value);

    // Check if rule already exists
    const existingRule = await this.fraudRuleRepository.findOne({
      where: { type, value: normalizedValue },
    });

    if (existingRule) {
      throw new ConflictException(
        `Fraud rule with type "${type}" and value "${normalizedValue}" already exists`,
      );
    }

    // Create fraud rule
    const fraudRule = this.fraudRuleRepository.create({
      type,
      value: normalizedValue,
      reason: reason || null,
      is_active: is_active !== undefined ? is_active : true,
    });

    const savedRule = await this.fraudRuleRepository.save(fraudRule);

    // Log fraud rule creation
    this.logsService
      .createLog({
        module: LogModule.FRAUD,
        action: 'create',
        entity_id: savedRule.id,
        details: {
          fraud_rule_id: savedRule.id,
          type: savedRule.type,
          value: savedRule.value,
          is_active: savedRule.is_active,
        },
      })
      .catch((err) => console.error('Error logging fraud rule creation:', err));

    return savedRule;
  }

  async findAll(filterDto?: FilterFraudRulesDto): Promise<FraudRule[]> {
    const queryBuilder = this.fraudRuleRepository.createQueryBuilder('fraud_rule');

    if (filterDto) {
      if (filterDto.type) {
        queryBuilder.andWhere('fraud_rule.type = :type', { type: filterDto.type });
      }
      if (filterDto.is_active !== undefined) {
        queryBuilder.andWhere('fraud_rule.is_active = :is_active', {
          is_active: filterDto.is_active,
        });
      }
    }

    return queryBuilder.orderBy('fraud_rule.created_at', 'DESC').getMany();
  }

  async findOne(id: number): Promise<FraudRule> {
    const fraudRule = await this.fraudRuleRepository.findOne({
      where: { id },
    });

    if (!fraudRule) {
      throw new NotFoundException(`Fraud rule with ID ${id} not found`);
    }

    return fraudRule;
  }

  async update(id: number, updateFraudRuleDto: UpdateFraudRuleDto): Promise<FraudRule> {
    const fraudRule = await this.findOne(id);

    const { type, value, reason, is_active } = updateFraudRuleDto;

    // If type or value is being updated, validate and normalize
    if (type || value) {
      const finalType = type || fraudRule.type;
      const finalValue = value || fraudRule.value;

      this.validateFraudRuleValue(finalType, finalValue);
      const normalizedValue = this.normalizeValue(finalType, finalValue);

      // Check if another rule with same type and value exists
      const existingRule = await this.fraudRuleRepository.findOne({
        where: { type: finalType, value: normalizedValue },
      });

      if (existingRule && existingRule.id !== id) {
        throw new ConflictException(
          `Fraud rule with type "${finalType}" and value "${normalizedValue}" already exists`,
        );
      }

      if (type) fraudRule.type = finalType;
      if (value) fraudRule.value = normalizedValue;
    }

    if (reason !== undefined) fraudRule.reason = reason;
    if (is_active !== undefined) fraudRule.is_active = is_active;

    const updatedRule = await this.fraudRuleRepository.save(fraudRule);

    // Log fraud rule update
    this.logsService
      .createLog({
        module: LogModule.FRAUD,
        action: 'update',
        entity_id: id,
        details: {
          fraud_rule_id: id,
          updated_fields: Object.keys(updateFraudRuleDto),
        },
      })
      .catch((err) => console.error('Error logging fraud rule update:', err));

    return updatedRule;
  }

  async remove(id: number): Promise<void> {
    const fraudRule = await this.findOne(id);
    
    // Log fraud rule deletion
    this.logsService
      .createLog({
        module: LogModule.FRAUD,
        action: 'delete',
        entity_id: id,
        details: {
          fraud_rule_id: id,
          type: fraudRule.type,
          value: fraudRule.value,
        },
      })
      .catch((err) => console.error('Error logging fraud rule deletion:', err));

    await this.fraudRuleRepository.remove(fraudRule);
  }

  // Check if an IP, domain, or email matches any active fraud rule
  async checkFraud(type: FraudRuleType, value: string): Promise<FraudRule | null> {
    const normalizedValue = this.normalizeValue(type, value);

    return this.fraudRuleRepository.findOne({
      where: {
        type,
        value: normalizedValue,
        is_active: true,
      },
    });
  }

  // Validate value based on type
  private validateFraudRuleValue(type: FraudRuleType, value: string): void {
    if (!value || value.trim().length === 0) {
      throw new BadRequestException('Value cannot be empty');
    }

    switch (type) {
      case FraudRuleType.IP_ADDRESS:
        // Basic IP validation (IPv4 or IPv6)
        const ipRegex =
          /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$|^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
        if (!ipRegex.test(value.trim())) {
          throw new BadRequestException('Invalid IP address format');
        }
        break;

      case FraudRuleType.EMAIL:
        // Basic email validation
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(value.trim())) {
          throw new BadRequestException('Invalid email format');
        }
        break;

      case FraudRuleType.CUSTOMER_NAME:
      case FraudRuleType.LOCATION:
      case FraudRuleType.COUNTRY:
      case FraudRuleType.PROVINCE:
      case FraudRuleType.CITY:
        // These are text fields, just ensure they're not empty
        if (value.trim().length === 0) {
          throw new BadRequestException(`${type} value cannot be empty`);
        }
        break;
    }
  }

  // Normalize value based on type (lowercase, trim, etc.)
  private normalizeValue(type: FraudRuleType, value: string): string {
    const trimmed = value.trim();

    switch (type) {
      case FraudRuleType.IP_ADDRESS:
        return trimmed.toLowerCase();
      case FraudRuleType.EMAIL:
        return trimmed.toLowerCase();
      case FraudRuleType.CUSTOMER_NAME:
      case FraudRuleType.LOCATION:
      case FraudRuleType.COUNTRY:
      case FraudRuleType.PROVINCE:
      case FraudRuleType.CITY:
        // Normalize text fields: lowercase, trim, and handle multiple spaces
        return trimmed.toLowerCase().replace(/\s+/g, ' ').trim();
      default:
        return trimmed;
    }
  }
}

