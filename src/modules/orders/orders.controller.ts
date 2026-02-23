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
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { FilterOrdersDto } from './dto/filter-orders.dto';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

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
  @HttpCode(HttpStatus.CREATED)
  async create(@Request() request: any, @Body() createOrderDto: CreateOrderDto, @Query('license_key') licenseKey?: string) {
    // Automatically detect IP address from request (always auto-detect, never trust client-provided IP)
    const detectedIp = this.getClientIp(request);
    
    // Get license key from query params first, then from raw request body as fallback
    // Note: We use request.body because license_key is not in the DTO, so it won't be in createOrderDto
    const finalLicenseKey = licenseKey || request.body?.license_key;
    
    console.log('[OrdersController] Create order request:', {
      hasQueryLicenseKey: !!licenseKey,
      queryLicenseKey: licenseKey,
      hasBodyLicenseKey: !!request.body?.license_key,
      bodyLicenseKey: request.body?.license_key,
      finalLicenseKey: finalLicenseKey ? `${finalLicenseKey.substring(0, 5)}...` : 'missing',
      domain: createOrderDto.domain,
      queryParams: request.query,
      bodyKeys: request.body ? Object.keys(request.body) : [],
    });
    
    // Create order with auto-detected IP and license key validation
    return this.ordersService.create(createOrderDto, detectedIp, finalLicenseKey);
  }

  @Get()
  async findAll() {
    return this.ordersService.findAll();
  }

  @Get('my-orders')
  async findMyOrders(@Query('user_email') userEmail: string) {
    return this.ordersService.findMyOrders(userEmail);
  }

  @Get('filtered')
  async findFiltered(@Query() filterDto: FilterOrdersDto) {
    return this.ordersService.findFiltered(filterDto);
  }

  @Get('summary/accounts')
  async getSummaryByAccounts(
    @Query('user_email') userEmail: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
    @Query('date') date?: string,
  ) {
    return this.ordersService.getSummaryByAccounts(userEmail, {
      start_date: startDate,
      end_date: endDate,
      date,
    });
  }

  @Get('summary/days')
  async getSummaryByDays(
    @Query('user_email') userEmail: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    return this.ordersService.getSummaryByDays(userEmail, {
      start_date: startDate,
      end_date: endDate,
    });
  }

  @Get('stats/merchant')
  async getStatsByMerchant() {
    return this.ordersService.getStatsByMerchant();
  }

  @Get('stats')
  async getStatistics() {
    return this.ordersService.getStatistics();
  }

  @Get(':id')
  async findOne(
    @Param('id', ParseIntPipe) id: number,
    @Query('user_email') userEmail: string,
    @Query('license_key') licenseKey?: string,
    @Request() request?: any,
  ) {
    // Get license key from query params first, then from body as fallback
    const finalLicenseKey = licenseKey || (request?.body as any)?.license_key;
    return this.ordersService.findOne(id, userEmail, finalLicenseKey);
  }

  @Get(':id/check-status')
  async checkPaymentStatus(
    @Param('id', ParseIntPipe) id: number,
    @Query('user_email') userEmail: string,
    @Query('license_key') licenseKey?: string,
    @Request() request?: any,
  ) {
    // Get license key from query params first, then from body as fallback
    const finalLicenseKey = licenseKey || (request?.body as any)?.license_key;
    return this.ordersService.checkPaymentStatus(id, userEmail, finalLicenseKey);
  }

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateOrderDto: UpdateOrderDto,
    @Query('user_email') userEmail: string,
    @Query('license_key') licenseKey?: string,
    @Request() request?: any,
  ) {
    // Get license key from query params first, then from raw request body as fallback
    const finalLicenseKey = licenseKey || request?.body?.license_key;
    return this.ordersService.update(id, updateOrderDto, userEmail, finalLicenseKey);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Query('user_email') userEmail: string,
  ) {
    return this.ordersService.remove(id, userEmail);
  }
}
