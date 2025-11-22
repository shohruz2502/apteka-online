require('dotenv').config();
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');

const app = express();

// Configuration
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key-for-development';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const googleClient = new OAuth2Client(GOOGLE_CLIENT_ID);

// Database configuration
const poolConfig = process.env.DATABASE_URL ? {
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10
} : {
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT || 5432,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 30000,
    max: 10
};

const pool = new Pool(poolConfig);

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Utility functions
const formatTimeAgo = (date) => {
    const now = new Date();
    const diffMs = now - new Date(date);
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'только что';
    if (diffMins < 60) return `${diffMins} мин назад`;
    if (diffHours < 24) return `${diffHours} ч назад`;
    if (diffDays < 7) return `${diffDays} дн назад`;
    return new Date(date).toLocaleDateString('ru-RU');
};

const decodeJWT = (token) => {
    try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(c => 
            '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)
        ).join(''));
        return JSON.parse(jsonPayload);
    } catch (error) {
        console.error('JWT decode error:', error);
        return null;
    }
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// Database initialization
const initializeDatabase = async () => {
    try {
        // Users table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username VARCHAR(50) UNIQUE NOT NULL,
                email VARCHAR(100) UNIQUE NOT NULL,
                password VARCHAR(255),
                full_name VARCHAR(100),
                phone VARCHAR(20),
                birth_year INTEGER,
                avatar_url VARCHAR(255),
                google_id VARCHAR(100) UNIQUE,
                rating DECIMAL(3,2) DEFAULT 5.0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Categories table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS categories (
                id SERIAL PRIMARY KEY,
                name VARCHAR(50) NOT NULL,
                icon VARCHAR(50),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Ads table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS ads (
                id SERIAL PRIMARY KEY,
                title VARCHAR(200) NOT NULL,
                description TEXT,
                price DECIMAL(12,2),
                category_id INTEGER REFERENCES categories(id),
                user_id INTEGER REFERENCES users(id),
                location VARCHAR(100),
                image_urls TEXT[],
                seller_info JSONB,
                is_urgent BOOLEAN DEFAULT FALSE,
                is_active BOOLEAN DEFAULT TRUE,
                views INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Favorites table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS favorites (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id),
                ad_id INTEGER REFERENCES ads(id),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(user_id, ad_id)
            )
        `);

        // Messages table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                sender_id INTEGER REFERENCES users(id),
                receiver_id INTEGER REFERENCES users(id),
                ad_id INTEGER REFERENCES ads(id),
                content TEXT NOT NULL,
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Chats table
        await pool.query(`
            CREATE TABLE IF NOT EXISTS chats (
                id SERIAL PRIMARY KEY,
                user1_id INTEGER REFERENCES users(id),
                user2_id INTEGER REFERENCES users(id),
                ad_id INTEGER REFERENCES ads(id),
                last_message TEXT,
                last_message_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                unread_count INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Insert default data
        const categoriesCount = await pool.query('SELECT COUNT(*) FROM categories');
        if (parseInt(categoriesCount.rows[0].count) === 0) {
            await pool.query(`
                INSERT INTO categories (name, icon) VALUES 
                ('Электроника', 'fa-laptop'),
                ('Недвижимость', 'fa-home'),
                ('Авто', 'fa-car'),
                ('Работа', 'fa-briefcase'),
                ('Услуги', 'fa-cogs'),
                ('Мебель', 'fa-couch'),
                ('Одежда', 'fa-tshirt'),
                ('Спорт', 'fa-futbol-o'),
                ('Хобби', 'fa-music'),
                ('Животные', 'fa-paw')
            `);
        }

        const usersCount = await pool.query('SELECT COUNT(*) FROM users WHERE username = $1', ['admin']);
        if (parseInt(usersCount.rows[0].count) === 0) {
            const hashedPassword = await bcrypt.hash('admin123', 10);
            await pool.query(`
                INSERT INTO users (username, email, password, full_name, phone) 
                VALUES ('admin', 'admin@zeeptook.ru', $1, 'Администратор', '+79990000000')
            `, [hashedPassword]);
        }

        console.log('✅ Database initialized successfully');
    } catch (error) {
        console.error('❌ Database initialization error:', error);
        throw error;
    }
};

// Serve static pages
const servePage = (page) => (req, res) => {
    res.sendFile(path.join(__dirname, 'public', `${page}.html`));
};

app.get('/', servePage('index'));
app.get('/favorites', servePage('favorites'));
app.get('/ad-details', servePage('ad-details'));
app.get('/add-ad', servePage('add-ad'));
app.get('/messages', servePage('messages'));
app.get('/profile', servePage('profile'));
app.get('/register', servePage('register'));
app.get('/login', servePage('login'));

// Auth Routes
app.post('/api/register', async (req, res) => {
    try {
        const { 
            username, email, password, full_name, phone, birth_year, 
            avatar_url, google_id, auth_method = 'email' 
        } = req.body;

        console.log('🔐 Registration attempt:', { email, auth_method });

        // Validation
        if (auth_method === 'email' && (!username || !password)) {
            return res.status(400).json({ error: 'Username and password are required for email registration' });
        }

        if (!email || !full_name || !phone) {
            return res.status(400).json({ error: 'Email, full name and phone are required' });
        }

        // Check if user exists
        let userExists;
        if (google_id) {
            userExists = await pool.query(
                'SELECT id FROM users WHERE google_id = $1 OR email = $2',
                [google_id, email]
            );
        } else {
            userExists = await pool.query(
                'SELECT id FROM users WHERE username = $1 OR email = $2',
                [username, email]
            );
        }

        if (userExists.rows.length > 0) {
            return res.status(400).json({ error: 'User already exists' });
        }

        // Generate username for Google auth if not provided
        let actualUsername = username;
        if (auth_method === 'google' && !username) {
            actualUsername = 'user_' + Math.random().toString(36).substr(2, 9);
        }

        // Hash password
        let hashedPassword = null;
        if (auth_method === 'email') {
            hashedPassword = await bcrypt.hash(password, 10);
        }

        // Create user
        const result = await pool.query(
            `INSERT INTO users (username, email, password, full_name, phone, birth_year, avatar_url, google_id) 
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
             RETURNING id, username, email, full_name, phone, birth_year, avatar_url, rating, created_at`,
            [actualUsername, email, hashedPassword, full_name, phone, birth_year, avatar_url, google_id]
        );

        const user = result.rows[0];
        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);

        console.log('✅ User registered:', user.email);

        res.json({
            message: 'User registered successfully',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                full_name: user.full_name,
                phone: user.phone,
                birth_year: user.birth_year,
                rating: user.rating,
                avatar_url: user.avatar_url,
                created_at: user.created_at
            }
        });

    } catch (error) {
        console.error('❌ Registration error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ error: 'Username and password are required' });
        }

        const result = await pool.query(
            'SELECT * FROM users WHERE username = $1 OR email = $1',
            [username]
        );

        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const user = result.rows[0];

        if (!user.password) {
            return res.status(400).json({ error: 'Please use Google sign-in for this account' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(400).json({ error: 'Invalid credentials' });
        }

        const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);

        console.log('✅ User logged in:', user.email);

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                full_name: user.full_name,
                phone: user.phone,
                birth_year: user.birth_year,
                rating: user.rating,
                avatar_url: user.avatar_url
            }
        });
    } catch (error) {
        console.error('❌ Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/google', async (req, res) => {
    try {
        if (!GOOGLE_CLIENT_ID) {
            return res.status(503).json({ error: 'Google OAuth is not configured' });
        }

        const { credential } = req.body;
        
        if (!credential) {
            return res.status(400).json({ error: 'Google credential is required' });
        }

        const payload = decodeJWT(credential);
        if (!payload) {
            return res.status(400).json({ error: 'Invalid Google token' });
        }

        const { sub: googleId, email, name, picture } = payload;

        console.log('🔐 Google auth attempt:', { email, name, googleId });

        // Check if user exists
        const userResult = await pool.query(
            'SELECT * FROM users WHERE google_id = $1 OR email = $2',
            [googleId, email]
        );

        if (userResult.rows.length > 0) {
            const user = userResult.rows[0];
            const token = jwt.sign({ userId: user.id, username: user.username }, JWT_SECRET);
            
            console.log('✅ Google user logged in:', user.email);

            return res.json({
                exists: true,
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    email: user.email,
                    full_name: user.full_name,
                    phone: user.phone,
                    birth_year: user.birth_year,
                    rating: user.rating,
                    avatar_url: user.avatar_url
                }
            });
        } else {
            console.log('🆕 New Google user:', email);
            return res.json({
                exists: false,
                user: {
                    google_id: googleId,
                    email: email,
                    full_name: name,
                    avatar_url: picture,
                    email_verified: payload.email_verified
                }
            });
        }

    } catch (error) {
        console.error('❌ Google auth error:', error);
        res.status(500).json({ error: 'Google authentication failed' });
    }
});

// Ads Routes
app.get('/api/ads', async (req, res) => {
    try {
        const { page = 1, limit = 20, category, search } = req.query;
        const offset = (page - 1) * limit;

        let query = `
            SELECT 
                a.*,
                COALESCE(u.username, a.seller_info->>'name') as seller_username,
                COALESCE(u.full_name, a.seller_info->>'name') as seller_name,
                COALESCE(u.rating, 5.0) as seller_rating,
                COALESCE(u.phone, a.seller_info->>'phone') as seller_phone,
                c.name as category_name,
                c.icon as category_icon,
                COUNT(*) OVER() as total_count
            FROM ads a
            LEFT JOIN users u ON a.user_id = u.id
            LEFT JOIN categories c ON a.category_id = c.id
            WHERE a.is_active = TRUE
        `;
        
        let params = [];
        let paramCount = 0;

        if (category && category !== 'all') {
            paramCount++;
            query += ` AND c.name = $${paramCount}`;
            params.push(category);
        }

        if (search) {
            paramCount++;
            query += ` AND (a.title ILIKE $${paramCount} OR a.description ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }

        query += ` ORDER BY a.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(parseInt(limit), offset);

        const result = await pool.query(query, params);

        // Get favorites for authenticated users
        let favoriteAds = [];
        const authHeader = req.headers['authorization'];
        if (authHeader) {
            const token = authHeader.split(' ')[1];
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                const favoritesResult = await pool.query(
                    'SELECT ad_id FROM favorites WHERE user_id = $1',
                    [decoded.userId]
                );
                favoriteAds = favoritesResult.rows.map(row => row.ad_id);
            } catch (error) {
                // Invalid token, continue without favorites
            }
        }

        res.json({
            ads: result.rows.map(ad => ({
                id: ad.id,
                title: ad.title,
                description: ad.description,
                price: ad.price,
                category: ad.category_name,
                location: ad.location,
                isUrgent: ad.is_urgent,
                isFavorite: favoriteAds.includes(ad.id),
                seller: {
                    username: ad.seller_username,
                    name: ad.seller_name,
                    rating: ad.seller_rating,
                    phone: ad.seller_phone
                },
                image: ad.image_urls && ad.image_urls.length > 0 ? ad.image_urls[0] : null,
                time: formatTimeAgo(ad.created_at),
                views: ad.views
            })),
            total: result.rows[0]?.total_count || 0,
            page: parseInt(page),
            totalPages: Math.ceil((result.rows[0]?.total_count || 0) / limit)
        });
    } catch (error) {
        console.error('❌ Get ads error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/ads/:id', async (req, res) => {
    try {
        const { id } = req.params;

        await pool.query(
            'UPDATE ads SET views = views + 1 WHERE id = $1',
            [id]
        );

        const result = await pool.query(`
            SELECT 
                a.*,
                COALESCE(u.username, a.seller_info->>'name') as seller_username,
                COALESCE(u.full_name, a.seller_info->>'name') as seller_name,
                COALESCE(u.rating, 5.0) as seller_rating,
                COALESCE(u.phone, a.seller_info->>'phone') as seller_phone,
                u.created_at as seller_since,
                c.name as category_name
            FROM ads a
            LEFT JOIN users u ON a.user_id = u.id
            LEFT JOIN categories c ON a.category_id = c.id
            WHERE a.id = $1 AND a.is_active = TRUE
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Ad not found' });
        }

        const ad = result.rows[0];

        let isFavorite = false;
        const authHeader = req.headers['authorization'];
        if (authHeader) {
            const token = authHeader.split(' ')[1];
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                const favoriteResult = await pool.query(
                    'SELECT 1 FROM favorites WHERE user_id = $1 AND ad_id = $2',
                    [decoded.userId, id]
                );
                isFavorite = favoriteResult.rows.length > 0;
            } catch (error) {
                // Invalid token
            }
        }

        res.json({
            id: ad.id,
            title: ad.title,
            description: ad.description,
            price: ad.price,
            category: ad.category_name,
            location: ad.location,
            isUrgent: ad.is_urgent,
            isFavorite: isFavorite,
            views: ad.views,
            imageUrls: ad.image_urls || [],
            seller: {
                id: ad.user_id,
                username: ad.seller_username,
                name: ad.seller_name,
                rating: ad.seller_rating,
                phone: ad.seller_phone,
                since: formatTimeAgo(ad.seller_since)
            },
            time: formatTimeAgo(ad.created_at)
        });
    } catch (error) {
        console.error('❌ Get ad error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/ads', async (req, res) => {
    try {
        const { title, description, price, category_id, location, image_urls, is_urgent, seller_info } = req.body;
        
        if (!title || !description || !category_id) {
            return res.status(400).json({ error: 'Title, description and category are required' });
        }

        let user_id = null;
        let actual_seller_info = seller_info || {};

        const authHeader = req.headers['authorization'];
        if (authHeader) {
            const token = authHeader.split(' ')[1];
            try {
                const decoded = jwt.verify(token, JWT_SECRET);
                user_id = decoded.userId;
            } catch (error) {
                console.log('⚠️ Invalid token, creating anonymous ad');
            }
        }

        if (!user_id) {
            if (!seller_info || !seller_info.phone) {
                return res.status(400).json({ error: 'Phone number is required for anonymous ads' });
            }
            actual_seller_info = seller_info;
        }

        const result = await pool.query(`
            INSERT INTO ads (title, description, price, category_id, user_id, location, image_urls, is_urgent, seller_info)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
            RETURNING *
        `, [title, description, price, category_id, user_id, location, image_urls || [], is_urgent || false, actual_seller_info]);

        console.log('✅ Ad created:', title, user_id ? '(by user)' : '(anonymous)');

        res.json({
            message: 'Ad created successfully',
            ad: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Create ad error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Favorites Routes
app.get('/api/favorites', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;
        const user_id = req.user.userId;

        const result = await pool.query(`
            SELECT 
                a.*,
                COALESCE(u.username, a.seller_info->>'name') as seller_username,
                COALESCE(u.full_name, a.seller_info->>'name') as seller_name,
                COALESCE(u.rating, 5.0) as seller_rating,
                c.name as category_name,
                c.icon as category_icon,
                COUNT(*) OVER() as total_count
            FROM favorites f
            JOIN ads a ON f.ad_id = a.id
            LEFT JOIN users u ON a.user_id = u.id
            LEFT JOIN categories c ON a.category_id = c.id
            WHERE f.user_id = $1 AND a.is_active = TRUE
            ORDER BY f.created_at DESC
            LIMIT $2 OFFSET $3
        `, [user_id, limit, offset]);

        res.json({
            ads: result.rows.map(ad => ({
                id: ad.id,
                title: ad.title,
                description: ad.description,
                price: ad.price,
                category: ad.category_name,
                location: ad.location,
                isUrgent: ad.is_urgent,
                isFavorite: true,
                seller: {
                    username: ad.seller_username,
                    name: ad.seller_name,
                    rating: ad.seller_rating
                },
                image: ad.image_urls && ad.image_urls.length > 0 ? ad.image_urls[0] : null,
                time: formatTimeAgo(ad.created_at),
                views: ad.views
            })),
            total: result.rows[0]?.total_count || 0
        });
    } catch (error) {
        console.error('❌ Get favorites error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/favorites/:adId', authenticateToken, async (req, res) => {
    try {
        const { adId } = req.params;
        const user_id = req.user.userId;

        const adCheck = await pool.query('SELECT id FROM ads WHERE id = $1 AND is_active = TRUE', [adId]);
        if (adCheck.rows.length === 0) {
            return res.status(404).json({ error: 'Ad not found' });
        }

        await pool.query(`
            INSERT INTO favorites (user_id, ad_id)
            VALUES ($1, $2)
            ON CONFLICT (user_id, ad_id) DO NOTHING
        `, [user_id, adId]);

        res.json({ message: 'Added to favorites' });
    } catch (error) {
        console.error('❌ Add favorite error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.delete('/api/favorites/:adId', authenticateToken, async (req, res) => {
    try {
        const { adId } = req.params;
        const user_id = req.user.userId;

        await pool.query(`
            DELETE FROM favorites 
            WHERE user_id = $1 AND ad_id = $2
        `, [user_id, adId]);

        res.json({ message: 'Removed from favorites' });
    } catch (error) {
        console.error('❌ Remove favorite error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Categories Routes
app.get('/api/categories', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, name, icon, 
                   (SELECT COUNT(*) FROM ads WHERE category_id = categories.id AND is_active = TRUE) as ad_count
            FROM categories 
            ORDER BY name
        `);
        res.json(result.rows);
    } catch (error) {
        console.error('❌ Get categories error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Messages Routes
app.get('/api/messages/chats', authenticateToken, async (req, res) => {
    try {
        const user_id = req.user.userId;

        const result = await pool.query(`
            SELECT 
                c.id,
                CASE 
                    WHEN c.user1_id = $1 THEN u2.username
                    ELSE u1.username
                END as name,
                CASE 
                    WHEN c.user1_id = $1 THEN u2.id
                    ELSE u1.id
                END as contact_id,
                c.last_message,
                c.last_message_time,
                c.unread_count,
                'user' as type,
                CASE 
                    WHEN c.user1_id = $1 THEN u2.id
                    ELSE u1.id
                END != $1 as is_online
            FROM chats c
            LEFT JOIN users u1 ON c.user1_id = u1.id
            LEFT JOIN users u2 ON c.user2_id = u2.id
            WHERE c.user1_id = $1 OR c.user2_id = $1
            ORDER BY c.last_message_time DESC
        `, [user_id]);

        if (result.rows.length === 0) {
            result.rows.push({
                id: 'support',
                name: 'Поддержка Zeeptook',
                contact_id: 'support',
                last_message: 'Здравствуйте! Чем могу помочь?',
                last_message_time: new Date(),
                unread_count: 0,
                type: 'support',
                is_online: true
            });
        }

        res.json(result.rows);
    } catch (error) {
        console.error('❌ Get chats error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/messages/chat/:chatId', authenticateToken, async (req, res) => {
    try {
        const { chatId } = req.params;
        const user_id = req.user.userId;

        if (chatId === 'support') {
            const result = await pool.query(`
                SELECT 
                    m.*,
                    u.username as sender_username
                FROM messages m
                LEFT JOIN users u ON m.sender_id = u.id
                WHERE (m.sender_id = $1 AND m.receiver_id = 1) 
                   OR (m.sender_id = 1 AND m.receiver_id = $1)
                ORDER BY m.created_at ASC
            `, [user_id]);
            res.json(result.rows);
        } else {
            const chatCheck = await pool.query(
                'SELECT user1_id, user2_id FROM chats WHERE id = $1',
                [chatId]
            );

            if (chatCheck.rows.length === 0) {
                return res.status(404).json({ error: 'Chat not found' });
            }

            const chat = chatCheck.rows[0];
            const otherUserId = chat.user1_id === user_id ? chat.user2_id : chat.user1_id;

            const result = await pool.query(`
                SELECT 
                    m.*,
                    u.username as sender_username
                FROM messages m
                LEFT JOIN users u ON m.sender_id = u.id
                WHERE (m.sender_id = $1 AND m.receiver_id = $2)
                   OR (m.sender_id = $2 AND m.receiver_id = $1)
                ORDER BY m.created_at ASC
            `, [user_id, otherUserId]);

            res.json(result.rows);
        }
    } catch (error) {
        console.error('❌ Get chat messages error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/messages', authenticateToken, async (req, res) => {
    try {
        const { chat_id, content, receiver_id, ad_id } = req.body;
        const sender_id = req.user.userId;

        if (!content) {
            return res.status(400).json({ error: 'Message content is required' });
        }

        let actual_receiver_id = receiver_id;
        let actual_chat_id = chat_id;

        if (chat_id === 'support') {
            actual_receiver_id = 1;
            actual_chat_id = null;
        }

        const result = await pool.query(`
            INSERT INTO messages (sender_id, receiver_id, ad_id, content)
            VALUES ($1, $2, $3, $4)
            RETURNING *
        `, [sender_id, actual_receiver_id, ad_id, content]);

        if (actual_chat_id && actual_chat_id !== 'support') {
            await pool.query(`
                UPDATE chats 
                SET last_message = $1, last_message_time = CURRENT_TIMESTAMP, unread_count = unread_count + 1
                WHERE id = $2
            `, [content, actual_chat_id]);
        }

        res.json({
            message: 'Message sent successfully',
            message: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Send message error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Profile Routes
app.get('/api/profile', authenticateToken, async (req, res) => {
    try {
        const user_id = req.user.userId;

        const userResult = await pool.query(`
            SELECT id, username, email, full_name, phone, birth_year, avatar_url, rating, created_at
            FROM users WHERE id = $1
        `, [user_id]);

        if (userResult.rows.length === 0) {
            return res.status(404).json({ error: 'User not found' });
        }

        const adsResult = await pool.query(`
            SELECT COUNT(*) as total_ads,
                   COUNT(CASE WHEN is_active = TRUE THEN 1 END) as active_ads
            FROM ads WHERE user_id = $1
        `, [user_id]);

        const favoritesResult = await pool.query(`
            SELECT COUNT(*) as total_favorites
            FROM favorites WHERE user_id = $1
        `, [user_id]);

        res.json({
            user: userResult.rows[0],
            stats: {
                total_ads: parseInt(adsResult.rows[0].total_ads || 0),
                active_ads: parseInt(adsResult.rows[0].active_ads || 0),
                total_favorites: parseInt(favoritesResult.rows[0].total_favorites || 0)
            }
        });
    } catch (error) {
        console.error('❌ Get profile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.put('/api/profile', authenticateToken, async (req, res) => {
    try {
        const user_id = req.user.userId;
        const { full_name, phone, birth_year, avatar_url } = req.body;

        const result = await pool.query(`
            UPDATE users 
            SET full_name = $1, phone = $2, birth_year = $3, avatar_url = $4, updated_at = CURRENT_TIMESTAMP
            WHERE id = $5
            RETURNING id, username, email, full_name, phone, birth_year, avatar_url, rating
        `, [full_name, phone, birth_year, avatar_url, user_id]);

        res.json({
            message: 'Profile updated successfully',
            user: result.rows[0]
        });
    } catch (error) {
        console.error('❌ Update profile error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

// Utility Routes
app.get('/api/health', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ 
            status: 'OK', 
            database: 'connected',
            google_oauth: !!GOOGLE_CLIENT_ID,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ 
            status: 'ERROR', 
            database: 'disconnected',
            google_oauth: !!GOOGLE_CLIENT_ID,
            timestamp: new Date().toISOString()
        });
    }
});

// Error handlers
app.use('/api/*', (req, res) => {
    res.status(404).json({ error: 'API endpoint not found' });
});

app.use((req, res) => {
    res.status(404).send('Page not found');
});

// Start server
if (process.env.NODE_ENV !== 'production') {
    const startServer = async () => {
        try {
            console.log('🚀 Starting Zeeptook server...');
            
            // Test database connection
            await pool.query('SELECT 1');
            console.log('✅ Database connected');
            
            // Initialize database
            await initializeDatabase();
            
            app.listen(PORT, () => {
                console.log('🎉 Server running on http://localhost:' + PORT);
                console.log('');
                console.log('📊 Available endpoints:');
                console.log('   GET  /api/ads               - Get ads');
                console.log('   POST /api/ads               - Create ad');
                console.log('   POST /api/register          - Register');
                console.log('   POST /api/login             - Login');
                console.log('   POST /api/auth/google       - Google OAuth');
                console.log('   GET  /api/profile           - User profile');
                console.log('   GET  /api/health            - Health check');
                console.log('');
            });
        } catch (error) {
            console.error('❌ Failed to start server:', error);
            process.exit(1);
        }
    };

    startServer();
}

// Export for Vercel
module.exports = app;
