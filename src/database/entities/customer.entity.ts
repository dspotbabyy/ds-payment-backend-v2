import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('customers')
export class Customer {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', unique: true })
  customer_email: string;

  @Column({ type: 'text', nullable: true })
  customer_name: string;

  @Column({ type: 'text', nullable: true })
  location: string;

  @Column({ type: 'text', nullable: true })
  address: string;

  @Column({ type: 'text', nullable: true })
  phone_number: string;

  @Column({ type: 'text', nullable: true })
  country: string;

  @Column({ type: 'text', nullable: true })
  province_territory: string;

  @Column({ type: 'text', nullable: true })
  city: string;

  @Column({ type: 'integer', default: 0, name: 'total_orders' })
  total_orders: number;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, name: 'total_spent' })
  total_spent: number;

  @CreateDateColumn({ type: 'timestamp', name: 'created_at' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp', name: 'updated_at' })
  updated_at: Date;
}

