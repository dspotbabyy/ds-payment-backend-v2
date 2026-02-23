import { IsEmail, IsString, IsOptional, IsBoolean, IsInt, Min, Max } from 'class-validator';

export class CreateBankRecipientEmailDto {
  @IsEmail({}, { message: 'Invalid email format' })
  email: string;

  @IsOptional()
  @IsString()
  bank_name?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(999)
  priority?: number;
}

