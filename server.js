const express = require('express');
const { Client } = require('pg');
const path = require('path');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Google OAuth client
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

// Database connection
let db = null;
let isDatabaseConnected = false;

// Initialize database connection
async function initializeDatabase() {
  if (isDatabaseConnected && db) {
    return db;
  }

  try {
    console.log('🔄 Подключение к Neon.tech PostgreSQL...');
    
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: {
        rejectUnauthorized: false
      },
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
    });

    await client.connect();
    db = client;
    isDatabaseConnected = true;
    
    console.log('✅ Успешное подключение к Neon.tech');
    
    // Проверяем существование таблиц, создаем если нет
    await createAllTablesIfNeeded();
    
    return db;
  } catch (err) {
    console.error('❌ Ошибка подключения к Neon.tech:', err);
    isDatabaseConnected = false;
    db = null;
    throw err;
  }
}

// Создание всех таблиц если не существуют
async function createAllTablesIfNeeded() {
  try {
    // Таблица пользователей
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255),
        first_name VARCHAR(100),
        last_name VARCHAR(100),
        full_name VARCHAR(200),
        phone VARCHAR(20),
        avatar_url TEXT,
        google_id VARCHAR(100) UNIQUE,
        email_verified BOOLEAN DEFAULT false,
        auth_method VARCHAR(20) DEFAULT 'email',
        is_admin BOOLEAN DEFAULT false,
        login_count INTEGER DEFAULT 0,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица категорий
    await db.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        image TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица товаров
    await db.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(200) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        old_price DECIMAL(10,2),
        category_id INTEGER REFERENCES categories(id),
        manufacturer VARCHAR(100),
        country VARCHAR(100),
        stock_quantity INTEGER DEFAULT 0,
        in_stock BOOLEAN DEFAULT true,
        is_popular BOOLEAN DEFAULT false,
        is_new BOOLEAN DEFAULT false,
        image TEXT,
        composition TEXT,
        indications TEXT,
        usage TEXT,
        contraindications TEXT,
        dosage TEXT,
        expiry_date VARCHAR(50),
        storage_conditions TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица корзины
    await db.query(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,
        quantity INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, product_id)
      )
    `);

    // Таблица адресов пользователей
    await db.query(`
      CREATE TABLE IF NOT EXISTS user_addresses (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        address TEXT NOT NULL,
        latitude DECIMAL(10, 8),
        longitude DECIMAL(11, 8),
        is_default BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица заказов
    await db.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        order_code VARCHAR(50) UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        total_amount DECIMAL(10,2) NOT NULL,
        delivery_address TEXT NOT NULL,
        customer_name VARCHAR(200) NOT NULL,
        customer_phone VARCHAR(20) NOT NULL,
        customer_notes TEXT,
        payment_method VARCHAR(50) DEFAULT 'cash',
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица элементов заказа
    await db.query(`
      CREATE TABLE IF NOT EXISTS order_items (
        id SERIAL PRIMARY KEY,
        order_id INTEGER REFERENCES orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        product_name VARCHAR(200) NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        total_price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица курьеров
    await db.query(`
      CREATE TABLE IF NOT EXISTS couriers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        courier_code VARCHAR(50) UNIQUE NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        email VARCHAR(255) NOT NULL,
        vehicle_type VARCHAR(50) DEFAULT 'bicycle',
        vehicle_number VARCHAR(50),
        status VARCHAR(50) DEFAULT 'active',
        total_orders INTEGER DEFAULT 0,
        completed_orders INTEGER DEFAULT 0,
        current_daily_orders INTEGER DEFAULT 0,
        total_earnings DECIMAL(10,2) DEFAULT 0,
        today_earnings DECIMAL(10,2) DEFAULT 0,
        last_activity TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица заказов доставки
    await db.query(`
      CREATE TABLE IF NOT EXISTS delivery_orders (
        id SERIAL PRIMARY KEY,
        order_code VARCHAR(50) UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        total_amount DECIMAL(10,2) NOT NULL,
        delivery_address TEXT NOT NULL,
        customer_name VARCHAR(200) NOT NULL,
        customer_phone VARCHAR(20) NOT NULL,
        customer_notes TEXT,
        payment_method VARCHAR(50) DEFAULT 'cash',
        status VARCHAR(50) DEFAULT 'pending',
        courier_id INTEGER REFERENCES couriers(id),
        assigned_at TIMESTAMP,
        delivered_at TIMESTAMP,
        cancelled_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица элементов заказа доставки
    await db.query(`
      CREATE TABLE IF NOT EXISTS delivery_order_items (
        id SERIAL PRIMARY KEY,
        delivery_order_id INTEGER REFERENCES delivery_orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        product_name VARCHAR(200) NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        total_price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица сообщений курьеров
    await db.query(`
      CREATE TABLE IF NOT EXISTS courier_messages (
        id SERIAL PRIMARY KEY,
        courier_id INTEGER REFERENCES couriers(id) ON DELETE CASCADE,
        subject VARCHAR(200) NOT NULL,
        message TEXT NOT NULL,
        message_type VARCHAR(50) DEFAULT 'info',
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица чатов курьеров
    await db.query(`
      CREATE TABLE IF NOT EXISTS courier_chats (
        id SERIAL PRIMARY KEY,
        courier_id INTEGER REFERENCES couriers(id) ON DELETE CASCADE,
        participant_type VARCHAR(50) DEFAULT 'support',
        participant_name VARCHAR(100) NOT NULL,
        last_message TEXT,
        last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        unread_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица сообщений чатов курьеров
    await db.query(`
      CREATE TABLE IF NOT EXISTS courier_chat_messages (
        id SERIAL PRIMARY KEY,
        chat_id INTEGER REFERENCES courier_chats(id) ON DELETE CASCADE,
        sender_type VARCHAR(50) NOT NULL,
        sender_name VARCHAR(100) NOT NULL,
        message TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица расписания работы курьеров
    await db.query(`
      CREATE TABLE IF NOT EXISTS courier_work_schedule (
        id SERIAL PRIMARY KEY,
        courier_id INTEGER REFERENCES couriers(id) ON DELETE CASCADE,
        day_of_week INTEGER NOT NULL,
        start_time TIME NOT NULL,
        end_time TIME NOT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Все таблицы проверены/созданы');
  } catch (err) {
    console.error('❌ Ошибка создания таблиц:', err);
  }
}

// Database connection middleware
async function databaseMiddleware(req, res, next) {
  try {
    if (!isDatabaseConnected) {
      await initializeDatabase();
    }
    req.db = db;
    next();
  } catch (err) {
    console.error('❌ Ошибка подключения к БД в middleware:', err);
    return res.status(503).json({
      success: false,
      error: 'Сервис временно недоступен. База данных не подключена.'
    });
  }
}

// Password hashing functions
async function hashPassword(password) {
  return await bcrypt.hash(password, 10);
}

async function comparePassword(password, hashedPassword) {
  return await bcrypt.compare(password, hashedPassword);
}

// Simple password hash function for fallback
function simpleHash(password) {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString();
}

// User validation middleware
async function validateUser(req, res, next) {
  const { user_id } = req.body;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    const { rows } = await req.db.query('SELECT id FROM users WHERE id = $1', [user_id]);
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }

    req.userId = user_id;
    next();
  } catch (err) {
    console.error('❌ Ошибка валидации пользователя:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
}

// ==================== GOOGLE AUTH & REGISTRATION ====================

// Get Google Client ID for frontend
app.get('/api/config/google', (req, res) => {
  console.log('📨 GET /api/config/google');
  
  const googleClientId = process.env.GOOGLE_CLIENT_ID || 'not-configured';
  
  res.json({
    success: true,
    googleClientId: googleClientId,
    isConfigured: googleClientId !== 'not-configured'
  });
});

// Verify Google token and login/register
app.post('/api/auth/google', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/auth/google');
  
  const { credential } = req.body;
  
  if (!credential) {
    return res.status(400).json({
      success: false,
      error: 'Токен Google обязателен'
    });
  }

  try {
    // Verify Google token
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    
    const payload = ticket.getPayload();
    
    if (!payload) {
      return res.status(401).json({
        success: false,
        error: 'Неверный Google токен'
      });
    }
    
    console.log('✅ Google токен верифицирован:', payload.email);
    
    // Check if user exists by google_id or email
    const { rows } = await req.db.query(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2',
      [payload.sub, payload.email]
    );
    
    if (rows.length > 0) {
      // Existing user - login
      const user = rows[0];
      
      // Update user data from Google
      await req.db.query(
        `UPDATE users SET 
          first_name = COALESCE($1, first_name),
          last_name = COALESCE($2, last_name),
          full_name = COALESCE($3, full_name),
          avatar_url = COALESCE($4, avatar_url),
          email_verified = COALESCE($5, email_verified),
          google_id = COALESCE($6, google_id),
          last_login = CURRENT_TIMESTAMP,
          login_count = login_count + 1,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $7`,
        [
          payload.given_name || user.first_name,
          payload.family_name || user.last_name,
          payload.name || user.full_name,
          payload.picture || user.avatar_url,
          payload.email_verified || user.email_verified,
          payload.sub || user.google_id,
          user.id
        ]
      );
      
      // Get updated user
      const { rows: updatedRows } = await req.db.query(
        'SELECT * FROM users WHERE id = $1',
        [user.id]
      );
      
      const updatedUser = updatedRows[0];
      delete updatedUser.password;
      
      console.log('✅ Существующий пользователь обновлен:', updatedUser.email);
      
      res.json({
        success: true,
        exists: true,
        user: updatedUser,
        message: 'Вход через Google успешен'
      });
    } else {
      // New user - return basic info for registration completion
      console.log('🆕 Новый пользователь Google:', payload.email);
      
      res.json({
        success: true,
        exists: false,
        user: {
          google_id: payload.sub,
          email: payload.email,
          email_verified: payload.email_verified || false,
          name: payload.name || '',
          given_name: payload.given_name || '',
          family_name: payload.family_name || '',
          picture: payload.picture || '',
          locale: payload.locale || 'ru'
        },
        message: 'Пожалуйста, завершите регистрацию'
      });
    }
  } catch (err) {
    console.error('❌ Ошибка Google аутентификации:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка Google аутентификации: ' + err.message
    });
  }
});

// Complete Google registration
app.post('/api/auth/google/complete', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/auth/google/complete');
  
  const { 
    google_id, 
    email, 
    username, 
    password, 
    first_name, 
    last_name, 
    phone,
    avatar 
  } = req.body;
  
  if (!google_id || !email) {
    return res.status(400).json({
      success: false,
      error: 'Google ID и email обязательны'
    });
  }
  
  if (!username) {
    return res.status(400).json({
      success: false,
      error: 'Логин обязателен'
    });
  }

  try {
    // Check if username or email already exists
    const { rows: existingUsers } = await req.db.query(
      'SELECT * FROM users WHERE username = $1 OR email = $2 OR google_id = $3',
      [username, email, google_id]
    );
    
    if (existingUsers.length > 0) {
      const existingUser = existingUsers[0];
      
      if (existingUser.google_id === google_id) {
        return res.status(400).json({
          success: false,
          error: 'Аккаунт Google уже зарегистрирован'
        });
      }
      
      if (existingUser.username === username) {
        return res.status(400).json({
          success: false,
          error: 'Логин уже занят'
        });
      }
      
      if (existingUser.email === email) {
        return res.status(400).json({
          success: false,
          error: 'Email уже зарегистрирован'
        });
      }
    }
    
    // Hash password if provided
    let hashedPassword = null;
    if (password && password.length >= 6) {
      hashedPassword = await hashPassword(password);
    }
    
    // Generate display name
    const fullName = first_name && last_name 
      ? `${first_name} ${last_name}`
      : first_name || last_name || username;
    
    // Create user
    const { rows } = await req.db.query(
      `INSERT INTO users (
        username, email, password, full_name, first_name, last_name, 
        phone, avatar_url, google_id, email_verified, auth_method, login_count,
        last_login
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CURRENT_TIMESTAMP)
      RETURNING id, username, email, full_name, first_name, last_name, 
                phone, avatar_url, google_id, email_verified, auth_method, 
                created_at, last_login`,
      [
        username,
        email,
        hashedPassword,
        fullName,
        first_name || '',
        last_name || '',
        phone || null,
        avatar || '',
        google_id,
        true,
        'google',
        1
      ]
    );
    
    const newUser = rows[0];
    console.log('✅ Новый пользователь Google зарегистрирован:', newUser.email);
    
    res.json({
      success: true,
      user: newUser,
      message: 'Регистрация через Google успешна'
    });
    
  } catch (err) {
    console.error('❌ Ошибка завершения регистрации Google:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка регистрации: ' + err.message
    });
  }
});

// ==================== EMAIL REGISTRATION & LOGIN ====================

// User registration with email
app.post('/api/auth/register', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/auth/register');
  
  const { 
    username, 
    email, 
    password, 
    first_name, 
    last_name, 
    phone 
  } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({
      success: false,
      error: 'Логин, email и пароль обязательны'
    });
  }
  
  if (password.length < 6) {
    return res.status(400).json({
      success: false,
      error: 'Пароль должен содержать минимум 6 символов'
    });
  }

  try {
    // Check if username or email already exists
    const { rows: existingUsers } = await req.db.query(
      'SELECT * FROM users WHERE username = $1 OR email = $2',
      [username, email]
    );
    
    if (existingUsers.length > 0) {
      const existingUser = existingUsers[0];
      
      if (existingUser.username === username) {
        return res.status(400).json({
          success: false,
          error: 'Логин уже занят'
        });
      }
      
      if (existingUser.email === email) {
        return res.status(400).json({
          success: false,
          error: 'Email уже зарегистрирован'
        });
      }
    }
    
    // Hash password
    const hashedPassword = await hashPassword(password);
    
    // Generate display name
    const fullName = first_name && last_name 
      ? `${first_name} ${last_name}`
      : first_name || last_name || username;
    
    // Create user
    const { rows } = await req.db.query(
      `INSERT INTO users (
        username, email, password, full_name, first_name, last_name, 
        phone, auth_method
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING id, username, email, full_name, first_name, last_name, 
                phone, auth_method, created_at`,
      [
        username,
        email,
        hashedPassword,
        fullName,
        first_name || '',
        last_name || '',
        phone || null,
        'email'
      ]
    );
    
    const newUser = rows[0];
    console.log('✅ Новый пользователь зарегистрирован:', newUser.email);
    
    res.json({
      success: true,
      user: newUser,
      message: 'Регистрация успешна'
    });
    
  } catch (err) {
    console.error('❌ Ошибка регистрации:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка регистрации: ' + err.message
    });
  }
});

// User login with email/username
app.post('/api/auth/login', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/auth/login');
  
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({
      success: false,
      error: 'Логин и пароль обязательны'
    });
  }

  try {
    // Find user by username or email
    const { rows } = await req.db.query(
      "SELECT * FROM users WHERE username = $1 OR email = $1",
      [username]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }
    
    const user = rows[0];
    
    // Check password
    let passwordValid = false;
    
    // Try bcrypt first
    if (user.password && user.password.startsWith('$2')) {
      try {
        passwordValid = await comparePassword(password, user.password);
      } catch (err) {
        console.log('⚠️  Ошибка bcrypt сравнения:', err);
        // Fallback to simple hash for old users
        passwordValid = simpleHash(password) === user.password;
      }
    } else {
      // Use simple hash for old users
      passwordValid = simpleHash(password) === user.password;
    }
    
    if (!passwordValid) {
      return res.status(401).json({
        success: false,
        error: 'Неверный пароль'
      });
    }
    
    // Update login stats
    await req.db.query(
      "UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = $1",
      [user.id]
    );
    
    // Remove password from response
    delete user.password;
    
    res.json({
      success: true,
      user: user,
      message: 'Вход выполнен успешно'
    });
    
  } catch (err) {
    console.error('❌ Ошибка входа:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Get current user
app.get('/api/auth/me', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/auth/me');
  
  const user_id = req.query.user_id || req.headers['user-id'];
  
  if (!user_id) {
    return res.status(401).json({
      success: false,
      error: 'Не авторизован'
    });
  }

  try {
    const { rows } = await req.db.query(
      `SELECT id, username, email, full_name, first_name, last_name, 
              phone, avatar_url, google_id, email_verified, auth_method,
              created_at, last_login, login_count
       FROM users WHERE id = $1`,
      [user_id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }
    
    const user = rows[0];
    
    res.json({
      success: true,
      user: user
    });
    
  } catch (err) {
    console.error('❌ Ошибка получения пользователя:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// ==================== CATEGORIES ====================

// Get all categories
app.get('/api/categories', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/categories');
  
  try {
    const { rows } = await req.db.query(
      'SELECT * FROM categories ORDER BY name ASC'
    );
    
    res.json({
      success: true,
      categories: rows
    });
    
  } catch (err) {
    console.error('❌ Ошибка получения категорий:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения категорий: ' + err.message
    });
  }
});

// ==================== PRODUCTS ====================

// Get products with filters
app.get('/api/products', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/products');
  
  const { 
    category, 
    search, 
    popular, 
    new: newProducts, 
    category_id, 
    limit = 50, 
    page = 1 
  } = req.query;
  
  try {
    let sql = `
      SELECT p.*, c.name as category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      WHERE 1=1
    `;
    
    let params = [];
    let paramCount = 1;
    
    if (category && category !== 'all') {
      sql += ` AND c.name = $${paramCount++}`;
      params.push(category);
    }
    
    if (category_id) {
      sql += ` AND p.category_id = $${paramCount++}`;
      params.push(parseInt(category_id));
    }
    
    if (search) {
      sql += ` AND (
        p.name ILIKE $${paramCount} OR 
        p.description ILIKE $${paramCount} OR 
        p.manufacturer ILIKE $${paramCount} OR 
        c.name ILIKE $${paramCount}
      )`;
      params.push(`%${search}%`);
      paramCount++;
    }
    
    if (popular === 'true') {
      sql += ` AND p.is_popular = true`;
    }
    
    if (newProducts === 'true') {
      sql += ` AND p.is_new = true`;
    }
    
    sql += ` ORDER BY p.created_at DESC`;
    
    // Add pagination
    const offset = (parseInt(page) - 1) * parseInt(limit);
    sql += ` LIMIT $${paramCount++} OFFSET $${paramCount++}`;
    params.push(parseInt(limit), offset);
    
    const { rows } = await req.db.query(sql, params);
    
    // Get total count
    let countSql = `
      SELECT COUNT(*) as total 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      WHERE 1=1
    `;
    
    let countParams = [];
    paramCount = 1;
    
    if (category && category !== 'all') {
      countSql += ` AND c.name = $${paramCount++}`;
      countParams.push(category);
    }
    
    if (category_id) {
      countSql += ` AND p.category_id = $${paramCount++}`;
      countParams.push(parseInt(category_id));
    }
    
    if (search) {
      countSql += ` AND (
        p.name ILIKE $${paramCount} OR 
        p.description ILIKE $${paramCount} OR 
        p.manufacturer ILIKE $${paramCount} OR 
        c.name ILIKE $${paramCount}
      )`;
      countParams.push(`%${search}%`);
    }
    
    const { rows: countRows } = await req.db.query(countSql, countParams);
    const total = parseInt(countRows[0]?.total) || 0;
    
    res.json({
      success: true,
      products: rows,
      total: total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    });
    
  } catch (err) {
    console.error('❌ Ошибка получения товаров:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения товаров: ' + err.message
    });
  }
});

// Get single product
app.get('/api/products/:id', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/products/' + req.params.id);
  
  try {
    const { rows } = await req.db.query(
      `SELECT p.*, c.name as category_name 
       FROM products p 
       LEFT JOIN categories c ON p.category_id = c.id 
       WHERE p.id = $1`,
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Товар не найден'
      });
    }
    
    res.json({
      success: true,
      product: rows[0]
    });
    
  } catch (err) {
    console.error('❌ Ошибка получения товара:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения товара: ' + err.message
    });
  }
});

// ==================== USER PROFILE ====================

// Get user profile with addresses
app.get('/api/user/profile', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/user/profile');
  
  const { user_id } = req.query;
  
  if (!user_id) {
    return res.status(401).json({
      success: false,
      error: 'Не авторизован'
    });
  }

  try {
    const { rows } = await req.db.query(
      `SELECT id, username, email, full_name, first_name, last_name, 
              phone, avatar_url, google_id, email_verified, auth_method,
              created_at, last_login, login_count
       FROM users WHERE id = $1`,
      [user_id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }
    
    const user = rows[0];
    
    // Get user addresses
    const { rows: addressRows } = await req.db.query(
      'SELECT * FROM user_addresses WHERE user_id = $1 ORDER BY is_default DESC',
      [user_id]
    );
    
    user.addresses = addressRows;
    user.default_address = addressRows.find(addr => addr.is_default) || null;
    
    res.json({
      success: true,
      user: user
    });
    
  } catch (err) {
    console.error('❌ Ошибка получения профиля:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения профиля'
    });
  }
});

// Update user profile
app.put('/api/user/update-profile', databaseMiddleware, validateUser, async (req, res) => {
  console.log('📨 PUT /api/user/update-profile');
  
  const { first_name, last_name, phone } = req.body;
  
  try {
    await req.db.query(
      'UPDATE users SET first_name = $1, last_name = $2, phone = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4',
      [first_name, last_name, phone, req.userId]
    );

    const { rows } = await req.db.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    const user = rows[0];
    delete user.password;

    res.json({
      success: true,
      message: 'Профиль успешно обновлен',
      user: user
    });
  } catch (err) {
    console.error('❌ Ошибка обновления профиля:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка обновления профиля'
    });
  }
});

// Change password
app.post('/api/user/change-password', databaseMiddleware, validateUser, async (req, res) => {
  console.log('📨 POST /api/user/change-password');
  
  const { current_password, new_password } = req.body;
  
  if (!current_password || !new_password) {
    return res.status(400).json({
      success: false,
      error: 'Все поля обязательны'
    });
  }

  try {
    const { rows } = await req.db.query('SELECT * FROM users WHERE id = $1', [req.userId]);
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }

    const user = rows[0];
    
    let passwordValid = false;
    
    // Try bcrypt first
    if (user.password && user.password.startsWith('$2')) {
      try {
        passwordValid = await comparePassword(current_password, user.password);
      } catch (err) {
        console.log('⚠️  Ошибка bcrypt сравнения:', err);
        // Fallback to simple hash
        passwordValid = simpleHash(current_password) === user.password;
      }
    } else {
      // Use simple hash
      passwordValid = simpleHash(current_password) === user.password;
    }
    
    if (!passwordValid) {
      return res.status(400).json({
        success: false,
        error: 'Текущий пароль неверен'
      });
    }

    const hashedNewPassword = await hashPassword(new_password);
    await req.db.query('UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [hashedNewPassword, req.userId]);

    res.json({
      success: true,
      message: 'Пароль успешно изменен'
    });
  } catch (err) {
    console.error('❌ Ошибка смены пароля:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка смены пароля'
    });
  }
});

// Upload avatar
app.post('/api/user/upload-avatar', databaseMiddleware, validateUser, async (req, res) => {
  console.log('📨 POST /api/user/upload-avatar');
  
  const { avatar } = req.body;
  
  try {
    await req.db.query(
      'UPDATE users SET avatar_url = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [avatar, req.userId]
    );

    res.json({
      success: true,
      message: 'Аватар успешно загружен',
      avatar_url: avatar
    });
  } catch (err) {
    console.error('❌ Ошибка загрузки аватарки:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка загрузки аватарки'
    });
  }
});

// ==================== ADDRESS MANAGEMENT ====================

// Save address from map
app.post('/api/addresses/save', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/addresses/save');
  
  const { user_id, address, latitude, longitude, is_default = false } = req.body;
  
  if (!user_id || !address) {
    return res.status(400).json({
      success: false,
      error: 'user_id и адрес обязательны'
    });
  }

  try {
    // Check if user exists
    const { rows: userRows } = await req.db.query(
      'SELECT id FROM users WHERE id = $1',
      [user_id]
    );
    
    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }
    
    // If setting as default, unset other defaults
    if (is_default) {
      await req.db.query(
        'UPDATE user_addresses SET is_default = false WHERE user_id = $1',
        [user_id]
      );
    }
    
    // Save address
    const { rows } = await req.db.query(
      `INSERT INTO user_addresses (user_id, address, latitude, longitude, is_default)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [user_id, address, latitude || null, longitude || null, is_default]
    );
    
    const savedAddress = rows[0];
    console.log('✅ Адрес сохранен для пользователя:', user_id);
    
    res.json({
      success: true,
      address: savedAddress,
      message: 'Адрес успешно сохранен'
    });
    
  } catch (err) {
    console.error('❌ Ошибка сохранения адреса:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка сохранения адреса: ' + err.message
    });
  }
});

// Get user addresses
app.get('/api/addresses', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/addresses');
  
  const { user_id } = req.query;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    const { rows } = await req.db.query(
      `SELECT * FROM user_addresses 
       WHERE user_id = $1 
       ORDER BY is_default DESC, created_at DESC`,
      [user_id]
    );
    
    res.json({
      success: true,
      addresses: rows,
      default_address: rows.find(addr => addr.is_default) || null
    });
    
  } catch (err) {
    console.error('❌ Ошибка получения адресов:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения адресов: ' + err.message
    });
  }
});

// Set default address
app.post('/api/addresses/set-default', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/addresses/set-default');
  
  const { user_id, address_id } = req.body;
  
  if (!user_id || !address_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id и address_id обязательны'
    });
  }

  try {
    // Unset all defaults
    await req.db.query(
      'UPDATE user_addresses SET is_default = false WHERE user_id = $1',
      [user_id]
    );
    
    // Set new default
    const { rows } = await req.db.query(
      `UPDATE user_addresses 
       SET is_default = true, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $1 AND user_id = $2 
       RETURNING *`,
      [address_id, user_id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Адрес не найден'
      });
    }
    
    res.json({
      success: true,
      address: rows[0],
      message: 'Адрес установлен как основной'
    });
    
  } catch (err) {
    console.error('❌ Ошибка установки основного адреса:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка установки основного адреса: ' + err.message
    });
  }
});

// Delete address
app.delete('/api/addresses/:address_id', databaseMiddleware, async (req, res) => {
  console.log('📨 DELETE /api/addresses/' + req.params.address_id);
  
  const { user_id } = req.query;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    const { rows } = await req.db.query(
      'DELETE FROM user_addresses WHERE id = $1 AND user_id = $2 RETURNING *',
      [req.params.address_id, user_id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Адрес не найден'
      });
    }
    
    res.json({
      success: true,
      message: 'Адрес удален'
    });
    
  } catch (err) {
    console.error('❌ Ошибка удаления адреса:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка удаления адреса: ' + err.message
    });
  }
});

// ==================== CART MANAGEMENT ====================

// Get cart items
app.get('/api/cart', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/cart');
  
  const { user_id } = req.query;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    const { rows } = await req.db.query(
      `SELECT ci.*, p.name, p.price, p.image, p.description, 
              p.manufacturer, p.in_stock
       FROM cart_items ci
       LEFT JOIN products p ON ci.product_id = p.id
       WHERE ci.user_id = $1
       ORDER BY ci.created_at DESC`,
      [user_id]
    );
    
    const total = rows.reduce((sum, item) => {
      return sum + (parseFloat(item.price) * parseInt(item.quantity));
    }, 0);
    
    res.json({
      success: true,
      items: rows,
      total: total
    });
    
  } catch (err) {
    console.error('❌ Ошибка получения корзины:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения корзины: ' + err.message
    });
  }
});

// Add to cart
app.post('/api/cart/add', databaseMiddleware, validateUser, async (req, res) => {
  console.log('📨 POST /api/cart/add');
  
  const { product_id, quantity = 1 } = req.body;
  
  if (!product_id) {
    return res.status(400).json({
      success: false,
      error: 'product_id обязателен'
    });
  }

  try {
    // Check if product exists
    const { rows: products } = await req.db.query('SELECT * FROM products WHERE id = $1', [product_id]);
    if (products.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Товар не найден'
      });
    }

    // Add or update item in cart
    const { rows } = await req.db.query(
      `INSERT INTO cart_items (user_id, product_id, quantity) 
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id) 
       DO UPDATE SET quantity = cart_items.quantity + $3,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [req.userId, product_id, quantity]
    );

    res.json({
      success: true,
      message: 'Товар добавлен в корзину',
      item: rows[0]
    });
  } catch (err) {
    console.error('❌ Ошибка добавления в корзину:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера: ' + err.message
    });
  }
});

// Update cart item quantity
app.put('/api/cart/:itemId', databaseMiddleware, validateUser, async (req, res) => {
  console.log('📨 PUT /api/cart/' + req.params.itemId);
  
  const { quantity } = req.body;
  
  if (!quantity || quantity < 1) {
    return res.status(400).json({
      success: false,
      error: 'Количество должно быть не менее 1'
    });
  }

  try {
    await req.db.query(
      'UPDATE cart_items SET quantity = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND user_id = $3',
      [quantity, req.params.itemId, req.userId]
    );

    res.json({
      success: true,
      message: 'Количество обновлено'
    });
  } catch (err) {
    console.error('❌ Ошибка обновления корзины:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Remove from cart
app.delete('/api/cart/:itemId', databaseMiddleware, validateUser, async (req, res) => {
  console.log('📨 DELETE /api/cart/' + req.params.itemId);
  
  try {
    await req.db.query(
      'DELETE FROM cart_items WHERE id = $1 AND user_id = $2',
      [req.params.itemId, req.userId]
    );

    res.json({
      success: true,
      message: 'Товар удален из корзины'
    });
  } catch (err) {
    console.error('❌ Ошибка удаления из корзины:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Clear cart
app.delete('/api/cart', databaseMiddleware, validateUser, async (req, res) => {
  console.log('📨 DELETE /api/cart');
  
  try {
    await req.db.query('DELETE FROM cart_items WHERE user_id = $1', [req.userId]);

    res.json({
      success: true,
      message: 'Корзина очищена'
    });
  } catch (err) {
    console.error('❌ Ошибка очистки корзины:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// ==================== ORDER MANAGEMENT ====================

// Create order
app.post('/api/orders/create', databaseMiddleware, validateUser, async (req, res) => {
  console.log('📨 POST /api/orders/create');
  
  const {
    product_id,
    quantity,
    total_amount,
    customer_name,
    customer_phone,
    delivery_address,
    customer_notes,
    payment_method
  } = req.body;

  if (!product_id || !quantity || !total_amount || !customer_name || !customer_phone || !delivery_address) {
    return res.status(400).json({
      success: false,
      error: 'Все обязательные поля должны быть заполнены'
    });
  }

  try {
    // Генерируем уникальный код заказа
    const orderCode = 'D-' + Date.now().toString().slice(-8);
    
    // Создаем заказ доставки
    const { rows: orderRows } = await req.db.query(
      `INSERT INTO delivery_orders (
        order_code, user_id, total_amount, delivery_address, 
        customer_name, customer_phone, customer_notes, payment_method
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [orderCode, req.userId, total_amount, delivery_address, customer_name, customer_phone, customer_notes, payment_method]
    );

    const order = orderRows[0];

    // Получаем информацию о товаре
    const { rows: productRows } = await req.db.query(
      'SELECT * FROM products WHERE id = $1',
      [product_id]
    );

    if (productRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Товар не найден'
      });
    }

    const product = productRows[0];

    // Добавляем товар в заказ
    await req.db.query(
      `INSERT INTO delivery_order_items (
        delivery_order_id, product_id, product_name, quantity, unit_price, total_price
      ) VALUES ($1, $2, $3, $4, $5, $6)`,
      [order.id, product.id, product.name, quantity, product.price, total_amount]
    );

    console.log('✅ Заказ успешно создан:', order.id);

    res.json({
      success: true,
      message: 'Заказ успешно создан',
      order: order
    });

  } catch (err) {
    console.error('❌ Ошибка создания заказа:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка создания заказа: ' + err.message
    });
  }
});

// Get user orders
app.get('/api/orders', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/orders');
  
  const { user_id } = req.query;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    const { rows } = await req.db.query(
      `SELECT o.*, 
              json_agg(
                json_build_object(
                  'product_id', doi.product_id,
                  'product_name', doi.product_name,
                  'quantity', doi.quantity,
                  'unit_price', doi.unit_price,
                  'total_price', doi.total_price
                )
              ) as items
       FROM delivery_orders o
       LEFT JOIN delivery_order_items doi ON o.id = doi.delivery_order_id
       WHERE o.user_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [user_id]
    );
    
    res.json({
      success: true,
      orders: rows
    });
    
  } catch (err) {
    console.error('❌ Ошибка получения заказов:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения заказов: ' + err.message
    });
  }
});

// ==================== COURIER ROUTES ====================

// Courier - Register
app.post('/api/courier/register', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/courier/register');
  
  const { 
    user_id, 
    first_name, 
    last_name, 
    phone, 
    email, 
    vehicle_type = 'bicycle',
    vehicle_number = ''
  } = req.body;

  if (!user_id || !first_name || !last_name || !phone || !email) {
    return res.status(400).json({
      success: false,
      error: 'Все обязательные поля должны быть заполнены'
    });
  }

  try {
    // Проверяем существование пользователя
    const { rows: userRows } = await req.db.query(
      'SELECT * FROM users WHERE id = $1',
      [user_id]
    );

    if (userRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }

    // Проверяем, не зарегистрирован ли уже курьер
    const { rows: existingCourier } = await req.db.query(
      'SELECT * FROM couriers WHERE user_id = $1 OR email = $2',
      [user_id, email]
    );

    if (existingCourier.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Курьер уже зарегистрирован'
      });
    }

    // Генерируем уникальный код курьера
    const courierCode = 'C-' + Date.now().toString().slice(-6);

    // Создаем запись курьера
    const { rows } = await req.db.query(
      `INSERT INTO couriers (
        user_id, courier_code, first_name, last_name, phone, email,
        vehicle_type, vehicle_number, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [user_id, courierCode, first_name, last_name, phone, email,
       vehicle_type, vehicle_number, 'active']
    );

    const newCourier = rows[0];

    // Создаем чат с поддержкой для курьера
    await req.db.query(
      `INSERT INTO courier_chats (courier_id, participant_type, participant_name, last_message) 
       VALUES ($1, $2, $3, $4)`,
      [newCourier.id, 'support', 'Поддержка ФармаПлюс', 'Добро пожаловать в команду курьеров!']
    );

    // Создаем приветственное сообщение
    await req.db.query(
      `INSERT INTO courier_messages (courier_id, subject, message, message_type) 
       VALUES ($1, $2, $3, $4)`,
      [newCourier.id, 'Добро пожаловать!', 'Добро пожаловать в команду курьеров ФармаПлюс! Мы рады видеть вас в нашей команде.', 'info']
    );

    console.log('✅ Курьер успешно зарегистрирован:', newCourier.id);

    res.json({
      success: true,
      message: 'Регистрация курьера успешна',
      courier: newCourier
    });

  } catch (err) {
    console.error('❌ Ошибка регистрации курьера:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка регистрации курьера: ' + err.message
    });
  }
});

// Courier - Get profile by user_id
app.get('/api/courier/profile', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/courier/profile');
  
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id обязателен'
      });
    }

    const { rows } = await req.db.query(
      `SELECT c.*, u.username, u.avatar_url as avatar 
       FROM couriers c 
       LEFT JOIN users u ON c.user_id = u.id 
       WHERE c.user_id = $1`,
      [user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Курьер не найден'
      });
    }

    res.json({
      success: true,
      courier: rows[0]
    });
  } catch (err) {
    console.error('❌ Ошибка получения профиля курьера:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения профиля курьера: ' + err.message
    });
  }
});

// Courier - Update profile
app.put('/api/courier/profile', databaseMiddleware, async (req, res) => {
  console.log('📨 PUT /api/courier/profile');
  
  const { user_id, first_name, last_name, phone, vehicle_type, vehicle_number } = req.body;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    const { rows } = await req.db.query(
      `UPDATE couriers 
       SET first_name = $1, last_name = $2, phone = $3, vehicle_type = $4, vehicle_number = $5, updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $6 
       RETURNING *`,
      [first_name, last_name, phone, vehicle_type, vehicle_number, user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Курьер не найден'
      });
    }

    res.json({
      success: true,
      message: 'Профиль курьера обновлен',
      courier: rows[0]
    });
  } catch (err) {
    console.error('❌ Ошибка обновления профиля курьера:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка обновления профиля курьера: ' + err.message
    });
  }
});

// Courier - Update status
app.post('/api/courier/status', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/courier/status');
  
  const { user_id, status } = req.body;
  
  if (!user_id || !status) {
    return res.status(400).json({
      success: false,
      error: 'user_id и status обязательны'
    });
  }

  try {
    const { rows } = await req.db.query(
      `UPDATE couriers 
       SET status = $1, last_activity = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
       WHERE user_id = $2 
       RETURNING *`,
      [status, user_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Курьер не найден'
      });
    }

    res.json({
      success: true,
      message: 'Статус обновлен',
      courier: rows[0]
    });
  } catch (err) {
    console.error('❌ Ошибка обновления статуса курьера:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка обновления статуса курьера: ' + err.message
    });
  }
});

// Courier - Get orders
app.get('/api/courier/orders', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/courier/orders');
  
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id обязателен'
      });
    }

    // Получаем курьера по user_id
    const { rows: courierRows } = await req.db.query(
      'SELECT id FROM couriers WHERE user_id = $1',
      [user_id]
    );

    let orders = [];

    if (courierRows.length > 0) {
      const courierId = courierRows[0].id;

      // Получаем заказы с информацией о товарах
      const { rows: orderRows } = await req.db.query(`
        SELECT 
          o.id,
          o.order_code,
          o.total_amount,
          o.delivery_address as address,
          o.customer_name,
          o.customer_phone,
          o.customer_notes,
          o.status,
          o.created_at,
          o.assigned_at,
          o.delivered_at,
          c.first_name as courier_name,
          json_agg(
            json_build_object(
              'id', p.id,
              'name', doi.product_name,
              'quantity', doi.quantity,
              'price', doi.unit_price
            )
          ) as products
        FROM delivery_orders o
        LEFT JOIN delivery_order_items doi ON o.id = doi.delivery_order_id
        LEFT JOIN products p ON doi.product_id = p.id
        LEFT JOIN couriers c ON o.courier_id = c.id
        WHERE o.courier_id = $1 OR o.status = 'pending'
        GROUP BY o.id, c.first_name
        ORDER BY 
          CASE 
            WHEN o.status = 'pending' THEN 1
            WHEN o.status = 'assigned' THEN 2
            WHEN o.status = 'delivered' THEN 3
            ELSE 4
          END,
          o.created_at DESC
      `, [courierId]);

      orders = orderRows;
    } else {
      // Если курьер не найден, возвращаем пустой список
      orders = [];
    }

    console.log('✅ Найдено заказов:', orders.length);

    res.json({
      success: true,
      orders: orders.map(order => ({
        id: order.id,
        order_code: order.order_code,
        address: order.address,
        status: order.status,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        customer_notes: order.customer_notes,
        total_amount: order.total_amount,
        created_at: order.created_at,
        assigned_at: order.assigned_at,
        delivered_at: order.delivered_at,
        courier_name: order.courier_name,
        products: order.products || []
      }))
    });
  } catch (err) {
    console.error('❌ Ошибка получения заказов:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения заказов: ' + err.message
    });
  }
});

// Courier - Accept order
app.post('/api/courier/orders/accept', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/courier/orders/accept');
  
  const { order_id, user_id } = req.body;
  
  if (!order_id || !user_id) {
    return res.status(400).json({
      success: false,
      error: 'order_id и user_id обязательны'
    });
  }

  try {
    // Получаем courier_id по user_id
    const { rows: courierRows } = await req.db.query(
      'SELECT id, first_name FROM couriers WHERE user_id = $1',
      [user_id]
    );

    if (courierRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Курьер не найден'
      });
    }

    const courierId = courierRows[0].id;
    const courierName = courierRows[0].first_name;

    const { rows } = await req.db.query(
      'UPDATE delivery_orders SET status = $1, courier_id = $2, assigned_at = CURRENT_TIMESTAMP WHERE id = $3 AND status = $4 RETURNING *',
      ['assigned', courierId, order_id, 'pending']
    );

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Заказ не найден или уже принят'
      });
    }

    // Обновляем статистику курьера
    await req.db.query(
      'UPDATE couriers SET total_orders = total_orders + 1, current_daily_orders = current_daily_orders + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [courierId]
    );

    res.json({
      success: true,
      message: 'Заказ принят',
      order: rows[0],
      courier_name: courierName
    });
  } catch (err) {
    console.error('❌ Ошибка принятия заказа:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка принятия заказа: ' + err.message
    });
  }
});

// Courier - Complete order
app.post('/api/courier/orders/complete', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/courier/orders/complete');
  
  const { order_id, user_id } = req.body;
  
  if (!order_id || !user_id) {
    return res.status(400).json({
      success: false,
      error: 'order_id и user_id обязательны'
    });
  }

  try {
    // Получаем courier_id по user_id
    const { rows: courierRows } = await req.db.query(
      'SELECT id FROM couriers WHERE user_id = $1',
      [user_id]
    );

    if (courierRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Курьер не найден'
      });
    }

    const courierId = courierRows[0].id;

    const { rows } = await req.db.query(
      'UPDATE delivery_orders SET status = $1, delivered_at = CURRENT_TIMESTAMP WHERE id = $2 AND status = $3 AND courier_id = $4 RETURNING *',
      ['delivered', order_id, 'assigned', courierId]
    );

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Заказ не найден или не был принят'
      });
    }

    // Обновляем статистику курьера
    await req.db.query(
      'UPDATE couriers SET completed_orders = completed_orders + 1, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
      [courierId]
    );

    // Рассчитываем и обновляем заработок (простая логика - 10% от суммы заказа)
    const orderAmount = parseFloat(rows[0].total_amount) || 0;
    const earnings = orderAmount * 0.1;

    await req.db.query(
      'UPDATE couriers SET total_earnings = total_earnings + $1, today_earnings = today_earnings + $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3',
      [earnings, earnings, courierId]
    );

    res.json({
      success: true,
      message: 'Заказ доставлен',
      order: rows[0],
      earnings: earnings
    });
  } catch (err) {
    console.error('❌ Ошибка завершения заказа:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка завершения заказа: ' + err.message
    });
  }
});

// Courier - Cancel order
app.post('/api/courier/orders/cancel', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/courier/orders/cancel');
  
  const { order_id, user_id, reason } = req.body;
  
  if (!order_id || !user_id) {
    return res.status(400).json({
      success: false,
      error: 'order_id и user_id обязательны'
    });
  }

  try {
    // Получаем courier_id по user_id
    const { rows: courierRows } = await req.db.query(
      'SELECT id FROM couriers WHERE user_id = $1',
      [user_id]
    );

    if (courierRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Курьер не найден'
      });
    }

    const courierId = courierRows[0].id;

    const { rows } = await req.db.query(
      'UPDATE delivery_orders SET status = $1, cancelled_at = CURRENT_TIMESTAMP WHERE id = $2 AND status = $3 AND courier_id = $4 RETURNING *',
      ['cancelled', order_id, 'assigned', courierId]
    );

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Заказ не найден или не был принят'
      });
    }

    res.json({
      success: true,
      message: 'Заказ отменен',
      order: rows[0]
    });
  } catch (err) {
    console.error('❌ Ошибка отмены заказа:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка отмены заказа: ' + err.message
    });
  }
});

// Courier - Get order details
app.get('/api/courier/orders/:orderId', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/courier/orders/' + req.params.orderId);
  
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id обязателен'
      });
    }

    const { rows } = await req.db.query(`
      SELECT 
        o.*,
        c.first_name as courier_name,
        json_agg(
          json_build_object(
            'id', p.id,
            'name', doi.product_name,
            'quantity', doi.quantity,
            'price', doi.unit_price,
            'total_price', doi.total_price
          )
        ) as products
      FROM delivery_orders o
      LEFT JOIN delivery_order_items doi ON o.id = doi.delivery_order_id
      LEFT JOIN products p ON doi.product_id = p.id
      LEFT JOIN couriers c ON o.courier_id = c.id
      WHERE o.id = $1
      GROUP BY o.id, c.first_name
    `, [req.params.orderId]);

    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Заказ не найден'
      });
    }

    res.json({
      success: true,
      order: rows[0]
    });
  } catch (err) {
    console.error('❌ Ошибка получения деталей заказа:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения деталей заказа: ' + err.message
    });
  }
});

// Courier - Get messages
app.get('/api/courier/messages', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/courier/messages');
  
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id обязателен'
      });
    }

    // Получаем курьера по user_id
    const { rows: courierRows } = await req.db.query(
      'SELECT id FROM couriers WHERE user_id = $1',
      [user_id]
    );

    if (courierRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Курьер не найден'
      });
    }

    const courierId = courierRows[0].id;

    const { rows } = await req.db.query(
      `SELECT * FROM courier_messages 
       WHERE courier_id = $1 
       ORDER BY created_at DESC 
       LIMIT 50`,
      [courierId]
    );

    res.json({
      success: true,
      messages: rows
    });
  } catch (err) {
    console.error('❌ Ошибка получения сообщений:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения сообщений: ' + err.message
    });
  }
});

// Courier - Mark message as read
app.post('/api/courier/messages/:messageId/read', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/courier/messages/' + req.params.messageId + '/read');
  
  try {
    const { user_id } = req.body;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id обязателен'
      });
    }

    // Получаем курьера по user_id
    const { rows: courierRows } = await req.db.query(
      'SELECT id FROM couriers WHERE user_id = $1',
      [user_id]
    );

    if (courierRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Курьер не найден'
      });
    }

    const courierId = courierRows[0].id;

    await req.db.query(
      'UPDATE courier_messages SET is_read = true WHERE id = $1 AND courier_id = $2',
      [req.params.messageId, courierId]
    );

    res.json({
      success: true,
      message: 'Сообщение помечено как прочитанное'
    });
  } catch (err) {
    console.error('❌ Ошибка отметки сообщения:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка отметки сообщения: ' + err.message
    });
  }
});

// Courier - Get chats
app.get('/api/courier/chats', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/courier/chats');
  
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id обязателен'
      });
    }

    // Получаем курьера по user_id
    const { rows: courierRows } = await req.db.query(
      'SELECT id FROM couriers WHERE user_id = $1',
      [user_id]
    );

    if (courierRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Курьер не найден'
      });
    }

    const courierId = courierRows[0].id;

    const { rows } = await req.db.query(
      `SELECT * FROM courier_chats 
       WHERE courier_id = $1 AND is_active = true 
       ORDER BY last_message_at DESC`,
      [courierId]
    );

    res.json({
      success: true,
      chats: rows
    });
  } catch (err) {
    console.error('❌ Ошибка получения чатов:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения чатов: ' + err.message
    });
  }
});

// Courier - Get chat messages
app.get('/api/courier/chats/:chatId/messages', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/courier/chats/' + req.params.chatId + '/messages');
  
  try {
    const { rows } = await req.db.query(
      `SELECT * FROM courier_chat_messages 
       WHERE chat_id = $1 
       ORDER BY created_at ASC 
       LIMIT 100`,
      [req.params.chatId]
    );

    res.json({
      success: true,
      messages: rows
    });
  } catch (err) {
    console.error('❌ Ошибка получения сообщений чата:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения сообщений чата: ' + err.message
    });
  }
});

// Courier - Send message
app.post('/api/courier/chats/:chatId/messages', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/courier/chats/' + req.params.chatId + '/messages');
  
  const { message, user_id } = req.body;
  
  if (!message) {
    return res.status(400).json({
      success: false,
      error: 'Сообщение обязательно'
    });
  }

  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    // Получаем данные курьера
    const { rows: courierRows } = await req.db.query(
      'SELECT id, first_name FROM couriers WHERE user_id = $1',
      [user_id]
    );

    if (courierRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Курьер не найден'
      });
    }

    const courierId = courierRows[0].id;
    const courierName = courierRows[0].first_name;

    // Добавляем сообщение
    const { rows } = await req.db.query(
      `INSERT INTO courier_chat_messages (chat_id, sender_type, sender_name, message) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.chatId, 'courier', courierName, message]
    );

    // Обновляем последнее сообщение в чате
    await req.db.query(
      `UPDATE courier_chats 
       SET last_message = $1, last_message_at = CURRENT_TIMESTAMP, unread_count = unread_count + 1 
       WHERE id = $2`,
      [message, req.params.chatId]
    );

    res.json({
      success: true,
      message: rows[0]
    });
  } catch (err) {
    console.error('❌ Ошибка отправки сообщения:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка отправки сообщения: ' + err.message
    });
  }
});

// Courier - Mark chat as read
app.post('/api/courier/chats/:chatId/read', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/courier/chats/' + req.params.chatId + '/read');
  
  try {
    await req.db.query(
      'UPDATE courier_chats SET unread_count = 0 WHERE id = $1',
      [req.params.chatId]
    );

    res.json({
      success: true,
      message: 'Чат помечен как прочитанный'
    });
  } catch (err) {
    console.error('❌ Ошибка отметки чата:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка отметки чата: ' + err.message
    });
  }
});

// Courier - Get work schedule
app.get('/api/courier/schedule', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/courier/schedule');
  
  try {
    const { user_id } = req.query;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id обязателен'
      });
    }

    // Получаем курьера по user_id
    const { rows: courierRows } = await req.db.query(
      'SELECT id FROM couriers WHERE user_id = $1',
      [user_id]
    );

    if (courierRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Курьер не найден'
      });
    }

    const courierId = courierRows[0].id;

    const { rows } = await req.db.query(
      `SELECT * FROM courier_work_schedule 
       WHERE courier_id = $1 AND is_active = true 
       ORDER BY day_of_week, start_time`,
      [courierId]
    );

    res.json({
      success: true,
      schedule: rows
    });
  } catch (err) {
    console.error('❌ Ошибка получения расписания:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения расписания: ' + err.message
    });
  }
});

// Courier - Update work schedule
app.post('/api/courier/schedule', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/courier/schedule');
  
  const { user_id, schedule } = req.body;
  
  if (!user_id || !schedule) {
    return res.status(400).json({
      success: false,
      error: 'user_id и schedule обязательны'
    });
  }

  try {
    // Получаем курьера по user_id
    const { rows: courierRows } = await req.db.query(
      'SELECT id FROM couriers WHERE user_id = $1',
      [user_id]
    );

    if (courierRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Курьер не найден'
      });
    }

    const courierId = courierRows[0].id;

    // Удаляем старое расписание
    await req.db.query(
      'DELETE FROM courier_work_schedule WHERE courier_id = $1',
      [courierId]
    );

    // Добавляем новое расписание
    for (const daySchedule of schedule) {
      await req.db.query(
        `INSERT INTO courier_work_schedule (courier_id, day_of_week, start_time, end_time, is_active) 
         VALUES ($1, $2, $3, $4, $5)`,
        [courierId, daySchedule.day_of_week, daySchedule.start_time, daySchedule.end_time, daySchedule.is_active || true]
      );
    }

    res.json({
      success: true,
      message: 'Расписание обновлено'
    });
  } catch (err) {
    console.error('❌ Ошибка обновления расписания:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка обновления расписания: ' + err.message
    });
  }
});

// Courier - Get earnings
app.get('/api/courier/earnings', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/courier/earnings');
  
  try {
    const { user_id, period = 'today' } = req.query;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id обязателен'
      });
    }

    // Получаем курьера по user_id
    const { rows: courierRows } = await req.db.query(
      'SELECT id, total_earnings, today_earnings FROM couriers WHERE user_id = $1',
      [user_id]
    );

    if (courierRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Курьер не найден'
      });
    }

    const courier = courierRows[0];
    let earningsData = [];

    if (period === 'today') {
      const { rows } = await req.db.query(`
        SELECT 
          o.id,
          o.order_code,
          o.total_amount,
          (o.total_amount * 0.1) as courier_earnings,
          o.delivered_at
        FROM delivery_orders o
        WHERE o.courier_id = $1 
          AND o.status = 'delivered'
          AND DATE(o.delivered_at) = CURRENT_DATE
        ORDER BY o.delivered_at DESC
      `, [courier.id]);

      earningsData = rows;
    } else if (period === 'week') {
      const { rows } = await req.db.query(`
        SELECT 
          o.id,
          o.order_code,
          o.total_amount,
          (o.total_amount * 0.1) as courier_earnings,
          o.delivered_at
        FROM delivery_orders o
        WHERE o.courier_id = $1 
          AND o.status = 'delivered'
          AND o.delivered_at >= CURRENT_DATE - INTERVAL '7 days'
        ORDER BY o.delivered_at DESC
      `, [courier.id]);

      earningsData = rows;
    } else if (period === 'month') {
      const { rows } = await req.db.query(`
        SELECT 
          o.id,
          o.order_code,
          o.total_amount,
          (o.total_amount * 0.1) as courier_earnings,
          o.delivered_at
        FROM delivery_orders o
        WHERE o.courier_id = $1 
          AND o.status = 'delivered'
          AND o.delivered_at >= CURRENT_DATE - INTERVAL '30 days'
        ORDER BY o.delivered_at DESC
      `, [courier.id]);

      earningsData = rows;
    }

    const totalEarnings = earningsData.reduce((sum, item) => sum + parseFloat(item.courier_earnings), 0);

    res.json({
      success: true,
      earnings: {
        total_earnings: parseFloat(courier.total_earnings) || 0,
        today_earnings: parseFloat(courier.today_earnings) || 0,
        period_earnings: totalEarnings,
        orders: earningsData
      }
    });
  } catch (err) {
    console.error('❌ Ошибка получения заработка:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения заработка: ' + err.message
    });
  }
});

// ==================== TELEGRAM BOT ROUTES ====================

// Telegram - Send message to admin
app.post('/api/telegram/send-message', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/telegram/send-message');
  
  const { message, user_id } = req.body;
  
  if (!message) {
    return res.status(400).json({
      success: false,
      error: 'Сообщение обязательно'
    });
  }

  try {
    // Получаем данные пользователя
    let userInfo = 'Пользователь не авторизован';
    let courierInfo = 'Курьер не зарегистрирован';

    if (user_id) {
      const { rows: userRows } = await req.db.query(
        'SELECT first_name, last_name, email FROM users WHERE id = $1',
        [user_id]
      );

      if (userRows.length > 0) {
        const user = userRows[0];
        userInfo = `👤 Пользователь: ${user.first_name || ''} ${user.last_name || ''} (${user.email || 'нет email'})`;
      }

      // Получаем данные курьера
      const { rows: courierRows } = await req.db.query(
        'SELECT first_name, last_name, courier_code FROM couriers WHERE user_id = $1',
        [user_id]
      );

      if (courierRows.length > 0) {
        const courier = courierRows[0];
        courierInfo = `🚴 Курьер: ${courier.first_name} ${courier.last_name} (${courier.courier_code})`;
      }
    }

    const fullMessage = `📱 *Новое сообщение из приложения ФармаПлюс*\n\n${userInfo}\n${courierInfo}\n\n💬 *Сообщение:* ${message}\n\n⏰ ${new Date().toLocaleString('ru-RU')}`;

    // Отправляем в Telegram
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      console.log('⚠️ Telegram credentials not set, using demo mode');
      // В демо-режиме просто логируем сообщение
      console.log('📧 Telegram message (demo):', fullMessage);
      
      return res.json({
        success: true,
        message: 'Сообщение отправлено (демо-режим)',
        demo: true
      });
    }

    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: fullMessage,
        parse_mode: 'Markdown'
      })
    });

    const telegramData = await telegramResponse.json();

    if (!telegramResponse.ok) {
      console.error('❌ Telegram API error:', telegramData);
      throw new Error(`Telegram error: ${telegramData.description || 'Unknown error'}`);
    }

    console.log('✅ Сообщение отправлено в Telegram');

    res.json({
      success: true,
      message: 'Сообщение отправлено администратору',
      telegram: telegramData
    });

  } catch (err) {
    console.error('❌ Ошибка отправки сообщения в Telegram:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка отправки сообщения: ' + err.message
    });
  }
});

// Telegram - Test connection
app.get('/api/telegram/test', async (req, res) => {
  console.log('📨 GET /api/telegram/test');
  
  try {
    const botToken = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_CHAT_ID;

    if (!botToken || !chatId) {
      return res.json({
        success: false,
        error: 'Telegram credentials not configured',
        botToken: !!botToken,
        chatId: !!chatId
      });
    }

    // Тестируем соединение с Telegram API
    const testMessage = `🧪 *Тестовое сообщение от ФармаПлюс*\n\n✅ Сервер работает корректно\n⏰ ${new Date().toLocaleString('ru-RU')}`;

    const telegramResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: testMessage,
        parse_mode: 'Markdown'
      })
    });

    const telegramData = await telegramResponse.json();

    if (telegramResponse.ok) {
      res.json({
        success: true,
        message: 'Telegram connection successful',
        botInfo: {
          id: telegramData.result.from.id,
          name: telegramData.result.from.first_name,
          username: telegramData.result.from.username
        }
      });
    } else {
      res.json({
        success: false,
        error: `Telegram API error: ${telegramData.description}`,
        details: telegramData
      });
    }

  } catch (err) {
    console.error('❌ Telegram test error:', err);
    res.status(500).json({
      success: false,
      error: 'Telegram test failed: ' + err.message
    });
  }
});

// ==================== ADMIN ROUTES ====================

// Admin - Add product
app.post('/api/admin/products', databaseMiddleware, validateUser, async (req, res) => {
  console.log('📨 POST /api/admin/products');
  
  const {
    name,
    category_id,
    description,
    price,
    old_price,
    manufacturer,
    country,
    stock_quantity,
    in_stock,
    is_popular,
    is_new,
    composition,
    indications,
    usage,
    contraindications,
    dosage,
    expiry_date,
    storage_conditions
  } = req.body;

  if (!name || !category_id || !price || stock_quantity === undefined) {
    return res.status(400).json({
      success: false,
      error: 'Обязательные поля: название, категория, цена, количество'
    });
  }

  try {
    // Проверяем права администратора
    const { rows: userRows } = await req.db.query(
      'SELECT is_admin FROM users WHERE id = $1',
      [req.userId]
    );

    if (userRows.length === 0 || !userRows[0].is_admin) {
      return res.status(403).json({
        success: false,
        error: 'Недостаточно прав'
      });
    }

    const { rows: categoryRows } = await req.db.query(
      'SELECT * FROM categories WHERE id = $1',
      [category_id]
    );

    if (categoryRows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Указанная категория не существует'
      });
    }

    // Для демо - случайное изображение (в реальном проекте нужно загружать файлы)
    const demoImages = [
      'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop',
      'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop',
      'https://images.unsplash.com/photo-1576671414121-d0b01c6c5f60?w=300&h=200&fit=crop',
      'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=300&h=200&fit=crop'
    ];
    const randomImage = demoImages[Math.floor(Math.random() * demoImages.length)];

    const { rows } = await req.db.query(
      `INSERT INTO products (
        name, category_id, description, price, old_price, manufacturer, country,
        stock_quantity, in_stock, is_popular, is_new, composition, indications,
        usage, contraindications, dosage, expiry_date, storage_conditions, image
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING *`,
      [
        name,
        category_id,
        description || '',
        parseFloat(price),
        old_price ? parseFloat(old_price) : null,
        manufacturer || '',
        country || '',
        parseInt(stock_quantity),
        Boolean(in_stock),
        Boolean(is_popular),
        Boolean(is_new),
        composition || '',
        indications || '',
        usage || '',
        contraindications || '',
        dosage || '',
        expiry_date || '',
        storage_conditions || '',
        randomImage
      ]
    );

    const newProduct = rows[0];
    
    console.log('✅ Товар успешно добавлен:', newProduct.id);

    res.json({
      success: true,
      message: 'Товар успешно добавлен',
      product: newProduct
    });

  } catch (err) {
    console.error('❌ Ошибка добавления товара:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка добавления товара: ' + err.message
    });
  }
});

// ==================== HEALTH CHECK & CONFIG ====================

// Health check
app.get('/health', databaseMiddleware, async (req, res) => {
  try {
    const productsCount = await db.query('SELECT COUNT(*) as count FROM products');
    const categoriesCount = await db.query('SELECT COUNT(*) as count FROM categories');
    const usersCount = await db.query('SELECT COUNT(*) as count FROM users');
    const cartCount = await db.query('SELECT COUNT(*) as count FROM cart_items');
    const couriersCount = await db.query('SELECT COUNT(*) as count FROM couriers');
    const ordersCount = await db.query('SELECT COUNT(*) as count FROM delivery_orders');
    
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      database: 'Neon.tech PostgreSQL',
      tables: {
        products: parseInt(productsCount.rows[0]?.count) || 0,
        categories: parseInt(categoriesCount.rows[0]?.count) || 0,
        users: parseInt(usersCount.rows[0]?.count) || 0,
        cart_items: parseInt(cartCount.rows[0]?.count) || 0,
        couriers: parseInt(couriersCount.rows[0]?.count) || 0,
        delivery_orders: parseInt(ordersCount.rows[0]?.count) || 0
      }
    });
  } catch (err) {
    res.status(500).json({ 
      status: 'ERROR', 
      timestamp: new Date().toISOString(),
      error: err.message,
      database: 'Neon.tech PostgreSQL'
    });
  }
});

// Main config endpoint
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    googleClientId: process.env.GOOGLE_CLIENT_ID || 'demo',
    googleAuthEnabled: !!process.env.GOOGLE_CLIENT_ID,
    addressFeatures: {
      saveAddresses: true,
      multipleAddresses: true,
      mapIntegration: true
    }
  });
});

// ==================== STATIC ROUTES ====================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'main.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

app.get('/map', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'map.html'));
});

app.get('/cart', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'cart.html'));
});

app.get('/product', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'product.html'));
});

app.get('/categories', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'categories.html'));
});

app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

app.get('/courier', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'courier.html'));
});

app.get('/courier-profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'courier-profile.html'));
});

app.get('/courier-register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'courier-register.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Handle 404
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found'
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('❌ Server error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// Initialize database on startup
async function startServer() {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
      console.log(`📍 http://localhost:${PORT}`);
      console.log(`🗄️ База данных: Neon.tech PostgreSQL`);
      console.log(`🔐 Google OAuth: ${process.env.GOOGLE_CLIENT_ID ? 'Настроен' : 'Не настроен'}`);
      console.log(`\n📋 Доступные endpoints для курьеров:`);
      console.log(`   POST /api/courier/register - Регистрация курьера`);
      console.log(`   GET  /api/courier/profile - Профиль курьера`);
      console.log(`   PUT  /api/courier/profile - Обновление профиля`);
      console.log(`   POST /api/courier/status - Обновление статуса`);
      console.log(`   GET  /api/courier/orders - Заказы курьера`);
      console.log(`   POST /api/courier/orders/accept - Принять заказ`);
      console.log(`   POST /api/courier/orders/complete - Завершить заказ`);
      console.log(`   POST /api/courier/orders/cancel - Отменить заказ`);
      console.log(`   GET  /api/courier/messages - Сообщения курьера`);
      console.log(`   GET  /api/courier/chats - Чаты курьера`);
      console.log(`   POST /api/courier/chats/:id/messages - Отправить сообщение`);
      console.log(`   GET  /api/courier/earnings - Заработок курьера`);
      console.log(`   GET  /api/courier/schedule - Расписание работы`);
      console.log(`\n📋 Стандартные endpoints:`);
      console.log(`   GET  /api/categories - Категории`);
      console.log(`   GET  /api/products - Товары`);
      console.log(`   POST /api/auth/google - Вход/регистрация через Google`);
      console.log(`   POST /api/auth/google/complete - Завершение регистрации Google`);
      console.log(`   POST /api/auth/register - Регистрация по email`);
      console.log(`   POST /api/auth/login - Вход по email`);
      console.log(`   POST /api/orders/create - Создание заказа`);
      console.log(`   POST /api/addresses/save - Сохранение адреса с карты`);
      console.log(`   GET  /health - Проверка работы`);
    });
  } catch (err) {
    console.error('❌ Не удалось подключиться к базе данных:', err);
    console.log(`\n⚠️  Сервер запущен без подключения к БД на порту ${PORT}`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`❌ API endpoints будут возвращать ошибки`);
    
    app.listen(PORT, () => {
      console.log(`📍 Server running on port ${PORT} (without database)`);
    });
  }
}

// For Vercel
module.exports = app;

// For local development
if (require.main === module) {
  startServer();
}
