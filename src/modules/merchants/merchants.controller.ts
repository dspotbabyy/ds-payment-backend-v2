import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  ParseIntPipe,
  HttpCode,
  HttpStatus,
  Request,
  UseGuards,
} from '@nestjs/common';
import { MerchantsService } from './merchants.service';
import { BankRecipientEmailsService } from './bank-recipient-emails.service';
import { CreateMerchantDto } from './dto/create-merchant.dto';
import { UpdateMerchantDto } from './dto/update-merchant.dto';
import { FilterMerchantsDto } from './dto/filter-merchants.dto';
import { CreateBankRecipientEmailDto } from './dto/create-bank-recipient-email.dto';
import { UpdateBankRecipientEmailDto } from './dto/update-bank-recipient-email.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('merchants')
export class MerchantsController {
  constructor(
    private readonly merchantsService: MerchantsService,
    private readonly bankRecipientEmailsService: BankRecipientEmailsService,
  ) {}

  /**
   * Extract IP address from request headers
   * Handles proxies and load balancers (x-forwarded-for, x-real-ip)
   */
  private getClientIp(request: any): string | null {
    // Check x-forwarded-for header (for proxies/load balancers)
    const forwardedFor = request.headers['x-forwarded-for'];
    if (forwardedFor) {
      // x-forwarded-for can contain multiple IPs, take the first one
      const ips = forwardedFor.split(',');
      return ips[0].trim();
    }

    // Check x-real-ip header (common in nginx)
    const realIp = request.headers['x-real-ip'];
    if (realIp) {
      return realIp.trim();
    }

    // Fallback to request IP
    if (request.ip) {
      return request.ip;
    }

    // Fallback to connection remoteAddress
    if (request.connection && request.connection.remoteAddress) {
      return request.connection.remoteAddress;
    }

    return null;
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Request() request: any,
    @Body() createMerchantDto: CreateMerchantDto,
  ) {
    const ipAddress = this.getClientIp(request);
    const userId = request.user?.sub;

    const merchant = await this.merchantsService.create(
      createMerchantDto,
      userId,
      ipAddress,
    );

    return {
      success: true,
      message: 'Merchant registered successfully',
      data: merchant,
    };
  }

  @Get()
  async findAll(@Query() filterDto: FilterMerchantsDto) {
    const result = await this.merchantsService.findAll(filterDto);
    return {
      success: true,
      message: 'Merchants retrieved successfully',
      data: result.data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    };
  }

  @Get(':id')
  async findOne(@Param('id', ParseIntPipe) id: number) {
    const merchant = await this.merchantsService.findOne(id);
    return {
      success: true,
      message: 'Merchant retrieved successfully',
      data: merchant,
    };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async update(
    @Request() request: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() updateMerchantDto: UpdateMerchantDto,
  ) {
    const ipAddress = this.getClientIp(request);
    const userId = request.user?.sub;

    const merchant = await this.merchantsService.update(
      id,
      updateMerchantDto,
      userId,
      ipAddress,
    );

    return {
      success: true,
      message: 'Merchant updated successfully',
      data: merchant,
    };
  }

  // Bank Recipient Email Endpoints

  /**
   * Create a bank recipient email for a merchant
   */
  @Post(':merchantId/bank-recipient-emails')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createBankRecipientEmail(
    @Request() request: any,
    @Param('merchantId', ParseIntPipe) merchantId: number,
    @Body() createDto: CreateBankRecipientEmailDto,
  ) {
    const ipAddress = this.getClientIp(request);
    const userId = request.user?.sub;

    // Pass merchant_id as separate parameter
    const bankRecipientEmail = await this.bankRecipientEmailsService.create(
      merchantId,
      createDto,
      userId,
      ipAddress,
    );

    return {
      success: true,
      message: 'Bank recipient email created successfully',
      data: bankRecipientEmail,
    };
  }

  /**
   * Get all bank recipient emails for a merchant
   */
  @Get(':merchantId/bank-recipient-emails')
  @UseGuards(JwtAuthGuard)
  async getBankRecipientEmails(
    @Param('merchantId', ParseIntPipe) merchantId: number,
  ) {
    const result = await this.bankRecipientEmailsService.findByMerchant(
      merchantId,
    );

    return {
      success: true,
      message: 'Bank recipient emails retrieved successfully',
      data: {
        emails: result.emails,
        rotation_info: {
          total_completed_orders: result.total_completed_orders,
          current_email_index: result.current_email_index,
          current_email: result.current_email,
          next_email_index: result.next_email_index,
          next_email: result.next_email,
          orders_until_next_rotation: result.orders_until_next_rotation,
          rotation_interval: result.rotation_interval,
        },
      },
      count: result.emails.length,
    };
  }

  /**
   * Get a single bank recipient email by ID
   */
  @Get('bank-recipient-emails/:id')
  @UseGuards(JwtAuthGuard)
  async getBankRecipientEmail(@Param('id', ParseIntPipe) id: number) {
    const email = await this.bankRecipientEmailsService.findOne(id);

    return {
      success: true,
      message: 'Bank recipient email retrieved successfully',
      data: email,
    };
  }

  /**
   * Update a bank recipient email
   */
  @Put('bank-recipient-emails/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async updateBankRecipientEmail(
    @Request() request: any,
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateBankRecipientEmailDto,
  ) {
    const ipAddress = this.getClientIp(request);
    const userId = request.user?.sub;

    const email = await this.bankRecipientEmailsService.update(
      id,
      updateDto,
      userId,
      ipAddress,
    );

    return {
      success: true,
      message: 'Bank recipient email updated successfully',
      data: email,
    };
  }

  /**
   * Delete a bank recipient email
   */
  @Delete('bank-recipient-emails/:id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async deleteBankRecipientEmail(
    @Request() request: any,
    @Param('id', ParseIntPipe) id: number,
  ) {
    const ipAddress = this.getClientIp(request);
    const userId = request.user?.sub;

    await this.bankRecipientEmailsService.remove(id, userId, ipAddress);

    return {
      success: true,
      message: 'Bank recipient email deleted successfully',
      data: { id },
    };
  }

  /**
   * Get current recipient bank email by license key
   * Public endpoint for WooCommerce plugin to get the current recipient email
   */
  @Get('bank-recipient-email/current')
  async getCurrentRecipientEmailByLicenseKey(
    @Query('license_key') licenseKey: string,
  ) {
    const result =
      await this.bankRecipientEmailsService.getCurrentRecipientEmailByLicenseKey(
        licenseKey,
      );

    return {
      success: true,
      message: 'Current recipient email retrieved successfully',
      data: result,
    };
  }
}

