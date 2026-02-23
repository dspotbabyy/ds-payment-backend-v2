import { Injectable, NotFoundException, BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from '../../database/entities/order.entity';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { FilterOrdersDto } from './dto/filter-orders.dto';
import { EmailService } from '../email/email.service';
import { FraudService } from '../fraud/fraud.service';
import { FraudRuleType } from '../../database/entities/fraud-rule.entity';
import { LogsService } from '../logs/logs.service';
import { LogModule } from '../../database/entities/log.entity';
import { FileUploadService } from './file-upload.service';
import { LicensesService } from '../licenses/licenses.service';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    private emailService: EmailService,
    private fraudService: FraudService,
    private logsService: LogsService,
    private fileUploadService: FileUploadService,
    private licensesService: LicensesService,
  ) {}

  /**
   * Validate license key against domain
   */
  private async validateLicenseKey(licenseKey: string | undefined, domain: string | null | undefined): Promise<void> {
    // Handle empty string as undefined
    const trimmedLicenseKey = licenseKey?.trim();
    const trimmedDomain = domain?.trim();

    console.log('[OrdersService] Validating license key:', { 
      licenseKey: trimmedLicenseKey ? `${trimmedLicenseKey.substring(0, 5)}...` : 'missing', 
      licenseKeyLength: trimmedLicenseKey?.length || 0,
      domain: trimmedDomain || 'missing',
      rawLicenseKey: licenseKey,
      rawDomain: domain
    });

    if (!trimmedLicenseKey || trimmedLicenseKey.length === 0) {
      throw new UnauthorizedException('License key is required');
    }

    if (!trimmedDomain || trimmedDomain.length === 0) {
      throw new UnauthorizedException('Domain is required for license validation');
    }

    const validationResult = await this.licensesService.validateLicense({
      license_key: trimmedLicenseKey,
      domain: trimmedDomain,
    });

    console.log('[OrdersService] License validation result:', { 
      valid: validationResult.valid, 
      message: validationResult.message,
      domain: trimmedDomain,
      licenseDomain: validationResult.license?.domain
    });

    if (!validationResult.valid) {
      throw new UnauthorizedException(validationResult.message || 'Invalid license key');
    }
  }

  async create(createOrderDto: CreateOrderDto, ipAddress: string | null, licenseKey?: string) {
    const {
      woo_order_id,
      woocommerce_order_id,
      status,
      total,
      customer_name,
      customer_email,
      address,
      phone_number,
      id_card_image,
      description,
      merchant_email,
      domain,
      location,
      country,
      province_territory,
      city,
    } = createOrderDto;

    // Validate license key
    await this.validateLicenseKey(licenseKey, domain);

    // Use woocommerce_order_id if provided
    const finalWooOrderId = woo_order_id || woocommerce_order_id || null;

    // Check for duplicate order
    if (finalWooOrderId) {
      const existingOrder = await this.orderRepository.findOne({
        where: {
          customer_email,
          woo_order_id: finalWooOrderId,
        },
      });

      if (existingOrder) {
        return {
          success: true,
          message: 'Order already exists',
          data: existingOrder,
          duplicate: true,
        };
      }
    }

    // Check for fraud before creating order - BLOCK if any active rule matches
    let orderStatus = status || 'pending';
    const matchedRules: string[] = [];

    // Check customer email against fraud rules
    if (customer_email) {
      const emailFraudRule = await this.fraudService.checkFraud(
        FraudRuleType.EMAIL,
        customer_email,
      );
      if (emailFraudRule) {
        matchedRules.push(`Email: ${customer_email}`);
      }
    }

    // Check IP address against fraud rules (always use auto-detected IP)
    if (ipAddress) {
      const ipFraudRule = await this.fraudService.checkFraud(
        FraudRuleType.IP_ADDRESS,
        ipAddress,
      );
      if (ipFraudRule) {
        matchedRules.push(`IP Address: ${ipAddress}`);
      }
    }

    // Check customer name against fraud rules
    if (customer_name) {
      const nameFraudRule = await this.fraudService.checkFraud(
        FraudRuleType.CUSTOMER_NAME,
        customer_name,
      );
      if (nameFraudRule) {
        matchedRules.push(`Customer Name: ${customer_name}`);
      }
    }

    // Check location against fraud rules
    if (location) {
      const locationFraudRule = await this.fraudService.checkFraud(
        FraudRuleType.LOCATION,
        location,
      );
      if (locationFraudRule) {
        matchedRules.push(`Location: ${location}`);
      }
    }

    // Check country against fraud rules
    if (country) {
      const countryFraudRule = await this.fraudService.checkFraud(
        FraudRuleType.COUNTRY,
        country,
      );
      if (countryFraudRule) {
        matchedRules.push(`Country: ${country}`);
      }
    }

    // Check province/territory against fraud rules
    if (province_territory) {
      const provinceFraudRule = await this.fraudService.checkFraud(
        FraudRuleType.PROVINCE,
        province_territory,
      );
      if (provinceFraudRule) {
        matchedRules.push(`Province/Territory: ${province_territory}`);
      }
    }

    // Check city against fraud rules
    if (city) {
      const cityFraudRule = await this.fraudService.checkFraud(
        FraudRuleType.CITY,
        city,
      );
      if (cityFraudRule) {
        matchedRules.push(`City: ${city}`);
      }
    }

    // BLOCK order creation if fraud is detected
    if (matchedRules.length > 0) {
      // Log the blocked order attempt
      this.logsService
        .createLog({
          module: LogModule.ORDERS,
          action: 'blocked',
          entity_id: null,
          details: {
            reason: 'fraud_detected',
            matched_rules: matchedRules,
            customer_email: customer_email || null,
            ip_address: ipAddress || null,
          },
          ip_address: ipAddress || null,
        })
        .catch((err) => console.error('Error logging blocked order:', err));

      throw new ForbiddenException(
        `Order blocked: Fraud detected. Matched rules: ${matchedRules.join(', ')}`,
      );
    }

    // Normalize domain if provided
    let normalizedDomain: string | null = null;
    if (domain) {
      normalizedDomain = domain.trim().toLowerCase();
      // Remove protocol if present
      normalizedDomain = normalizedDomain.replace(/^https?:\/\//, '');
      // Remove trailing slash
      normalizedDomain = normalizedDomain.replace(/\/$/, '');
    }

    // Create order first (without ID card image path initially)
    const order = this.orderRepository.create({
      woo_order_id: finalWooOrderId,
      status: orderStatus,
      total,
      customer_name: customer_name || null,
      customer_email,
      address: address || null,
      phone_number: phone_number || null,
      id_card_image: null, // Will be set after saving image
      description: description || null,
      ip_address: ipAddress || null,
      merchant_email: merchant_email || null,
      domain: normalizedDomain,
      location: location || null,
      country: country || null,
      province_territory: province_territory || null,
      city: city || null,
    });

    const savedOrder = await this.orderRepository.save(order);

    // Handle ID card image upload if provided
    if (id_card_image) {
      try {
        console.log(`[OrdersService] Attempting to save ID card image for order ${savedOrder.id}`);
        console.log(`[OrdersService] Image data length: ${id_card_image.length} characters`);
        console.log(`[OrdersService] Image data preview: ${id_card_image.substring(0, 50)}...`);
        
        const idCardImagePath = await this.fileUploadService.saveBase64Image(id_card_image, savedOrder.id);
        console.log(`[OrdersService] Image saved successfully. Path: ${idCardImagePath}`);
        
        // Update the order with the image path
        savedOrder.id_card_image = idCardImagePath;
        await this.orderRepository.save(savedOrder);
        console.log(`[OrdersService] Order updated with image path: ${idCardImagePath}`);
      } catch (error) {
        // Log detailed error but don't fail the order creation
        console.error('[OrdersService] Error saving ID card image:', error);
        console.error('[OrdersService] Error details:', {
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
          orderId: savedOrder.id,
        });
        // Optionally, you could delete the order here if image is required
      }
    }

    // Log order creation
    this.logsService
      .createLog({
        module: LogModule.ORDERS,
        action: 'create',
        entity_id: savedOrder.id,
        details: {
          order_id: savedOrder.id,
          customer_email: savedOrder.customer_email,
          total: savedOrder.total,
          status: savedOrder.status,
          domain: savedOrder.domain || null,
          ip_detected_automatically: true,
        },
        ip_address: savedOrder.ip_address || null,
      })
      .catch((err) => console.error('Error logging order creation:', err));

    // Send email notifications (async)
    if (merchant_email) {
      this.emailService
        .sendOrderStatusEmails(savedOrder, null, merchant_email)
        .catch((err) => console.error('Error sending order creation emails:', err));
    }

    return {
      success: true,
      message: 'Order created successfully',
      data: this.transformOrder(savedOrder),
    };
  }

  /**
   * Transform order to include public URL for ID card image
   */
  private transformOrder(order: Order): Order & { id_card_image_url: string | null } {
    const orderData = { ...order } as Order & { id_card_image_url: string | null };
    if (orderData.id_card_image) {
      orderData.id_card_image_url = this.fileUploadService.getPublicUrl(orderData.id_card_image);
    } else {
      orderData.id_card_image_url = null;
    }
    return orderData;
  }

  /**
   * Transform array of orders to include public URLs
   */
  private transformOrders(orders: Order[]): any[] {
    return orders.map(order => this.transformOrder(order));
  }

  async findAll() {
    const orders = await this.orderRepository.find({
      order: { date: 'DESC' },
    });

    return {
      success: true,
      message: 'Orders list retrieved successfully',
      data: this.transformOrders(orders),
      total: orders.length,
    };
  }

  async findMyOrders(userEmail: string) {
    // Filter orders by customer_email matching user email
    const orders = await this.orderRepository.find({
      where: { customer_email: userEmail },
      order: { date: 'DESC' },
    });

    return {
      success: true,
      message: 'User orders retrieved successfully',
      data: this.transformOrders(orders),
      total: orders.length,
      user: {
        email: userEmail,
      },
    };
  }

  async findFiltered(filterDto: FilterOrdersDto) {
    const { user_email, start_date, end_date, date, status } = filterDto;

    const queryBuilder = this.orderRepository.createQueryBuilder('order');

    // Filter by customer_email matching user email
    queryBuilder.where('order.customer_email = :customerEmail', {
      customerEmail: user_email,
    });

    if (start_date) {
      queryBuilder.andWhere('DATE(order.date) >= :startDate', { startDate: start_date });
    }

    if (end_date) {
      queryBuilder.andWhere('DATE(order.date) <= :endDate', { endDate: end_date });
    }

    if (date) {
      queryBuilder.andWhere('DATE(order.date) = :date', { date });
    }

    if (status) {
      queryBuilder.andWhere('order.status = :status', { status });
    }

    queryBuilder.orderBy('order.date', 'DESC');

    const orders = await queryBuilder.getMany();

    return {
      success: true,
      message: 'Filtered orders retrieved successfully',
      data: this.transformOrders(orders),
      total: orders.length,
      filters: {
        start_date,
        end_date,
        date,
        status,
      },
      user: {
        email: user_email,
      },
    };
  }

  async findOne(id: number, userEmail: string, licenseKey?: string) {
    const order = await this.orderRepository.findOne({
      where: { id },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Validate license key - use domain from order
    await this.validateLicenseKey(licenseKey, order.domain);

    // Normalize emails for comparison (case-insensitive, trimmed)
    const normalizedUserEmail = userEmail ? userEmail.trim().toLowerCase() : '';
    const normalizedCustomerEmail = order.customer_email ? order.customer_email.trim().toLowerCase() : '';

    // Check access permission - user can only view orders where customer_email matches
    if (normalizedCustomerEmail !== normalizedUserEmail) {
      throw new BadRequestException(
        `Access denied: You can only view your own orders. Expected: ${order.customer_email}, Got: ${userEmail}`,
      );
    }

    return {
      success: true,
      message: 'Order details retrieved successfully',
      data: this.transformOrder(order),
      user: {
        email: userEmail,
      },
    };
  }

  /**
   * Check order payment status in real-time and send success emails if status is completed/success
   * This endpoint is designed for polling/checking payment status
   */
  async checkPaymentStatus(id: number, userEmail: string, licenseKey?: string) {
    // Validate userEmail parameter
    if (!userEmail || !userEmail.trim()) {
      throw new BadRequestException('user_email query parameter is required');
    }

    const order = await this.orderRepository.findOne({
      where: { id },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    // Validate license key - use domain from order
    await this.validateLicenseKey(licenseKey, order.domain);

    // Normalize emails for comparison (case-insensitive, trimmed)
    const normalizedUserEmail = userEmail.trim().toLowerCase();
    const normalizedCustomerEmail = order.customer_email ? order.customer_email.trim().toLowerCase() : '';

    // Check access permission - user can only view orders where customer_email matches
    if (normalizedCustomerEmail !== normalizedUserEmail) {
      throw new BadRequestException(
        `Access denied: You can only view your own orders. Expected: ${order.customer_email}, Got: ${userEmail}`,
      );
    }

    const normalizedStatus = order.status ? String(order.status).toLowerCase().trim() : null;
    const isSuccess = normalizedStatus === 'completed' || normalizedStatus === 'success';

    // If status is completed/success, check if emails have already been sent before sending
    if (isSuccess && order.merchant_email) {
      // Reload order from database to get latest email sent flags
      const latestOrder = await this.orderRepository.findOne({
        where: { id: order.id },
      });

      if (!latestOrder) {
        console.error(`[checkPaymentStatus] Order ${order.id} not found when reloading`);
      } else {
        // Only send emails if they haven't been sent yet
        const shouldSendCustomerEmail = !latestOrder.payment_received_customer_email_sent;
        const shouldSendMerchantEmail = !latestOrder.payment_received_merchant_email_sent;

        if (shouldSendCustomerEmail || shouldSendMerchantEmail) {
          try {
            // Send success emails (this sends to both customer and merchant)
            // The email service will check the flags internally, but we're also checking here
            await this.emailService.sendOrderStatusEmails(
              latestOrder,
              null, // previousStatus - null means we're just checking, not updating
              latestOrder.merchant_email,
            );

            // Log the email sending
            this.logsService
              .createLog({
                module: LogModule.ORDERS,
                action: 'check_status_success_email_sent',
                entity_id: latestOrder.id,
                details: {
                  order_id: latestOrder.id,
                  status: latestOrder.status,
                  customer_email: latestOrder.customer_email,
                  merchant_email: latestOrder.merchant_email,
                  emails_sent: true,
                  customer_email_already_sent: !shouldSendCustomerEmail,
                  merchant_email_already_sent: !shouldSendMerchantEmail,
                },
                ip_address: latestOrder.ip_address || null,
              })
              .catch((err) => console.error('Error logging status check email:', err));
          } catch (emailError) {
            console.error('Error sending success emails on status check:', emailError);
            // Don't throw - still return the order status even if email fails
          }
        } else {
          console.log(`[checkPaymentStatus] Emails already sent for order ${order.id}. Skipping.`);
        }
      }
    }

    const transformedOrder = this.transformOrder(order);
    return {
      success: true,
      message: 'Order payment status retrieved successfully',
      data: {
        ...transformedOrder,
        is_paid: isSuccess,
        payment_status: isSuccess ? 'success' : 'waiting',
      },
      emails_sent: isSuccess && order.merchant_email ? true : false,
      user: {
        email: userEmail,
      },
    };
  }

  async update(id: number, updateOrderDto: UpdateOrderDto, userEmail: string, licenseKey?: string) {
    const existingOrder = await this.orderRepository.findOne({
      where: { id },
    });

    if (!existingOrder) {
      throw new NotFoundException('Order not found');
    }

    // Validate license key - use domain from update DTO or existing order
    const domainForValidation = updateOrderDto.domain || existingOrder.domain;
    await this.validateLicenseKey(licenseKey, domainForValidation);

    // Check access permission - user can only edit orders where customer_email matches
    if (existingOrder.customer_email !== userEmail) {
      throw new BadRequestException('Access denied: You can only edit your own orders');
    }

    const oldStatus = existingOrder.status;

    // Check for fraud - BLOCK update if any active rule matches
    const customerEmail = updateOrderDto.customer_email || existingOrder.customer_email;
    const ipAddress = existingOrder.ip_address; // IP address is not updatable, use existing
    const customerName = updateOrderDto.customer_name || existingOrder.customer_name;
    const location = updateOrderDto.location || existingOrder.location;
    const country = updateOrderDto.country || existingOrder.country;
    const provinceTerritory = updateOrderDto.province_territory || existingOrder.province_territory;
    const city = updateOrderDto.city || existingOrder.city;

    let orderStatus = updateOrderDto.status || existingOrder.status;
    const matchedRules: string[] = [];

    // Check customer email against fraud rules
    if (customerEmail) {
      const emailFraudRule = await this.fraudService.checkFraud(
        FraudRuleType.EMAIL,
        customerEmail,
      );
      if (emailFraudRule) {
        matchedRules.push(`Email: ${customerEmail}`);
      }
    }

    // Check IP address against fraud rules
    if (ipAddress) {
      const ipFraudRule = await this.fraudService.checkFraud(
        FraudRuleType.IP_ADDRESS,
        ipAddress,
      );
      if (ipFraudRule) {
        matchedRules.push(`IP Address: ${ipAddress}`);
      }
    }

    // Check customer name against fraud rules
    if (customerName) {
      const nameFraudRule = await this.fraudService.checkFraud(
        FraudRuleType.CUSTOMER_NAME,
        customerName,
      );
      if (nameFraudRule) {
        matchedRules.push(`Customer Name: ${customerName}`);
      }
    }

    // Check location against fraud rules
    if (location) {
      const locationFraudRule = await this.fraudService.checkFraud(
        FraudRuleType.LOCATION,
        location,
      );
      if (locationFraudRule) {
        matchedRules.push(`Location: ${location}`);
      }
    }

    // Check country against fraud rules
    if (country) {
      const countryFraudRule = await this.fraudService.checkFraud(
        FraudRuleType.COUNTRY,
        country,
      );
      if (countryFraudRule) {
        matchedRules.push(`Country: ${country}`);
      }
    }

    // Check province/territory against fraud rules
    if (provinceTerritory) {
      const provinceFraudRule = await this.fraudService.checkFraud(
        FraudRuleType.PROVINCE,
        provinceTerritory,
      );
      if (provinceFraudRule) {
        matchedRules.push(`Province/Territory: ${provinceTerritory}`);
      }
    }

    // Check city against fraud rules
    if (city) {
      const cityFraudRule = await this.fraudService.checkFraud(
        FraudRuleType.CITY,
        city,
      );
      if (cityFraudRule) {
        matchedRules.push(`City: ${city}`);
      }
    }

    // BLOCK order update if fraud is detected
    if (matchedRules.length > 0) {
      // Log the blocked order update attempt
      this.logsService
        .createLog({
          module: LogModule.ORDERS,
          action: 'update_blocked',
          entity_id: id,
          details: {
            reason: 'fraud_detected',
            matched_rules: matchedRules,
            order_id: id,
            customer_email: customerEmail || null,
            ip_address: ipAddress || null,
          },
          ip_address: ipAddress || null,
        })
        .catch((err) => console.error('Error logging blocked order update:', err));

      throw new ForbiddenException(
        `Order update blocked: Fraud detected. Matched rules: ${matchedRules.join(', ')}`,
      );
    }

    // Normalize domain if being updated
    if (updateOrderDto.domain !== undefined) {
      let normalizedDomain: string | null = null;
      if (updateOrderDto.domain) {
        normalizedDomain = updateOrderDto.domain.trim().toLowerCase();
        // Remove protocol if present
        normalizedDomain = normalizedDomain.replace(/^https?:\/\//, '');
        // Remove trailing slash
        normalizedDomain = normalizedDomain.replace(/\/$/, '');
      }
      existingOrder.domain = normalizedDomain;
    }

    // Handle ID card image update if provided
    if (updateOrderDto.id_card_image !== undefined) {
      if (updateOrderDto.id_card_image) {
        // Delete old image if it exists
        if (existingOrder.id_card_image) {
          await this.fileUploadService.deleteFile(existingOrder.id_card_image);
        }
        // Save new image
        try {
          const idCardImagePath = await this.fileUploadService.saveBase64Image(updateOrderDto.id_card_image, existingOrder.id);
          existingOrder.id_card_image = idCardImagePath;
        } catch (error) {
          console.error('Error saving ID card image:', error);
          // Don't fail the update if image save fails
        }
      } else {
        // If id_card_image is explicitly set to null/empty, delete the old image
        if (existingOrder.id_card_image) {
          await this.fileUploadService.deleteFile(existingOrder.id_card_image);
        }
        existingOrder.id_card_image = null;
      }
    }

    // Update order fields
    if (updateOrderDto.customer_name !== undefined) existingOrder.customer_name = updateOrderDto.customer_name;
    if (updateOrderDto.address !== undefined) existingOrder.address = updateOrderDto.address;
    if (updateOrderDto.phone_number !== undefined) existingOrder.phone_number = updateOrderDto.phone_number;
    if (updateOrderDto.location !== undefined) existingOrder.location = updateOrderDto.location;
    if (updateOrderDto.country !== undefined) existingOrder.country = updateOrderDto.country;
    if (updateOrderDto.province_territory !== undefined) existingOrder.province_territory = updateOrderDto.province_territory;
    if (updateOrderDto.city !== undefined) existingOrder.city = updateOrderDto.city;
    
    // Update other fields (status, total, description, merchant_email, customer_email)
    if (updateOrderDto.status !== undefined) existingOrder.status = updateOrderDto.status;
    if (updateOrderDto.total !== undefined) existingOrder.total = updateOrderDto.total;
    if (updateOrderDto.description !== undefined) existingOrder.description = updateOrderDto.description;
    if (updateOrderDto.merchant_email !== undefined) existingOrder.merchant_email = updateOrderDto.merchant_email;
    if (updateOrderDto.customer_email !== undefined) existingOrder.customer_email = updateOrderDto.customer_email;
    if (updateOrderDto.woo_order_id !== undefined) existingOrder.woo_order_id = updateOrderDto.woo_order_id;
    const updatedOrder = await this.orderRepository.save(existingOrder);

    // Log order update
    this.logsService
      .createLog({
        module: LogModule.ORDERS,
        action: 'update',
        entity_id: updatedOrder.id,
        details: {
          order_id: updatedOrder.id,
          old_status: oldStatus,
          new_status: orderStatus,
          updated_fields: Object.keys(updateOrderDto),
          domain: updatedOrder.domain || null,
        },
        ip_address: updatedOrder.ip_address || null,
      })
      .catch((err) => console.error('Error logging order update:', err));

    // Send email notifications if status changed
    if (orderStatus !== oldStatus) {
      const merchantEmailForNotification = updateOrderDto.merchant_email || existingOrder.merchant_email;
      if (merchantEmailForNotification) {
        this.emailService
          .sendOrderStatusEmails(updatedOrder, oldStatus, merchantEmailForNotification)
          .catch((err) => console.error('Error sending order status change emails:', err));
      }
    }

    return {
      success: true,
      message: 'Order updated successfully',
      data: this.transformOrder(updatedOrder),
      user: {
        email: userEmail,
      },
    };
  }

  async remove(id: number, userEmail: string) {
    const existingOrder = await this.orderRepository.findOne({
      where: { id },
    });

    if (!existingOrder) {
      throw new NotFoundException('Order not found');
    }

    // Check access permission - user can only delete orders where customer_email matches
    if (existingOrder.customer_email !== userEmail) {
      throw new BadRequestException('Access denied: You can only delete your own orders');
    }

    await this.orderRepository.remove(existingOrder);

    // Log order deletion
    this.logsService
      .createLog({
        module: LogModule.ORDERS,
        action: 'delete',
        entity_id: id,
        details: {
          order_id: id,
          customer_email: existingOrder.customer_email,
          total: existingOrder.total,
          status: existingOrder.status,
        },
        ip_address: existingOrder.ip_address || null,
      })
      .catch((err) => console.error('Error logging order deletion:', err));

    return {
      success: true,
      message: 'Order deleted successfully',
      deleted_order_id: id,
      user: {
        email: userEmail,
      },
    };
  }

  async getSummaryByAccounts(userEmail: string, filters: any) {
    const queryBuilder = this.orderRepository
      .createQueryBuilder('order')
      .select([
        'order.merchant_email as merchant_email',
        'COUNT(order.id) as total_orders',
        'SUM(order.total) as total_revenue',
        'AVG(order.total) as avg_order_value',
        'MIN(order.date) as first_order_date',
        'MAX(order.date) as last_order_date',
      ])
      .groupBy('order.merchant_email')
      .orderBy('total_revenue', 'DESC');

    if (filters.start_date) {
      queryBuilder.andWhere('DATE(order.date) >= :startDate', { startDate: filters.start_date });
    }

    if (filters.end_date) {
      queryBuilder.andWhere('DATE(order.date) <= :endDate', { endDate: filters.end_date });
    }

    if (filters.date) {
      queryBuilder.andWhere('DATE(order.date) = :date', { date: filters.date });
    }

    const summary = await queryBuilder.getRawMany();

    return {
      success: true,
      message: 'Summary by accounts retrieved successfully',
      data: summary,
      total_accounts: summary.length,
      filters,
    };
  }

  async getSummaryByDays(userEmail: string, filters: any) {
    const queryBuilder = this.orderRepository
      .createQueryBuilder('order')
      .select([
        'DATE(order.date) as order_date',
        'COUNT(order.id) as total_orders',
        'SUM(order.total) as total_revenue',
        'AVG(order.total) as avg_order_value',
        "SUM(CASE WHEN order.status = 'completed' THEN 1 ELSE 0 END) as completed_orders",
        "SUM(CASE WHEN order.status = 'pending' THEN 1 ELSE 0 END) as pending_orders",
        "SUM(CASE WHEN order.status = 'processing' THEN 1 ELSE 0 END) as processing_orders",
      ])
      .groupBy('DATE(order.date)')
      .orderBy('order_date', 'DESC');

    // Filter by customer_email matching user email
    queryBuilder.where('order.customer_email = :customerEmail', {
      customerEmail: userEmail,
    });

    if (filters.start_date) {
      queryBuilder.andWhere('DATE(order.date) >= :startDate', { startDate: filters.start_date });
    }

    if (filters.end_date) {
      queryBuilder.andWhere('DATE(order.date) <= :endDate', { endDate: filters.end_date });
    }

    const summary = await queryBuilder.getRawMany();

    return {
      success: true,
      message: 'Summary by days retrieved successfully',
      data: summary,
      total_days: summary.length,
      filters,
    };
  }

  async getStatsByMerchant() {
    const stats = await this.orderRepository
      .createQueryBuilder('order')
      .select([
        'order.merchant_email as merchant_email',
        'COUNT(order.id) as total_orders',
        'SUM(order.total) as total_revenue',
        'AVG(order.total) as avg_order_value',
      ])
      .groupBy('order.merchant_email')
      .orderBy('total_revenue', 'DESC')
      .getRawMany();

    return {
      success: true,
      message: 'Statistics retrieved successfully',
      data: stats,
    };
  }

  // Helper method to extract domain from email
  private extractDomainFromEmail(email: string): string | null {
    if (!email || !email.includes('@')) {
      return null;
    }
    const parts = email.split('@');
    if (parts.length !== 2) {
      return null;
    }
    return parts[1].toLowerCase().trim();
  }

  async getStatistics() {
    // Get total orders count
    const totalOrders = await this.orderRepository.count();

    // Get pending orders count
    const pendingOrders = await this.orderRepository.count({
      where: { status: 'pending' },
    });

    // Get confirmed/completed orders count
    const confirmedOrders = await this.orderRepository.count({
      where: { status: 'completed' },
    });

    // Get fraud orders count
    const fraudOrders = await this.orderRepository.count({
      where: { status: 'fraud' },
    });

    // Get recent orders (last 10 orders, ordered by date DESC)
    const recentOrdersRaw = await this.orderRepository.find({
      order: { date: 'DESC' },
      take: 10,
    });

    return {
      success: true,
      message: 'Order statistics retrieved successfully',
      data: {
        statistics: {
          total_orders: totalOrders,
          pending_orders: pendingOrders,
          confirmed_orders: confirmedOrders,
          fraud_orders: fraudOrders,
        },
        recent_orders: this.transformOrders(recentOrdersRaw),
      },
    };
  }
}
