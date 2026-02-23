import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { MonitorOrdersService } from './monitor-orders.service';
import { Order } from '../../database/entities/order.entity';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order]),
    ScheduleModule,
    EmailModule,
  ],
  providers: [MonitorOrdersService],
  exports: [MonitorOrdersService],
})
export class MonitorOrdersModule {}

