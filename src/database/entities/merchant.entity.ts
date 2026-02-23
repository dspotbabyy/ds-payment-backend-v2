import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('merchants')
export class Merchant {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', unique: true, comment: 'Website domain (normalized)' })
  domain: string;

  @Column({ type: 'text', comment: 'Contact email address' })
  contact_email: string;

  @Column({ type: 'text', nullable: true, comment: 'Contact phone number' })
  contact_phone: string;

  @Column({ type: 'int', default: 5, name: 'rotation_interval', comment: 'Number of orders before rotating to next bank email' })
  rotation_interval: number;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}

