import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, LessThanOrEqual } from 'typeorm';
import { FeePayment, FeePaymentType, PaymentMethod } from '../../database/entities/fee-payment.entity';
import { Merchant } from '../../database/entities/merchant.entity';
import { CreateFeePaymentDto } from './dto/create-fee-payment.dto';
import { UpdateFeePaymentDto } from './dto/update-fee-payment.dto';
import { FilterFeePaymentsDto } from './dto/filter-fee-payments.dto';

@Injectable()
export class FeesPaymentsService {
  constructor(
    @InjectRepository(FeePayment)
    private feePaymentRepository: Repository<FeePayment>,
    @InjectRepository(Merchant)
    private merchantRepository: Repository<Merchant>,
  ) {}

  /**
   * Validate that date is not in the future
   */
  private validateDate(dateString: string): void {
    const date = new Date(dateString);
    const today = new Date();
    today.setHours(23, 59, 59, 999); // End of today

    if (date > today) {
      throw new BadRequestException('Date cannot be in the future');
    }
  }

  async create(createDto: CreateFeePaymentDto, userId?: number): Promise<{
    success: boolean;
    message: string;
    data: FeePayment;
  }> {
    const { merchant_id, amount, date, period, reference, notes, method } = createDto;

    // Validate merchant exists
    const merchant = await this.merchantRepository.findOne({
      where: { id: merchant_id },
    });

    if (!merchant) {
      throw new NotFoundException(`Merchant with ID ${merchant_id} not found`);
    }

    // Validate date if provided
    const entryDate = date ? new Date(date) : new Date();
    if (date) {
      this.validateDate(date);
    }

    // Determine type: if method or reference is provided, it's a payment; otherwise, it's a fee
    const isPayment = method !== undefined || reference !== undefined;
    const type = isPayment ? FeePaymentType.PAYMENT : FeePaymentType.FEE;

    // Validate and create entry
    if (type === FeePaymentType.FEE) {
      // Fee entry
      if (method) {
        throw new BadRequestException('Method cannot be provided for fee entries');
      }
      if (reference) {
        throw new BadRequestException('Reference cannot be provided for fee entries. Use period instead.');
      }

      const entry = this.feePaymentRepository.create({
        merchant_id,
        merchant_name: merchant.domain,
        type,
        amount,
        date: entryDate,
        period_reference: period || null,
        notes,
        method: null,
        created_by: userId || null,
      });

      const saved = await this.feePaymentRepository.save(entry);
      return {
        success: true,
        message: 'Fee created successfully',
        data: saved,
      };
    } else {
      // Payment entry
      if (period) {
        throw new BadRequestException('Period cannot be provided for payment entries. Use reference instead.');
      }

      const entry = this.feePaymentRepository.create({
        merchant_id,
        merchant_name: merchant.domain,
        type,
        amount,
        date: entryDate,
        period_reference: reference || null,
        notes,
        method: method || PaymentMethod.ETRANSFER, // Default to etransfer
        created_by: userId || null,
      });

      const saved = await this.feePaymentRepository.save(entry);
      return {
        success: true,
        message: 'Payment created successfully',
        data: saved,
      };
    }
  }

  async findAll(filterDto: FilterFeePaymentsDto): Promise<{
    success: boolean;
    message: string;
    data: FeePayment[];
    total: number;
    limit: number;
    offset: number;
  }> {
    const {
      merchant_id,
      type,
      start_date,
      end_date,
      limit = 50,
      offset = 0,
    } = filterDto;

    const queryBuilder = this.feePaymentRepository.createQueryBuilder('fp');

    if (merchant_id) {
      queryBuilder.andWhere('fp.merchant_id = :merchant_id', { merchant_id });
    }

    if (type) {
      queryBuilder.andWhere('fp.type = :type', { type });
    }

    if (start_date && end_date) {
      queryBuilder.andWhere('fp.date BETWEEN :start_date AND :end_date', {
        start_date,
        end_date,
      });
    } else if (start_date) {
      queryBuilder.andWhere('fp.date >= :start_date', { start_date });
    } else if (end_date) {
      queryBuilder.andWhere('fp.date <= :end_date', { end_date });
    }

    queryBuilder.orderBy('fp.date', 'DESC').addOrderBy('fp.created_at', 'DESC');

    const [data, total] = await queryBuilder
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    return {
      success: true,
      message: 'Fees and payments retrieved successfully',
      data,
      total,
      limit,
      offset,
    };
  }

  async findOne(id: number): Promise<{
    success: boolean;
    message: string;
    data: FeePayment;
  }> {
    const entry = await this.feePaymentRepository.findOne({
      where: { id },
    });

    if (!entry) {
      throw new NotFoundException(`Entry with ID ${id} not found`);
    }

    return {
      success: true,
      message: 'Entry retrieved successfully',
      data: entry,
    };
  }

  async update(
    id: number,
    updateDto: UpdateFeePaymentDto,
    userId?: number,
  ): Promise<{
    success: boolean;
    message: string;
    data: FeePayment;
  }> {
    const entry = await this.feePaymentRepository.findOne({
      where: { id },
    });

    if (!entry) {
      throw new NotFoundException(`Entry with ID ${id} not found`);
    }

    // Validate date if provided
    if (updateDto.date) {
      this.validateDate(updateDto.date);
    }

    // Update fields
    if (updateDto.amount !== undefined) {
      entry.amount = updateDto.amount;
    }

    if (updateDto.date !== undefined) {
      entry.date = new Date(updateDto.date);
    }

    if (updateDto.notes !== undefined) {
      entry.notes = updateDto.notes;
    }

    // Handle period_reference based on type
    if (entry.type === FeePaymentType.FEE) {
      if (updateDto.period !== undefined) {
        entry.period_reference = updateDto.period;
      }
      // Ensure method is null for fees
      if (updateDto.method) {
        throw new BadRequestException('Method cannot be set for fee entries');
      }
    } else {
      // Payment type
      if (updateDto.reference !== undefined) {
        entry.period_reference = updateDto.reference;
      }
      if (updateDto.method !== undefined) {
        entry.method = updateDto.method;
      }
      // If period is provided for payment, ignore it (or throw error)
      if (updateDto.period !== undefined) {
        throw new BadRequestException('Period cannot be set for payment entries. Use reference instead.');
      }
    }

    const saved = await this.feePaymentRepository.save(entry);
    return {
      success: true,
      message: 'Entry updated successfully',
      data: saved,
    };
  }

  async remove(id: number): Promise<{
    success: boolean;
    message: string;
  }> {
    const entry = await this.feePaymentRepository.findOne({
      where: { id },
    });

    if (!entry) {
      throw new NotFoundException(`Entry with ID ${id} not found`);
    }

    await this.feePaymentRepository.remove(entry);

    return {
      success: true,
      message: 'Entry deleted successfully',
    };
  }

  async getStatistics(filterDto: {
    merchant_id?: number;
    start_date?: string;
    end_date?: string;
  }): Promise<{
    success: boolean;
    message: string;
    data: {
      total_fees: number;
      total_payments: number;
      outstanding_balance: number;
    };
  }> {
    const { merchant_id, start_date, end_date } = filterDto;

    const queryBuilder = this.feePaymentRepository.createQueryBuilder('fp');

    if (merchant_id) {
      queryBuilder.andWhere('fp.merchant_id = :merchant_id', { merchant_id });
    }

    if (start_date && end_date) {
      queryBuilder.andWhere('fp.date BETWEEN :start_date AND :end_date', {
        start_date,
        end_date,
      });
    } else if (start_date) {
      queryBuilder.andWhere('fp.date >= :start_date', { start_date });
    } else if (end_date) {
      queryBuilder.andWhere('fp.date <= :end_date', { end_date });
    }

    // Get all entries matching filters
    const entries = await queryBuilder.getMany();

    // Calculate statistics
    const total_fees = entries
      .filter((e) => e.type === FeePaymentType.FEE)
      .reduce((sum, e) => sum + Number(e.amount), 0);

    const total_payments = entries
      .filter((e) => e.type === FeePaymentType.PAYMENT)
      .reduce((sum, e) => sum + Number(e.amount), 0);

    const outstanding_balance = total_fees - total_payments;

    return {
      success: true,
      message: 'Statistics retrieved successfully',
      data: {
        total_fees: Number(total_fees.toFixed(2)),
        total_payments: Number(total_payments.toFixed(2)),
        outstanding_balance: Number(outstanding_balance.toFixed(2)),
      },
    };
  }
}

