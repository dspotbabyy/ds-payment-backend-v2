import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ImapService } from './imap.service';
import { Order } from '../../database/entities/order.entity';
import { EmailModule } from '../email/email.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order]),
    EmailModule,
  ],
  providers: [ImapService],
  exports: [ImapService],
})
export class ImapModule {}

