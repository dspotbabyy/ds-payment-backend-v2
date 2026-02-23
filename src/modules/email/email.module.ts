import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailService } from './email.service';
import { LogsModule } from '../logs/logs.module';
import { MerchantsModule } from '../merchants/merchants.module';
import { Order } from '../../database/entities/order.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order]),
    LogsModule,
    MerchantsModule,
  ],
  providers: [EmailService],
  exports: [EmailService],
})
export class EmailModule {}