import { IsEmail, IsNumber, IsOptional, IsString, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class UpdateOrderDto {
  @IsOptional()
  @IsString()
  woo_order_id?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false }, { message: 'total must be a valid number' })
  @Min(0, { message: 'total must not be less than 0' })
  total?: number;

  @IsOptional()
  @IsString()
  customer_name?: string;

  @IsOptional()
  @Transform(({ value }) => {
    if (!value || typeof value !== 'string') {
      return value;
    }
    return value.trim().toLowerCase();
  })
  @IsEmail({}, { message: 'customer_email must be a valid email address' })
  customer_email?: string;

  @IsOptional()
  @IsString()
  address?: string; // Customer address

  @IsOptional()
  @IsString()
  phone_number?: string; // Customer phone number

  @IsOptional()
  @IsString()
  id_card_image?: string; // ID card image URL or base64 (optional)

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsEmail()
  merchant_email?: string;

  @IsOptional()
  @IsString()
  domain?: string; // Website domain using the plugin

  @IsOptional()
  @IsString()
  location?: string; // Customer location

  @IsOptional()
  @IsString()
  country?: string; // Customer country

  @IsOptional()
  @IsString()
  province_territory?: string; // Province or territory

  @IsOptional()
  @IsString()
  city?: string; // City
}

