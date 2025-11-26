const express = require('express');
const { Client } = require('pg');
const path = require('path');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Google OAuth client
const googleClient = new OAuth2Client(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET
);

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
    
    // Create tables and seed data
    await createTables();
    await createCourierTables();
    await seedInitialData();
    
    return db;
  } catch (err) {
    console.error('❌ Ошибка подключения к Neon.tech:', err);
    isDatabaseConnected = false;
    db = null;
    throw err;
  }
}

// Create tables
async function createTables() {
  try {
    // Categories table
    await db.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        image VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Products table
    await db.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        old_price DECIMAL(10,2),
        image VARCHAR(500),
        category_id INTEGER REFERENCES categories(id),
        manufacturer VARCHAR(100),
        country VARCHAR(50),
        stock_quantity INTEGER DEFAULT 0,
        in_stock BOOLEAN DEFAULT true,
        is_popular BOOLEAN DEFAULT false,
        is_new BOOLEAN DEFAULT true,
        composition TEXT,
        indications TEXT,
        usage TEXT,
        contraindications TEXT,
        dosage VARCHAR(100),
        expiry_date VARCHAR(50),
        storage_conditions VARCHAR(200),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Users table
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        first_name VARCHAR(50),
        last_name VARCHAR(50),
        middle_name VARCHAR(50),
        username VARCHAR(50) UNIQUE NOT NULL,
        email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        avatar VARCHAR(500),
        google_id VARCHAR(100) UNIQUE,
        email_verified BOOLEAN DEFAULT false,
        is_admin BOOLEAN DEFAULT false,
        login_count INTEGER DEFAULT 0,
        last_login TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Cart items table
    await db.query(`
      CREATE TABLE IF NOT EXISTS cart_items (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id),
        product_id INTEGER REFERENCES products(id),
        quantity INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, product_id)
      )
    `);

    console.log('✅ Таблицы созданы/проверены');
  } catch (err) {
    console.error('❌ Ошибка создания таблиц:', err);
    throw err;
  }
}

// Create courier tables
async function createCourierTables() {
  try {
    // Couriers table
    await db.query(`
      CREATE TABLE IF NOT EXISTS couriers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        courier_code VARCHAR(20) UNIQUE NOT NULL,
        first_name VARCHAR(50) NOT NULL,
        last_name VARCHAR(50) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        email VARCHAR(100),
        vehicle_type VARCHAR(50) DEFAULT 'bicycle',
        vehicle_number VARCHAR(20),
        status VARCHAR(20) DEFAULT 'active',
        rating DECIMAL(3,2) DEFAULT 5.0,
        total_orders INTEGER DEFAULT 0,
        completed_orders INTEGER DEFAULT 0,
        daily_goal INTEGER DEFAULT 10,
        current_daily_orders INTEGER DEFAULT 0,
        total_earnings DECIMAL(10,2) DEFAULT 0,
        today_earnings DECIMAL(10,2) DEFAULT 0,
        last_activity TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Delivery orders table
    await db.query(`
      CREATE TABLE IF NOT EXISTS delivery_orders (
        id SERIAL PRIMARY KEY,
        order_code VARCHAR(20) UNIQUE NOT NULL,
        user_id INTEGER REFERENCES users(id),
        total_amount DECIMAL(10,2) NOT NULL,
        delivery_address TEXT NOT NULL,
        customer_name VARCHAR(100) NOT NULL,
        customer_phone VARCHAR(20) NOT NULL,
        customer_notes TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        courier_id INTEGER REFERENCES couriers(id),
        assigned_at TIMESTAMP,
        picked_up_at TIMESTAMP,
        delivered_at TIMESTAMP,
        estimated_delivery_time INTEGER,
        actual_delivery_time INTEGER,
        delivery_fee DECIMAL(8,2) DEFAULT 0,
        payment_method VARCHAR(20) DEFAULT 'card',
        is_paid BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Delivery order items table
    await db.query(`
      CREATE TABLE IF NOT EXISTS delivery_order_items (
        id SERIAL PRIMARY KEY,
        delivery_order_id INTEGER REFERENCES delivery_orders(id) ON DELETE CASCADE,
        product_id INTEGER REFERENCES products(id),
        product_name VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price DECIMAL(10,2) NOT NULL,
        total_price DECIMAL(10,2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Courier messages table
    await db.query(`
      CREATE TABLE IF NOT EXISTS courier_messages (
        id SERIAL PRIMARY KEY,
        courier_id INTEGER REFERENCES couriers(id) ON DELETE CASCADE,
        sender_type VARCHAR(20) DEFAULT 'support',
        sender_name VARCHAR(100) NOT NULL,
        subject VARCHAR(200),
        message TEXT NOT NULL,
        is_read BOOLEAN DEFAULT false,
        message_type VARCHAR(20) DEFAULT 'info',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read_at TIMESTAMP
      )
    `);

    // Courier chats table
    await db.query(`
      CREATE TABLE IF NOT EXISTS courier_chats (
        id SERIAL PRIMARY KEY,
        courier_id INTEGER REFERENCES couriers(id) ON DELETE CASCADE,
        participant_type VARCHAR(20) DEFAULT 'support',
        participant_name VARCHAR(100) NOT NULL,
        last_message TEXT,
        last_message_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        unread_count INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('✅ Таблицы курьеров созданы/проверены');
  } catch (err) {
    console.error('❌ Ошибка создания таблиц курьеров:', err);
    throw err;
  }
}

// Seed initial data
async function seedInitialData() {
  try {
    // Check if categories already exist
    const { rows: existingCategories } = await db.query('SELECT COUNT(*) as count FROM categories');
    if (parseInt(existingCategories[0].count) === 0) {
      console.log('🌱 Заполнение начальными данными...');
      
      // Add categories
      const categories = [
        { name: 'Лекарства', description: 'Медицинские препараты', image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop' },
        { name: 'Витамины', description: 'Витамины и БАДы', image: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop' },
        { name: 'Красота', description: 'Средства по уходу', image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=300&h=200&fit=crop' },
        { name: 'Гигиена', description: 'Средства личной гигиены', image: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=300&h=200&fit=crop' },
        { name: 'Мама и ребенок', description: 'Товары для матери и ребенка', image: 'https://images.unsplash.com/photo-1516627145497-ae69578b5d77?w=300&h=200&fit=crop' },
        { name: 'Медтехника', description: 'Медицинская техника', image: 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=300&h=200&fit=crop' },
        { name: 'Антисептики', description: 'Дезинфицирующие средства', image: 'https://images.unsplash.com/photo-1584634731339-252c581abfc5?w=300&h=200&fit=crop' }
      ];

      for (const category of categories) {
        await db.query(
          'INSERT INTO categories (name, description, image) VALUES ($1, $2, $3)',
          [category.name, category.description, category.image]
        );
      }

      // Add sample products
      const products = [
        {
          name: 'Нурофен таблетки 200мг №20',
          description: 'Обезболивающее и жаропонижающее средство',
          price: 250.50,
          old_price: 280.00,
          category_id: 1,
          manufacturer: 'Рекитт Бенкизер',
          country: 'Великобритания',
          stock_quantity: 50,
          is_popular: true,
          is_new: true,
          image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop'
        },
        {
          name: 'Витамин D3 2000 МЕ №60',
          description: 'Витамин D для поддержки иммунитета',
          price: 890.00,
          category_id: 2,
          manufacturer: 'Солгар',
          country: 'США',
          stock_quantity: 30,
          is_popular: true,
          image: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop'
        },
        {
          name: 'Панадол 500мг №12',
          description: 'Обезболивающее средство',
          price: 180.00,
          category_id: 1,
          manufacturer: 'ГлаксоСмитКляйн',
          country: 'Великобритания',
          stock_quantity: 25,
          image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop'
        },
        {
          name: 'Аспирин 500мг №20',
          description: 'Противовоспалительное средство',
          price: 120.00,
          old_price: 150.00,
          category_id: 1,
          manufacturer: 'Байер',
          country: 'Германия',
          stock_quantity: 40,
          is_popular: true,
          image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop'
        },
        {
          name: 'Витамин C 1000мг №60',
          description: 'Витамин C для иммунитета',
          price: 450.00,
          category_id: 2,
          manufacturer: 'Солгар',
          country: 'США',
          stock_quantity: 35,
          is_new: true,
          image: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop'
        },
        {
          name: 'Ибупрофен 400мг №24',
          description: 'Противовоспалительное и обезболивающее',
          price: 190.00,
          category_id: 1,
          manufacturer: 'Берлин-Хеми',
          country: 'Германия',
          stock_quantity: 60,
          is_popular: true,
          image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop'
        }
      ];

      for (const product of products) {
        await db.query(
          `INSERT INTO products (name, description, price, old_price, category_id, manufacturer, country, stock_quantity, is_popular, is_new, image) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            product.name, product.description, product.price, product.old_price,
            product.category_id, product.manufacturer, product.country,
            product.stock_quantity, product.is_popular, product.is_new, product.image
          ]
        );
      }

      console.log('✅ Начальные данные добавлены');
    }

    // Seed courier data
    const { rows: existingCouriers } = await db.query('SELECT COUNT(*) as count FROM couriers');
    if (parseInt(existingCouriers[0].count) === 0) {
      console.log('🌱 Добавление тестового курьера...');
      
      await db.query(`
        INSERT INTO couriers (user_id, courier_code, first_name, last_name, phone, email, vehicle_type, status, rating, total_orders, completed_orders, daily_goal) 
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      `, [1, 'C-7842', 'Иван', 'Курьеров', '+7 (999) 123-45-67', 'courier@pharmaplus.ru', 'bicycle', 'active', 4.8, 47, 45, 10]);

      // Add test messages
      await db.query(`
        INSERT INTO courier_messages (courier_id, sender_name, subject, message, message_type) 
        VALUES 
        (1, 'Поддержка', 'Добро пожаловать!', 'Добро пожаловать в команду ФармаПлюс! Мы рады видеть вас в нашей команде.', 'info'),
        (1, 'Администратор', 'Обновление правил', 'Обратите внимание на обновленные правила доставки в приложении.', 'warning'),
        (1, 'Система', 'Новый заказ', 'Вам назначен новый заказ #D-7842', 'urgent')
      `);

      // Add test chat
      await db.query(`
        INSERT INTO courier_chats (courier_id, participant_name, last_message, unread_count) 
        VALUES (1, 'Поддержка', 'Чем могу помочь?', 0)
      `);

      // Add chat messages
      await db.query(`
        INSERT INTO courier_chat_messages (chat_id, sender_type, sender_name, message) 
        VALUES 
        (1, 'support', 'Поддержка', 'Здравствуйте! Чем могу помочь?'),
        (1, 'courier', 'Иван Курьеров', 'Добрый день! У меня вопрос по поводу нового заказа.')
      `);

      console.log('✅ Тестовый курьер добавлен');
    }
  } catch (err) {
    console.error('❌ Ошибка заполнения начальных данных:', err);
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

// Simple password hash function
function simpleHash(password) {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString();
}

function comparePassword(password, hashedPassword) {
  return simpleHash(password) === hashedPassword;
}

// ==================== API ROUTES ====================

// Health check
app.get('/health', async (req, res) => {
  try {
    if (!isDatabaseConnected) {
      return res.status(503).json({
        status: 'ERROR',
        timestamp: new Date().toISOString(),
        error: 'База данных не подключена',
        database: 'Neon.tech PostgreSQL'
      });
    }

    const productsCount = await db.query('SELECT COUNT(*) as count FROM products');
    const categoriesCount = await db.query('SELECT COUNT(*) as count FROM categories');
    const usersCount = await db.query('SELECT COUNT(*) as count FROM users');
    const cartCount = await db.query('SELECT COUNT(*) as count FROM cart_items');
    
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      database: 'Neon.tech PostgreSQL',
      tables: {
        products: parseInt(productsCount.rows[0]?.count) || 0,
        categories: parseInt(categoriesCount.rows[0]?.count) || 0,
        users: parseInt(usersCount.rows[0]?.count) || 0,
        cart_items: parseInt(cartCount.rows[0]?.count) || 0
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

// Config
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    googleClientId: process.env.GOOGLE_CLIENT_ID || 'demo'
  });
});

// Categories
app.get('/api/categories', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/categories');
  try {
    const { rows } = await req.db.query('SELECT * FROM categories ORDER BY name');
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Ошибка получения категорий:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
});

// Products
app.get('/api/products', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/products');
  const { category, search, popular, new: newProducts, category_id, limit = 50, page = 1 } = req.query;
  
  try {
    let sql = `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE 1=1`;
    let params = [];
    let paramCount = 1;

    if (category && category !== 'all') {
      sql += ` AND c.name = $${paramCount}`;
      params.push(category);
      paramCount++;
    }

    if (category_id) {
      sql += ` AND p.category_id = $${paramCount}`;
      params.push(parseInt(category_id));
      paramCount++;
    }

    if (search) {
      sql += ` AND (p.name ILIKE $${paramCount} OR p.description ILIKE $${paramCount + 1} OR p.manufacturer ILIKE $${paramCount + 2} OR c.name ILIKE $${paramCount + 3})`;
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam, searchParam);
      paramCount += 4;
    }

    if (popular === 'true') {
      sql += " AND p.is_popular = true";
    }

    if (newProducts === 'true') {
      sql += " AND p.is_new = true";
    }

    sql += " ORDER BY p.created_at DESC";

    const offset = (parseInt(page) - 1) * parseInt(limit);
    sql += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), offset);

    const { rows } = await req.db.query(sql, params);
    
    let countSql = `SELECT COUNT(*) as total FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE 1=1`;
    let countParams = [];
    paramCount = 1;

    if (category && category !== 'all') {
      countSql += ` AND c.name = $${paramCount}`;
      countParams.push(category);
      paramCount++;
    }

    if (category_id) {
      countSql += ` AND p.category_id = $${paramCount}`;
      countParams.push(parseInt(category_id));
      paramCount++;
    }

    if (search) {
      countSql += ` AND (p.name ILIKE $${paramCount} OR p.description ILIKE $${paramCount + 1} OR p.manufacturer ILIKE $${paramCount + 2} OR c.name ILIKE $${paramCount + 3})`;
      const searchParam = `%${search}%`;
      countParams.push(searchParam, searchParam, searchParam, searchParam);
    }

    const { rows: countResult } = await req.db.query(countSql, countParams);

    res.json({ 
      success: true,
      products: rows || [],
      total: parseInt(countResult[0]?.total) || 0,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil((parseInt(countResult[0]?.total) || 0) / parseInt(limit))
    });
  } catch (err) {
    console.error('❌ Ошибка получения товаров:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
});

// Single product
app.get('/api/products/:id', databaseMiddleware, async (req, res) => {
  const productId = req.params.id;
  console.log('📨 GET /api/products/' + productId);
  
  try {
    const { rows } = await req.db.query(
      `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = $1`,
      [productId]
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
      error: err.message 
    });
  }
});

// Auth - Get current user
app.get('/api/auth/me', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/auth/me');
  
  try {
    const userId = req.query.user_id || req.headers['user-id'];
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Не авторизован'
      });
    }

    const { rows } = await req.db.query('SELECT * FROM users WHERE id = $1', [userId]);
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }

    const user = rows[0];
    delete user.password;

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

// Auth - Register
app.post('/api/auth/register', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/auth/register');
  const { first_name, last_name, username, email, password, phone } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ 
      success: false,
      error: 'Логин, email и пароль обязательны' 
    });
  }
  
  try {
    const { rows: existingUsers } = await req.db.query(
      'SELECT * FROM users WHERE username = $1 OR email = $2', 
      [username, email]
    );
    
    if (existingUsers.length > 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Пользователь с таким логином или email уже существует' 
      });
    }
    
    const hashedPassword = simpleHash(password);
    
    const { rows } = await req.db.query(
      `INSERT INTO users (first_name, last_name, username, email, password, phone, login_count) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [first_name, last_name, username, email, hashedPassword, phone, 0]
    );
    
    const newUser = rows[0];
    delete newUser.password;
    
    res.json({
      success: true,
      message: 'Регистрация успешна',
      user: newUser
    });
  } catch (err) {
    console.error('❌ Ошибка регистрации:', err);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка создания пользователя' 
    });
  }
});

// Auth - Login
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
    const { rows } = await req.db.query(
      "SELECT * FROM users WHERE username = $1 OR email = $1", 
      [username]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ 
        success: false,
        error: 'Неверный логин или пароль' 
      });
    }
    
    const user = rows[0];
    
    const isPasswordValid = comparePassword(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false,
        error: 'Неверный пароль' 
      });
    }
    
    await req.db.query(
      "UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = $1",
      [user.id]
    );
    
    delete user.password;
    
    res.json({
      success: true,
      message: 'Вход выполнен успешно',
      user: user
    });
  } catch (err) {
    console.error('❌ Ошибка входа:', err);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера' 
    });
  }
});

// User - Update profile
app.put('/api/user/update-profile', databaseMiddleware, async (req, res) => {
  console.log('📨 PUT /api/user/update-profile');
  
  const { user_id, first_name, last_name, middle_name, phone } = req.body;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'ID пользователя обязателен'
    });
  }

  try {
    await req.db.query(
      'UPDATE users SET first_name = $1, last_name = $2, middle_name = $3, phone = $4 WHERE id = $5',
      [first_name, last_name, middle_name, phone, user_id]
    );

    const { rows } = await req.db.query('SELECT * FROM users WHERE id = $1', [user_id]);
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

// User - Change password
app.post('/api/user/change-password', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/user/change-password');
  
  const { user_id, current_password, new_password } = req.body;
  
  if (!user_id || !current_password || !new_password) {
    return res.status(400).json({
      success: false,
      error: 'Все поля обязательны'
    });
  }

  try {
    const { rows } = await req.db.query('SELECT * FROM users WHERE id = $1', [user_id]);
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }

    const user = rows[0];
    
    const isPasswordValid = comparePassword(current_password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        error: 'Текущий пароль неверен'
      });
    }

    const hashedNewPassword = simpleHash(new_password);
    await req.db.query('UPDATE users SET password = $1 WHERE id = $2', [hashedNewPassword, user_id]);

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

// User - Upload avatar
app.post('/api/user/upload-avatar', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/user/upload-avatar');
  
  const { user_id, avatar } = req.body;
  
  if (!user_id) {
    return res.status(400).json({ 
      success: false, 
      error: 'ID пользователя обязателен' 
    });
  }

  try {
    await req.db.query(
      'UPDATE users SET avatar = $1 WHERE id = $2',
      [avatar, user_id]
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

// ==================== CART ROUTES ====================

// Cart - Add item
app.post('/api/cart/add', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/cart/add');
  const { user_id, product_id, quantity = 1 } = req.body;

  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

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

    // Check if user exists
    const { rows: users } = await req.db.query('SELECT * FROM users WHERE id = $1', [user_id]);
    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }

    // Add or update item in cart
    const { rows } = await req.db.query(`
      INSERT INTO cart_items (user_id, product_id, quantity) 
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, product_id) 
      DO UPDATE SET quantity = cart_items.quantity + $3
      RETURNING *
    `, [user_id, product_id, quantity]);

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

// Cart - Get cart
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
    const { rows } = await req.db.query(`
      SELECT ci.*, p.name, p.price, p.image, p.description, p.manufacturer, p.in_stock
      FROM cart_items ci
      LEFT JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = $1
      ORDER BY ci.created_at DESC
    `, [user_id]);

    res.json({
      success: true,
      items: rows || [],
      total: rows.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    });
  } catch (err) {
    console.error('❌ Ошибка получения корзины:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Cart - Update quantity
app.put('/api/cart/:itemId', databaseMiddleware, async (req, res) => {
  console.log('📨 PUT /api/cart/' + req.params.itemId);
  const { user_id, quantity } = req.body;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  if (!quantity || quantity < 1) {
    return res.status(400).json({
      success: false,
      error: 'Количество должно быть не менее 1'
    });
  }

  try {
    await req.db.query(
      'UPDATE cart_items SET quantity = $1 WHERE id = $2 AND user_id = $3',
      [quantity, req.params.itemId, user_id]
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

// Cart - Remove item
app.delete('/api/cart/:itemId', databaseMiddleware, async (req, res) => {
  console.log('📨 DELETE /api/cart/' + req.params.itemId);
  const { user_id } = req.body;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    await req.db.query(
      'DELETE FROM cart_items WHERE id = $1 AND user_id = $2',
      [req.params.itemId, user_id]
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

// Cart - Clear cart
app.delete('/api/cart', databaseMiddleware, async (req, res) => {
  console.log('📨 DELETE /api/cart');
  const { user_id } = req.body;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    await req.db.query('DELETE FROM cart_items WHERE user_id = $1', [user_id]);

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

// ==================== ORDER ROUTES ====================

// Create order
app.post('/api/orders/create', databaseMiddleware, async (req, res) => {
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
    
    // Создаем заказ
    const { rows: orderRows } = await req.db.query(
      `INSERT INTO delivery_orders (
        order_code, user_id, total_amount, delivery_address, 
        customer_name, customer_phone, customer_notes, payment_method
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [orderCode, 1, total_amount, delivery_address, customer_name, customer_phone, customer_notes, payment_method]
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

// ==================== COURIER ROUTES ====================

// Courier - Get orders
app.get('/api/courier/orders', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/courier/orders');
  
  try {
    // Получаем заказы с товарами
    const { rows: orders } = await req.db.query(`
      SELECT o.*, 
             json_agg(
               json_build_object(
                 'id', p.id,
                 'name', p.name,
                 'quantity', oi.quantity,
                 'price', oi.price
               )
             ) as products
      FROM delivery_orders o
      LEFT JOIN delivery_order_items oi ON o.id = oi.delivery_order_id
      LEFT JOIN products p ON oi.product_id = p.id
      WHERE o.status IN ('pending', 'assigned', 'delivered')
      GROUP BY o.id
      ORDER BY o.created_at DESC
    `);

    // Если заказов нет, создадим демо-данные
    if (orders.length === 0 || !orders[0].products[0].id) {
      console.log('Создаем демо-заказы...');
      
      // Создаем демо-заказы
      const demoOrders = [
        {
          user_id: 1,
          total_amount: 1250.50,
          address: 'г. Москва, ул. Тверская, д. 25, кв. 12',
          status: 'pending'
        },
        {
          user_id: 1,
          total_amount: 890.00,
          address: 'г. Москва, пр-т Мира, д. 15, кв. 45',
          status: 'assigned',
          courier_name: 'Петр Доставкин'
        },
        {
          user_id: 1,
          total_amount: 450.00,
          address: 'г. Москва, ул. Ленина, д. 8, кв. 33',
          status: 'pending'
        }
      ];

      for (const demoOrder of demoOrders) {
        const { rows: newOrder } = await req.db.query(
          `INSERT INTO delivery_orders (user_id, total_amount, delivery_address, status) 
           VALUES ($1, $2, $3, $4) RETURNING *`,
          [demoOrder.user_id, demoOrder.total_amount, demoOrder.address, demoOrder.status]
        );

        // Добавляем товары в заказ
        const { rows: products } = await req.db.query('SELECT id, price FROM products LIMIT 2');
        
        for (const product of products) {
          await req.db.query(
            'INSERT INTO delivery_order_items (delivery_order_id, product_id, product_name, quantity, unit_price, total_price) VALUES ($1, $2, $3, $4, $5, $6)',
            [newOrder[0].id, product.id, 'Тестовый товар', Math.floor(Math.random() * 3) + 1, product.price, product.price]
          );
        }
      }

      // Повторно получаем заказы
      const { rows: newOrders } = await req.db.query(`
        SELECT o.*, 
               json_agg(
                 json_build_object(
                   'id', p.id,
                   'name', p.name,
                   'quantity', oi.quantity,
                   'price', oi.price
                 )
               ) as products
        FROM delivery_orders o
        LEFT JOIN delivery_order_items oi ON o.id = oi.delivery_order_id
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE o.status IN ('pending', 'assigned', 'delivered')
        GROUP BY o.id
        ORDER BY o.created_at DESC
      `);

      res.json({
        success: true,
        orders: newOrders
      });
    } else {
      res.json({
        success: true,
        orders: orders
      });
    }
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
  
  const { order_id, courier_name } = req.body;
  
  if (!order_id || !courier_name) {
    return res.status(400).json({
      success: false,
      error: 'order_id и courier_name обязательны'
    });
  }

  try {
    const { rows } = await req.db.query(
      'UPDATE delivery_orders SET status = $1, courier_id = $2, assigned_at = CURRENT_TIMESTAMP WHERE id = $3 AND status = $4 RETURNING *',
      ['assigned', 1, order_id, 'pending']
    );

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Заказ не найден или уже принят'
      });
    }

    res.json({
      success: true,
      message: 'Заказ принят',
      order: rows[0]
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
  
  const { order_id } = req.body;
  
  if (!order_id) {
    return res.status(400).json({
      success: false,
      error: 'order_id обязателен'
    });
  }

  try {
    const { rows } = await req.db.query(
      'UPDATE delivery_orders SET status = $1, delivered_at = CURRENT_TIMESTAMP WHERE id = $2 AND status = $3 RETURNING *',
      ['delivered', order_id, 'assigned']
    );

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Заказ не найден или не был принят'
      });
    }

    res.json({
      success: true,
      message: 'Заказ доставлен',
      order: rows[0]
    });
  } catch (err) {
    console.error('❌ Ошибка завершения заказа:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка завершения заказа: ' + err.message
    });
  }
});

// ==================== GOOGLE AUTH ====================

// Verify Google token
async function verifyGoogleToken(token) {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: token,
      audience: process.env.GOOGLE_CLIENT_ID
    });
    return ticket.getPayload();
  } catch (error) {
    console.error('❌ Ошибка верификации Google токена:', error);
    return null;
  }
}

// Google OAuth check
app.post('/api/auth/google', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/auth/google');
  
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({
      success: false,
      error: 'Токен обязателен'
    });
  }

  try {
    const payload = await verifyGoogleToken(token);
    
    if (!payload) {
      return res.status(401).json({
        success: false,
        error: 'Неверный Google токен'
      });
    }

    const { rows } = await req.db.query(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2',
      [payload.sub, payload.email]
    );

    if (rows.length > 0) {
      const user = rows[0];
      delete user.password;
      
      await req.db.query(
        "UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = $1",
        [user.id]
      );
      
      res.json({
        success: true,
        user: user,
        requires_additional_info: false
      });
    } else {
      res.json({
        success: true,
        user: {
          sub: payload.sub,
          email: payload.email,
          email_verified: payload.email_verified,
          name: payload.name,
          given_name: payload.given_name,
          family_name: payload.family_name,
          picture: payload.picture
        },
        requires_additional_info: true
      });
    }
  } catch (err) {
    console.error('❌ Ошибка Google аутентификации:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка Google аутентификации'
    });
  }
});

// Google OAuth register
app.post('/api/auth/google/register', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/auth/google/register');
  
  const { google_id, email, first_name, last_name, phone, avatar, email_verified } = req.body;
  
  if (!google_id || !email) {
    return res.status(400).json({
      success: false,
      error: 'Google ID и email обязательны'
    });
  }

  try {
    let { rows } = await req.db.query(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2',
      [google_id, email]
    );

    let user;

    if (rows.length > 0) {
      user = rows[0];
      await req.db.query(
        'UPDATE users SET first_name = $1, last_name = $2, phone = $3, avatar = $4, email_verified = $5, google_id = $6, last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = $7',
        [first_name, last_name, phone, avatar, email_verified, google_id, user.id]
      );
    } else {
      const username = email.split('@')[0] + '_google';
      const tempPassword = simpleHash(Math.random().toString(36));
      
      const result = await req.db.query(
        `INSERT INTO users (first_name, last_name, username, email, password, phone, avatar, google_id, email_verified, login_count) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [first_name, last_name, username, email, tempPassword, phone, avatar, google_id, email_verified, 1]
      );
      
      user = result.rows[0];
    }

    delete user.password;

    res.json({
      success: true,
      message: 'Google авторизация успешна',
      user: user
    });
  } catch (err) {
    console.error('❌ Ошибка Google авторизации:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка Google авторизации'
    });
  }
});

// ==================== ADMIN ROUTES ====================

// Admin - Add product
app.post('/api/admin/products', databaseMiddleware, async (req, res) => {
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

// ==================== STATIC ROUTES ====================

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'main.html'));
});

app.get('/register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
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

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'netuDostup.html'));
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
      console.log(`\n📋 Доступные endpoints:`);
      console.log(`   GET  /api/categories - Категории`);
      console.log(`   GET  /api/products - Товары`);
      console.log(`   POST /api/orders/create - Создание заказа`);
      console.log(`   GET  /api/courier/orders - Заказы для курьера`);
      console.log(`   POST /api/courier/orders/accept - Принять заказ`);
      console.log(`   POST /api/courier/orders/complete - Завершить заказ`);
      console.log(`   POST /api/admin/products - Добавление товара`);
      console.log(`   GET  /api/auth/me - Получение пользователя`);
      console.log(`   POST /api/cart/add - Добавление в корзину`);
      console.log(`   GET  /api/cart - Получение корзины`);
      console.log(`   PUT  /api/cart/:id - Обновление корзины`);
      console.log(`   DELETE /api/cart/:id - Удаление из корзины`);
      console.log(`   POST /api/auth/register - Регистрация`);
      console.log(`   POST /api/auth/login - Вход`);
      console.log(`   POST /api/auth/google - Google OAuth`);
      console.log(`   POST /api/auth/google/register - Google регистрация`);
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
