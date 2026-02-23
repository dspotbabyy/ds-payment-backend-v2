import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';

@Entity('orders')
export class Order {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', nullable: true })
  woo_order_id: string;

  @Column({ type: 'text', default: 'pending' })
  status: string;

  @CreateDateColumn({ type: 'timestamp' })
  date: Date;

  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true, default: 0 })
  total: number;

  @Column({ type: 'text', nullable: true })
  customer_name: string;

  @Column({ type: 'text' })
  customer_email: string;

  @Column({ type: 'text', nullable: true })
  address: string; // Customer address

  @Column({ type: 'text', nullable: true })
  phone_number: string; // Customer phone number

  @Column({ type: 'text', nullable: true })
  id_card_image: string; // ID card image URL or base64 (optional)

  @Column({ type: 'text', nullable: true })
  description: string;

  @Column({ type: 'text', nullable: true })
  ip_address: string;

  @Column({ type: 'text', nullable: true })
  merchant_email: string;

  @Column({ type: 'text', nullable: true })
  domain: string; // Website domain using the plugin

  @Column({ type: 'text', nullable: true })
  location: string; // Customer location

  @Column({ type: 'text', nullable: true })
  country: string; // Customer country

  @Column({ type: 'text', nullable: true })
  province_territory: string; // Province or territory

  @Column({ type: 'text', nullable: true })
  city: string; // City

  @Column({ type: 'boolean', default: false, name: 'payment_received_customer_email_sent' })
  payment_received_customer_email_sent: boolean; // Track if payment received email was sent to customer

  @Column({ type: 'boolean', default: false, name: 'payment_received_merchant_email_sent' })
  payment_received_merchant_email_sent: boolean; // Track if payment received email was sent to merchant
}
