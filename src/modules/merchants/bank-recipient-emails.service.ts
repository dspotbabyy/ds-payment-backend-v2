import {
  Injectable,
  NotFoundException,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BankRecipientEmail } from '../../database/entities/bank-recipient-email.entity';
import { Merchant } from '../../database/entities/merchant.entity';
import { Order } from '../../database/entities/order.entity';
import { CreateBankRecipientEmailDto } from './dto/create-bank-recipient-email.dto';
import { UpdateBankRecipientEmailDto } from './dto/update-bank-recipient-email.dto';
import { LogsService } from '../logs/logs.service';
import { LicensesService } from '../licenses/licenses.service';
import { MerchantsService } from './merchants.service';
import { LogModule } from '../../database/entities/log.entity';

@Injectable()
export class BankRecipientEmailsService {
  constructor(
    @InjectRepository(BankRecipientEmail)
    private bankRecipientEmailRepository: Repository<BankRecipientEmail>,
    @InjectRepository(Merchant)
    private merchantRepository: Repository<Merchant>,
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    private logsService: LogsService,
    private licensesService: LicensesService,
    private merchantsService: MerchantsService,
  ) {}

  /**
   * Validate email format
   */
  private validateEmail(email: string): void {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new BadRequestException('Invalid email format');
    }
  }

  /**
   * Create a new bank recipient email
   */
  async create(
    merchantId: number,
    createDto: CreateBankRecipientEmailDto,
    userId?: number,
    ipAddress?: string,
  ): Promise<BankRecipientEmail> {
    const { email, bank_name, is_active, priority } = createDto;
    const merchant_id = merchantId;

    // Validate merchant exists
    const merchant = await this.merchantRepository.findOne({
      where: { id: merchant_id },
    });

    if (!merchant) {
      throw new NotFoundException(`Merchant with ID ${merchant_id} not found`);
    }

    // Validate email format
    this.validateEmail(email);

    // Normalize email
    const normalizedEmail = email.trim().toLowerCase();

    // Check if email already exists for this merchant
    const existingEmail = await this.bankRecipientEmailRepository.findOne({
      where: {
        merchant_id,
        email: normalizedEmail,
      },
    });

    if (existingEmail) {
      throw new BadRequestException(
        `Email ${normalizedEmail} already exists for this merchant`,
      );
    }

    // Create bank recipient email
    const bankRecipientEmail = this.bankRecipientEmailRepository.create({
      merchant_id,
      email: normalizedEmail,
      bank_name: bank_name?.trim() || null,
      is_active: is_active !== undefined ? is_active : true,
      priority: priority !== undefined ? priority : 0,
    });

    const savedEmail = await this.bankRecipientEmailRepository.save(
      bankRecipientEmail,
    );

    // Log the action
    await this.logsService.createLog({
      module: LogModule.MERCHANTS,
      action: 'create_bank_recipient_email',
      user_id: userId || null,
      entity_id: savedEmail.id,
      details: {
        merchant_id: savedEmail.merchant_id,
        email: savedEmail.email,
        bank_name: savedEmail.bank_name || null,
        is_active: savedEmail.is_active,
        priority: savedEmail.priority,
      },
      ip_address: ipAddress || null,
    });

    return savedEmail;
  }

  /**
   * Get all bank recipient emails for a merchant with order statistics
   */
  async findByMerchant(merchantId: number): Promise<{
    emails: Array<BankRecipientEmail & { completed_orders_count: number }>;
    total_completed_orders: number;
    current_email_index: number;
    current_email: BankRecipientEmail | null;
    next_email_index: number;
    next_email: BankRecipientEmail | null;
    orders_until_next_rotation: number;
    rotation_interval: number;
  }> {
    // Validate merchant exists
    const merchant = await this.merchantRepository.findOne({
      where: { id: merchantId },
    });

    if (!merchant) {
      throw new NotFoundException(`Merchant with ID ${merchantId} not found`);
    }

    // Get all bank recipient emails for this merchant
    const emails = await this.bankRecipientEmailRepository.find({
      where: { merchant_id: merchantId },
      order: { priority: 'ASC', created_at: 'DESC' },
    });

    // Get merchant domain to filter orders
    const merchantDomain = merchant.domain;

    // Count completed orders per email
    const emailsWithCounts = await Promise.all(
      emails.map(async (email) => {
        const completedOrdersCount = await this.orderRepository.count({
          where: {
            domain: merchantDomain,
            merchant_email: email.email,
            status: 'completed',
          },
        });

        return {
          ...email,
          completed_orders_count: completedOrdersCount,
        };
      }),
    );

    // Calculate total completed orders for this merchant
    const totalCompletedOrders = await this.orderRepository.count({
      where: {
        domain: merchantDomain,
        status: 'completed',
      },
    });

    // Use merchant's rotation_interval (default to 5 if not set)
    const ROTATION_INTERVAL = merchant.rotation_interval || 5;
    const activeEmails = emailsWithCounts.filter((e) => e.is_active);
    
    let currentEmailIndex = 0;
    let currentEmail: BankRecipientEmail | null = null;
    let nextEmailIndex = 0;
    let nextEmail: BankRecipientEmail | null = null;
    let ordersUntilNextRotation = 0;

    if (activeEmails.length > 0) {
      // Calculate which email index is currently being used
      // Formula: (total_completed_orders / ROTATION_INTERVAL) % number_of_active_emails
      const currentRotationIndex = Math.floor(totalCompletedOrders / ROTATION_INTERVAL);
      currentEmailIndex = currentRotationIndex % activeEmails.length;
      currentEmail = activeEmails[currentEmailIndex];

      // Calculate which email will be used next (after current rotation completes)
      nextEmailIndex = (currentEmailIndex + 1) % activeEmails.length;
      nextEmail = activeEmails[nextEmailIndex];

      // Calculate how many more orders until next rotation
      const ordersInCurrentRotation = totalCompletedOrders % ROTATION_INTERVAL;
      ordersUntilNextRotation = ROTATION_INTERVAL - ordersInCurrentRotation;
    }

    return {
      emails: emailsWithCounts,
      total_completed_orders: totalCompletedOrders,
      current_email_index: currentEmailIndex,
      current_email: currentEmail,
      next_email_index: nextEmailIndex,
      next_email: nextEmail,
      orders_until_next_rotation: ordersUntilNextRotation,
      rotation_interval: ROTATION_INTERVAL,
    };
  }

  /**
   * Get a single bank recipient email by ID
   */
  async findOne(id: number): Promise<BankRecipientEmail> {
    const bankRecipientEmail = await this.bankRecipientEmailRepository.findOne({
      where: { id },
      relations: ['merchant'],
    });

    if (!bankRecipientEmail) {
      throw new NotFoundException(
        `Bank recipient email with ID ${id} not found`,
      );
    }

    return bankRecipientEmail;
  }

  /**
   * Update a bank recipient email
   */
  async update(
    id: number,
    updateDto: UpdateBankRecipientEmailDto,
    userId?: number,
    ipAddress?: string,
  ): Promise<BankRecipientEmail> {
    const bankRecipientEmail = await this.findOne(id);

    const updateData: Partial<BankRecipientEmail> = {};

    if (updateDto.email !== undefined) {
      this.validateEmail(updateDto.email);
      const normalizedEmail = updateDto.email.trim().toLowerCase();

      // Check if email already exists for this merchant (excluding current record)
      const existingEmail = await this.bankRecipientEmailRepository.findOne({
        where: {
          merchant_id: bankRecipientEmail.merchant_id,
          email: normalizedEmail,
        },
      });

      if (existingEmail && existingEmail.id !== id) {
        throw new BadRequestException(
          `Email ${normalizedEmail} already exists for this merchant`,
        );
      }

      updateData.email = normalizedEmail;
    }

    if (updateDto.bank_name !== undefined) {
      updateData.bank_name = updateDto.bank_name.trim() || null;
    }

    if (updateDto.is_active !== undefined) {
      updateData.is_active = updateDto.is_active;
    }

    if (updateDto.priority !== undefined) {
      updateData.priority = updateDto.priority;
    }

    // Update bank recipient email
    Object.assign(bankRecipientEmail, updateData);
    const updatedEmail = await this.bankRecipientEmailRepository.save(
      bankRecipientEmail,
    );

    // Log the action
    await this.logsService.createLog({
      module: LogModule.MERCHANTS,
      action: 'update_bank_recipient_email',
      user_id: userId || null,
      entity_id: updatedEmail.id,
      details: {
        merchant_id: updatedEmail.merchant_id,
        email: updatedEmail.email,
        bank_name: updatedEmail.bank_name || null,
        is_active: updatedEmail.is_active,
        priority: updatedEmail.priority,
        updated_fields: Object.keys(updateData),
      },
      ip_address: ipAddress || null,
    });

    return updatedEmail;
  }

  /**
   * Delete a bank recipient email
   */
  async remove(id: number, userId?: number, ipAddress?: string): Promise<void> {
    const bankRecipientEmail = await this.findOne(id);

    await this.bankRecipientEmailRepository.remove(bankRecipientEmail);

    // Log the action
    await this.logsService.createLog({
      module: LogModule.MERCHANTS,
      action: 'delete_bank_recipient_email',
      user_id: userId || null,
      entity_id: id,
      details: {
        merchant_id: bankRecipientEmail.merchant_id,
        email: bankRecipientEmail.email,
        bank_name: bankRecipientEmail.bank_name || null,
      },
      ip_address: ipAddress || null,
    });
  }

  /**
   * Get active bank recipient emails for a merchant (ordered by priority)
   */
  async findActiveByMerchant(merchantId: number): Promise<BankRecipientEmail[]> {
    return await this.bankRecipientEmailRepository.find({
      where: {
        merchant_id: merchantId,
        is_active: true,
      },
      order: { priority: 'ASC', created_at: 'DESC' },
    });
  }

  /**
   * Get current recipient bank email by license key
   * Finds the merchant from the license domain and returns the current recipient email
   */
  async getCurrentRecipientEmailByLicenseKey(licenseKey: string): Promise<{
    email: string;
    bank_name: string | null;
    merchant_id: number;
    merchant_domain: string;
    rotation_info: {
      total_completed_orders: number;
      orders_until_next_rotation: number;
      current_email_index: number;
    };
  }> {
    if (!licenseKey || !licenseKey.trim()) {
      throw new UnauthorizedException('License key is required');
    }

    // Find license by license key
    const license = await this.licensesService.findByLicenseKey(licenseKey.trim());

    if (!license) {
      throw new UnauthorizedException('Invalid license key');
    }

    if (!license.is_active) {
      throw new UnauthorizedException('License is inactive');
    }

    // Find merchant by domain
    const merchant = await this.merchantsService.findByDomain(license.domain);

    if (!merchant) {
      throw new NotFoundException(
        `Merchant not found for domain: ${license.domain}`,
      );
    }

    // Get all bank recipient emails for this merchant with rotation info
    const result = await this.findByMerchant(merchant.id);

    // Get the current email
    if (!result.current_email) {
      throw new NotFoundException(
        `No active bank recipient email found for merchant: ${merchant.domain}`,
      );
    }

    return {
      email: result.current_email.email,
      bank_name: result.current_email.bank_name,
      merchant_id: merchant.id,
      merchant_domain: merchant.domain,
      rotation_info: {
        total_completed_orders: result.total_completed_orders,
        orders_until_next_rotation: result.orders_until_next_rotation,
        current_email_index: result.current_email_index,
      },
    };
  }
}

