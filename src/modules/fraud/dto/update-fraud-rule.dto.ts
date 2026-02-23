import { IsEnum, IsString, IsOptional, IsBoolean } from 'class-validator';
import { FraudRuleType } from '../../../database/entities/fraud-rule.entity';

export class UpdateFraudRuleDto {
  @IsOptional()
  @IsEnum(FraudRuleType)
  type?: FraudRuleType;

  @IsOptional()
  @IsString()
  value?: string;

  @IsOptional()
  @IsString()
  reason?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

