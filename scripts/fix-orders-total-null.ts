import { DataSource } from 'typeorm';
import { config } from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables
config();

async function fixOrdersTotalNull() {
  const isProduction =
    process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
  const databaseUrl = process.env.DATABASE_URL;
  const databasePath = process.env.DATABASE_PATH || './orders.db';

  let dataSource: DataSource;

  if (isProduction && databaseUrl) {
    // PostgreSQL
    dataSource = new DataSource({
      type: 'postgres',
      url: databaseUrl,
      ssl: {
        rejectUnauthorized: false,
      },
    });
  } else {
    // SQLite
    dataSource = new DataSource({
      type: 'sqlite',
      database: databasePath,
    });
  }

  try {
    await dataSource.initialize();
    console.log('✅ Database connected');

    // Check if there are NULL values
    const nullCountResult = await dataSource.query(
      "SELECT COUNT(*) as count FROM orders WHERE total IS NULL",
    );

    const nullCount =
      isProduction && databaseUrl
        ? parseInt(nullCountResult[0].count)
        : nullCountResult[0].count;

    if (nullCount > 0) {
      console.log(`⚠️  Found ${nullCount} orders with NULL total values. Fixing...`);

      // Update NULL values to 0
      await dataSource.query(
        "UPDATE orders SET total = 0 WHERE total IS NULL",
      );

      console.log(`✅ Updated ${nullCount} orders with NULL total values to 0`);

      // For PostgreSQL, ensure the column is NOT NULL
      if (isProduction && databaseUrl) {
        try {
          await dataSource.query(
            "ALTER TABLE orders ALTER COLUMN total SET NOT NULL",
          );
          console.log('✅ Set total column to NOT NULL');
        } catch (error) {
          // Column might already be NOT NULL, which is fine
          console.log('ℹ️  Column constraint already set (or error):', error.message);
        }
      }
    } else {
      console.log('✅ No NULL values found in orders.total column');
    }

    await dataSource.destroy();
    console.log('✅ Migration completed successfully');
  } catch (error) {
    console.error('❌ Error running migration:', error);
    if (dataSource && dataSource.isInitialized) {
      await dataSource.destroy();
    }
    process.exit(1);
  }
}

fixOrdersTotalNull();

