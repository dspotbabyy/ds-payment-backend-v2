import {
  IsNumber,
  IsOptional,
  IsString,
  IsEnum,
  IsDateString,
  Min,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethod } from '../../../database/entities/fee-payment.entity';

export class CreateFeePaymentDto {
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'merchant_id must be a valid number' })
  merchant_id: number;

  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'amount must be a valid number' })
  @Min(0.01, { message: 'amount must be greater than 0' })
  amount: number;

  @IsOptional()
  @IsDateString({}, { message: 'date must be a valid date in YYYY-MM-DD format' })
  date?: string;

  // For fees: period description
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'period must not exceed 255 characters' })
  period?: string;

  // For payments: payment reference
  @IsOptional()
  @IsString()
  @MaxLength(255, { message: 'reference must not exceed 255 characters' })
  reference?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'notes must not exceed 1000 characters' })
  notes?: string;

  // For payments only
  @ValidateIf((o) => o.reference !== undefined || o.method !== undefined)
  @IsOptional()
  @IsEnum(PaymentMethod, { message: 'method must be one of: etransfer, cheque, wire, cash' })
  method?: PaymentMethod;
}

