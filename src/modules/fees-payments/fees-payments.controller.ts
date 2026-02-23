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
  UseGuards,
  Request,
} from '@nestjs/common';
import { FeesPaymentsService } from './fees-payments.service';
import { CreateFeePaymentDto } from './dto/create-fee-payment.dto';
import { UpdateFeePaymentDto } from './dto/update-fee-payment.dto';
import { FilterFeePaymentsDto } from './dto/filter-fee-payments.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('fees-payments')
export class FeesPaymentsController {
  constructor(private readonly feesPaymentsService: FeesPaymentsService) {}

  @Get('statistics')
  async getStatistics(
    @Query('merchant_id') merchantId?: string,
    @Query('start_date') startDate?: string,
    @Query('end_date') endDate?: string,
  ) {
    const filterDto: any = {};
    if (merchantId) {
      filterDto.merchant_id = parseInt(merchantId, 10);
    }
    if (startDate) {
      filterDto.start_date = startDate;
    }
    if (endDate) {
      filterDto.end_date = endDate;
    }
    return this.feesPaymentsService.getStatistics(filterDto);
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  async findAll(@Query() filterDto: FilterFeePaymentsDto) {
    return this.feesPaymentsService.findAll(filterDto);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(@Param('id', ParseIntPipe) id: number) {
    return this.feesPaymentsService.findOne(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(@Request() req: any, @Body() createDto: CreateFeePaymentDto) {
    const userId = req.user?.id;
    return this.feesPaymentsService.create(createDto, userId);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Request() req: any,
    @Body() updateDto: UpdateFeePaymentDto,
  ) {
    const userId = req.user?.id;
    return this.feesPaymentsService.update(id, updateDto, userId);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id', ParseIntPipe) id: number) {
    return this.feesPaymentsService.remove(id);
  }
}

