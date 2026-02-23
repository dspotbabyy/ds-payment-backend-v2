import { Controller, Get, Param, Query } from '@nestjs/common';
import { CustomersService } from './customers.service';

@Controller('customers')
export class CustomersController {
  constructor(private readonly customersService: CustomersService) {}

  /**
   * Get all customers
   * GET /api/customers
   */
  @Get()
  async findAll() {
    const customers = await this.customersService.findAll();
    return {
      success: true,
      data: customers,
      count: customers.length,
    };
  }

  /**
   * Get orders by customer email
   * GET /api/customers/:email/orders
   */
  @Get(':email/orders')
  async getCustomerOrders(@Param('email') email: string) {
    const orders = await this.customersService.getOrdersByCustomerEmail(email);
    return {
      success: true,
      data: orders,
      count: orders.length,
      customer_email: email,
    };
  }
}

