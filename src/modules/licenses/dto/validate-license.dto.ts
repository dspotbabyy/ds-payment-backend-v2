import { IsString } from 'class-validator';

export class ValidateLicenseDto {
  @IsString()
  license_key: string;

  @IsString()
  domain: string;
}

