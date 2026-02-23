import { IsEmail, IsOptional, IsString } from 'class-validator';

export class FilterOrdersDto {
  @IsEmail()
  user_email: string;

  @IsOptional()
  @IsString()
  start_date?: string;

  @IsOptional()
  @IsString()
  end_date?: string;

  @IsOptional()
  @IsString()
  date?: string;

  @IsOptional()
  @IsString()
  status?: string;
}

