import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Merchant } from './merchant.entity';

@Entity('bank_recipient_emails')
export class BankRecipientEmail {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', name: 'merchant_id' })
  merchant_id: number;

  @ManyToOne(() => Merchant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'merchant_id' })
  merchant: Merchant;

  @Column({ type: 'text', comment: 'Bank recipient email address' })
  email: string;

  @Column({ type: 'text', nullable: true, comment: 'Bank name or description' })
  bank_name: string;

  @Column({ type: 'boolean', default: true, name: 'is_active', comment: 'Whether this email is active' })
  is_active: boolean;

  @Column({ type: 'int', default: 0, name: 'priority', comment: 'Priority order (lower number = higher priority)' })
  priority: number;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updated_at: Date;
}

