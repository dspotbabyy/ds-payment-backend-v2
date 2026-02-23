import { IsEnum, IsOptional, IsBoolean } from 'class-validator';
import { FraudRuleType } from '../../../database/entities/fraud-rule.entity';

export class FilterFraudRulesDto {
  @IsOptional()
  @IsEnum(FraudRuleType)
  type?: FraudRuleType;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

