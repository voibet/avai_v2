import pool from '../lib/database/db';
import bcrypt from 'bcrypt';

async function createUser(username: string, password: string) {
    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        const result = await pool.query(
            'INSERT INTO users (username, password_hash) VALUES ($1, $2) RETURNING id, username, created_at',
            [username, hashedPassword]
        );

        console.log('User created successfully:', result.rows[0]);
    } catch (error) {
        console.error('Error creating user:', error);
    } finally {
        await pool.end();
    }
}

const args = process.argv.slice(2);
if (args.length < 2) {
    console.log('Usage: npx tsx scripts/create-user.ts <username> <password>');
    process.exit(1);
}

createUser(args[0], args[1]);
