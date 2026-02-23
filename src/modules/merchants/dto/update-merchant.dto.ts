import { IsString, IsEmail, IsOptional, IsInt, Min } from 'class-validator';

export class UpdateMerchantDto {
  @IsOptional()
  @IsString()
  domain?: string;

  @IsOptional()
  @IsEmail()
  contact_email?: string;

  @IsOptional()
  @IsString()
  contact_phone?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  rotation_interval?: number;
}

