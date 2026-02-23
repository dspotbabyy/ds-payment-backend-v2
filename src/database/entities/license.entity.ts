import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('licenses')
@Index(['domain'], { unique: true })
@Index(['license_key'], { unique: true })
export class License {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text', unique: true })
  domain: string;

  @Column({ type: 'text', unique: true })
  license_key: string;

  @Column({ type: 'timestamp', nullable: true })
  expiry_date: Date;

  @Column({ type: 'boolean', default: true })
  is_active: boolean;

  @CreateDateColumn({ type: 'timestamp' })
  created_at: Date;

  @UpdateDateColumn({ type: 'timestamp' })
  updated_at: Date;
}

