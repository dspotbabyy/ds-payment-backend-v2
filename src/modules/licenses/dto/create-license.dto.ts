import { IsString, IsOptional, IsDateString, IsBoolean } from 'class-validator';

export class CreateLicenseDto {
  @IsString()
  domain: string;

  @IsOptional()
  @IsDateString()
  expiry_date?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

