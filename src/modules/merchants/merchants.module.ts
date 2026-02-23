import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MerchantsService } from './merchants.service';
import { BankRecipientEmailsService } from './bank-recipient-emails.service';
import { MerchantsController } from './merchants.controller';
import { Merchant } from '../../database/entities/merchant.entity';
import { BankRecipientEmail } from '../../database/entities/bank-recipient-email.entity';
import { Order } from '../../database/entities/order.entity';
import { LogsModule } from '../logs/logs.module';
import { LicensesModule } from '../licenses/licenses.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Merchant, BankRecipientEmail, Order]),
    LogsModule,
    LicensesModule,
  ],
  controllers: [MerchantsController],
  providers: [MerchantsService, BankRecipientEmailsService],
  exports: [MerchantsService, BankRecipientEmailsService],
})
export class MerchantsModule {}

