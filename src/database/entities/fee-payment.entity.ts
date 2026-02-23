import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Merchant } from './merchant.entity';
import { User } from './user.entity';

export enum FeePaymentType {
  FEE = 'fee',
  PAYMENT = 'payment',
}

export enum PaymentMethod {
  ETRANSFER = 'etransfer',
  CHEQUE = 'cheque',
  WIRE = 'wire',
  CASH = 'cash',
}

@Entity('fees_payments')
export class FeePayment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer', name: 'merchant_id' })
  merchant_id: number;

  @ManyToOne(() => Merchant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'merchant_id' })
  merchant: Merchant;

  @Column({ type: 'varchar', length: 255, name: 'merchant_name' })
  merchant_name: string;

  @Column({
    type: 'varchar',
    length: 20,
  })
  type: FeePaymentType;

  @Column({ type: 'decimal', precision: 10, scale: 2 })
  amount: number;

  @Column({ type: 'date', default: () => 'CURRENT_DATE' })
  date: Date;

  @Column({ type: 'varchar', length: 255, nullable: true, name: 'period_reference' })
  period_reference: string;

  @Column({ type: 'text', nullable: true })
  notes: string;

  @Column({
    type: 'varchar',
    length: 20,
    nullable: true,
  })
  method: PaymentMethod;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updated_at: Date;

  @Column({ type: 'integer', nullable: true, name: 'created_by' })
  created_by: number;

  @ManyToOne(() => User, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'created_by' })
  creator: User;
}

