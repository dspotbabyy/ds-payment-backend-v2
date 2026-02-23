import { IsOptional, IsBoolean } from 'class-validator';

export class FilterLicensesDto {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}

