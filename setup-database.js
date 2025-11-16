import pool from './lib/database/db.ts';
import fs from 'fs';

async function setupDatabase() {
  try {
    console.log('🚀 Setting up database...');

    // Read the schema file
    const schemaSQL = fs.readFileSync('schema.sql', 'utf8');

    // Split the SQL into individual statements (by semicolon)
    const statements = schemaSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    console.log(`📄 Found ${statements.length} SQL statements to execute`);

    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        try {
          console.log(`⚡ Executing statement ${i + 1}/${statements.length}...`);
          await pool.query(statement);
        } catch (error) {
          // Log the error but continue with other statements
          console.error(`❌ Error executing statement ${i + 1}:`, error.message);
          console.error('Statement:', statement.substring(0, 100) + '...');
        }
      }
    }

    console.log('✅ Database setup completed!');
  } catch (error) {
    console.error('❌ Error setting up database:', error.message);
  } finally {
    await pool.end();
  }
}

setupDatabase();
