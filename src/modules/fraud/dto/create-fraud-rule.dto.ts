import { IsEnum, IsString, IsOptional, IsBoolean } from 'class-validator';
import { FraudRuleType } from '../../../database/entities/fraud-rule.entity';

export class CreateFraudRuleDto {
  @IsEnum(FraudRuleType)
  type: FraudRuleType;

  @IsString()
  value: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

