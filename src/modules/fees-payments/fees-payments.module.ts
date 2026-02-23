import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FeesPaymentsController } from './fees-payments.controller';
import { FeesPaymentsService } from './fees-payments.service';
import { FeePayment } from '../../database/entities/fee-payment.entity';
import { Merchant } from '../../database/entities/merchant.entity';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([FeePayment, Merchant]),
    AuthModule,
  ],
  controllers: [FeesPaymentsController],
  providers: [FeesPaymentsService],
  exports: [FeesPaymentsService],
})
export class FeesPaymentsModule {}

