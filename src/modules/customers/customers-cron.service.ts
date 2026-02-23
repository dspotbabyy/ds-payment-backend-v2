import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CustomersService } from './customers.service';

@Injectable()
export class CustomersCronService {
  private readonly logger = new Logger(CustomersCronService.name);

  constructor(private customersService: CustomersService) {}

  /**
   * Sync customers from orders every 30 minutes
   * Cron expression runs every 30 minutes
   */
  @Cron('*/30 * * * *', {
    name: 'sync-customers',
    timeZone: 'UTC',
  })
  async handleSyncCustomers() {
    this.logger.log('Starting scheduled customer sync from orders...');
    
    try {
      const result = await this.customersService.syncCustomersFromOrders();
      this.logger.log(`Customer sync completed: Created: ${result.created}, Skipped: ${result.skipped}, Total processed: ${result.total_processed}, Stats updated: ${result.stats_updated}`);
    } catch (error) {
      this.logger.error('Error during customer sync:', error);
    }
  }
}

