import { IsOptional, IsNumber, IsString, IsEnum, IsDateString, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { FeePaymentType } from '../../../database/entities/fee-payment.entity';

export class FilterFeePaymentsDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  merchant_id?: number;

  @IsOptional()
  @IsEnum(FeePaymentType)
  type?: FeePaymentType;

  @IsOptional()
  @IsDateString({}, { message: 'start_date must be a valid date in YYYY-MM-DD format' })
  start_date?: string;

  @IsOptional()
  @IsDateString({}, { message: 'end_date must be a valid date in YYYY-MM-DD format' })
  end_date?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  offset?: number;
}

