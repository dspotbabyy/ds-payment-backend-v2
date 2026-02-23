import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Customer } from '../../database/entities/customer.entity';
import { Order } from '../../database/entities/order.entity';
import { FileUploadService } from '../orders/file-upload.service';

@Injectable()
export class CustomersService {
  constructor(
    @InjectRepository(Customer)
    private customerRepository: Repository<Customer>,
    @InjectRepository(Order)
    private orderRepository: Repository<Order>,
    private fileUploadService: FileUploadService,
  ) {}

  /**
   * Calculate customer statistics from orders
   * total_orders: count of all orders
   * total_spent: sum of total from orders where status is 'completed'
   */
  private async calculateCustomerStats(customerEmail: string): Promise<{
    total_orders: number;
    total_spent: number;
  }> {
    const normalizedEmail = customerEmail.toLowerCase().trim();

    // Count all orders for this customer using query builder
    const totalOrdersResult = await this.orderRepository
      .createQueryBuilder('order')
      .where('LOWER(TRIM(order.customer_email)) = :email', { email: normalizedEmail })
      .getCount();

    // Sum total from completed orders only using query builder
    const totalSpentResult = await this.orderRepository
      .createQueryBuilder('order')
      .select('COALESCE(SUM(order.total), 0)', 'total_spent')
      .where('LOWER(TRIM(order.customer_email)) = :email', { email: normalizedEmail })
      .andWhere('order.status = :status', { status: 'completed' })
      .getRawOne();

    const totalSpent = totalSpentResult ? Number(totalSpentResult.total_spent || 0) : 0;

    return {
      total_orders: totalOrdersResult,
      total_spent: totalSpent,
    };
  }

  /**
   * Update customer statistics from orders
   */
  async updateCustomerStats(customerEmail: string): Promise<void> {
    const normalizedEmail = customerEmail.toLowerCase().trim();
    
    const customer = await this.customerRepository.findOne({
      where: { customer_email: normalizedEmail },
    });

    if (!customer) {
      return; // Customer doesn't exist, nothing to update
    }

    const stats = await this.calculateCustomerStats(normalizedEmail);
    customer.total_orders = stats.total_orders;
    customer.total_spent = stats.total_spent;

    await this.customerRepository.save(customer);
  }

  /**
   * Sync customers from orders table
   * 1. First, recalculate statistics for all existing customers from orders table
   * 2. Then, process orders one by one and create customers if they don't exist
   */
  async syncCustomersFromOrders(): Promise<{
    created: number;
    skipped: number;
    total_processed: number;
    stats_updated: number;
  }> {
    console.log('[CustomersService] Starting customer sync from orders...');

    // Step 1: Recalculate statistics for all existing customers from orders table
    console.log('[CustomersService] Step 1: Recalculating statistics for all existing customers...');
    const allCustomers = await this.customerRepository.find();
    console.log(`[CustomersService] Found ${allCustomers.length} customers to update`);
    
    let statsUpdated = 0;

    // Loop through each customer and calculate stats from orders table
    for (const customer of allCustomers) {
      try {
        console.log(`[CustomersService] Processing customer: ${customer.customer_email} (ID: ${customer.id})`);
        
        // Search orders table for this customer and calculate stats
        const stats = await this.calculateCustomerStats(customer.customer_email);
        
        console.log(`[CustomersService] Calculated stats for ${customer.customer_email}: Orders: ${stats.total_orders}, Spent: ${stats.total_spent}`);
        console.log(`[CustomersService] Current stats in DB: Orders: ${customer.total_orders}, Spent: ${customer.total_spent}`);

        // Always update to ensure accuracy
        customer.total_orders = stats.total_orders;
        customer.total_spent = stats.total_spent;
        await this.customerRepository.save(customer);
        statsUpdated++;
        
        console.log(`[CustomersService] ✓ Updated stats for ${customer.customer_email}: Orders: ${stats.total_orders}, Spent: ${stats.total_spent}`);
      } catch (error) {
        console.error(`[CustomersService] ✗ Error updating stats for customer ${customer.customer_email}:`, error);
      }
    }

    console.log(`[CustomersService] Completed updating statistics for ${statsUpdated} out of ${allCustomers.length} customers`);

    // Step 2: Get all orders ordered by date (oldest first) to process in order
    console.log('[CustomersService] Step 2: Processing orders to create new customers...');
    const orders = await this.orderRepository.find({
      order: { date: 'ASC' },
      select: [
        'id',
        'customer_email',
        'customer_name',
        'location',
        'address',
        'phone_number',
        'country',
        'province_territory',
        'city',
        'total',
      ],
    });

    console.log(`[CustomersService] Found ${orders.length} orders to process`);

    let created = 0;
    let skipped = 0;

    // Process each order one by one
    for (const order of orders) {
      // Skip orders without customer email
      if (!order.customer_email) {
        skipped++;
        continue;
      }

      const email = order.customer_email.toLowerCase().trim();

      try {
        // Check if customer already exists in customers table
        const existingCustomer = await this.customerRepository.findOne({
          where: { customer_email: email },
        });

        if (existingCustomer) {
          // Customer already exists, skip this order
          skipped++;
          continue;
        }

        // Customer doesn't exist, create new customer from this order
        // Calculate stats from orders table
        const stats = await this.calculateCustomerStats(email);

        const newCustomer = this.customerRepository.create({
          customer_email: email,
          customer_name: order.customer_name || null,
          location: order.location || null,
          address: order.address || null,
          phone_number: order.phone_number || null,
          country: order.country || null,
          province_territory: order.province_territory || null,
          city: order.city || null,
          total_orders: stats.total_orders,
          total_spent: stats.total_spent,
        });

        await this.customerRepository.save(newCustomer);
        created++;
        console.log(`[CustomersService] Created customer from order ${order.id}: ${email} (Orders: ${stats.total_orders}, Spent: ${stats.total_spent})`);
      } catch (error) {
        console.error(`[CustomersService] Error processing order ${order.id} for customer ${email}:`, error);
        skipped++;
        // Continue with next order
      }
    }

    console.log(`[CustomersService] Sync completed. Created: ${created}, Skipped: ${skipped}, Total processed: ${orders.length}, Stats updated: ${statsUpdated}`);

    return {
      created,
      skipped,
      total_processed: orders.length,
      stats_updated: statsUpdated,
    };
  }

  /**
   * Get all customers
   */
  async findAll(): Promise<Customer[]> {
    return this.customerRepository.find({
      order: { total_spent: 'DESC' },
    });
  }

  /**
   * Get customer by email
   */
  async findByEmail(email: string): Promise<Customer | null> {
    return this.customerRepository.findOne({
      where: { customer_email: email.toLowerCase().trim() },
    });
  }

  /**
   * Get all orders for a specific customer by email
   */
  async getOrdersByCustomerEmail(email: string): Promise<any[]> {
    const normalizedEmail = email.toLowerCase().trim();
    
    const orders = await this.orderRepository.find({
      where: { customer_email: normalizedEmail },
      order: { date: 'DESC' },
    });

    // Transform orders to include id_card_image_url
    return orders.map(order => this.transformOrder(order));
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
}

