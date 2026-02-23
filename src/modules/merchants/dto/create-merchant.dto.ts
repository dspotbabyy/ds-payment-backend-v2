import { IsString, IsEmail, IsOptional } from 'class-validator';

export class CreateMerchantDto {
  @IsString()
  domain: string;

  @IsEmail()
  contact_email: string;

  @IsOptional()
  @IsString()
  contact_phone?: string;
}

