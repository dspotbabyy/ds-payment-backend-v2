import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export enum FraudRuleType {
  IP_ADDRESS = 'ip_address',
  EMAIL = 'email',
  CUSTOMER_NAME = 'customer_name',
  LOCATION = 'location',
  COUNTRY = 'country',
  PROVINCE = 'province',
  CITY = 'city',
}

@Entity('fraud_rules')
export class FraudRule {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({
    type: 'varchar',
    length: 50,
  })
  type: FraudRuleType;

  @Column({ type: 'text' })
  value: string; // IP address, email, customer name, location, country, province, or city

  @Column({ type: 'text', nullable: true })
  reason: string; // Reason for blocking

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}

