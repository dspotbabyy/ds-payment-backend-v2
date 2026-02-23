import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersService } from './customers.service';
import { CustomersCronService } from './customers-cron.service';
import { CustomersController } from './customers.controller';
import { Customer } from '../../database/entities/customer.entity';
import { Order } from '../../database/entities/order.entity';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, Order]),
    OrdersModule, // Import OrdersModule to access FileUploadService
  ],
  controllers: [CustomersController],
  providers: [CustomersService, CustomersCronService],
  exports: [CustomersService],
})
export class CustomersModule {}

