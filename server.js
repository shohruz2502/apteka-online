const express = require('express');
const { Client } = require('pg');
const path = require('path');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Глобальная переменная для подключения
let db = null;
let lastConnectionTime = null;
let connectionAttempts = 0;

// Функция для получения подключения к БД
async function getDatabaseConnection() {
  connectionAttempts++;
  
  // Если подключение уже есть и активно, используем его
  if (db) {
    try {
      // Быстрая проверка подключения
      await db.query('SELECT 1 as status');
      console.log('✅ Используем существующее подключение к БД');
      return db;
    } catch (error) {
      console.log('🔄 Подключение неактивно, создаем новое...');
      try { 
        await db.end(); 
      } catch (e) {
        console.log('⚠️ Ошибка при закрытии старого подключения:', e.message);
      }
      db = null;
    }
  }

  // Создаем новое подключение
  try {
    console.log('🔄 Создаем новое подключение к БД...');
    console.log('📊 DATABASE_URL:', process.env.DATABASE_URL ? 'Установлена' : 'Не установлена');
    
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL не установлена в переменных окружения');
    }

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
    lastConnectionTime = new Date();
    
    console.log('✅ Подключение к БД успешно установлено');
    console.log('⏰ Время подключения:', lastConnectionTime.toISOString());
    
    // Инициализируем таблицы при первом подключении
    await initializeTables();
    
    return db;
  } catch (error) {
    console.error('❌ Ошибка подключения к БД:', error.message);
    console.error('🔧 Детали ошибки:', error);
    db = null;
    throw error;
  }
}

// Инициализация таблиц
async function initializeTables() {
  try {
    console.log('🔄 Инициализация таблиц БД...');
    
    // Таблица категорий
    await db.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        image VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Таблица продуктов
    await db.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10,2) NOT NULL,
        old_price DECIMAL(10,2),
        image VARCHAR(500),
        category_id INTEGER,
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

    // Таблица пользователей
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

    // Таблица корзины
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

    console.log('✅ Таблицы БД инициализированы');
    
    // Добавляем тестовые данные
    await seedInitialData();
    
  } catch (error) {
    console.error('❌ Ошибка инициализации таблиц:', error);
    throw error;
  }
}

// Добавление тестовых данных
async function seedInitialData() {
  try {
    // Проверяем есть ли категории
    const { rows: categories } = await db.query('SELECT COUNT(*) as count FROM categories');
    const categoriesCount = parseInt(categories[0].count);
    
    console.log(`📊 Найдено категорий в БД: ${categoriesCount}`);

    if (categoriesCount === 0) {
      console.log('🌱 Добавляем тестовые данные...');
      
      // Добавляем категории
      const categoriesData = [
        { name: 'Лекарства', description: 'Медицинские препараты', image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop' },
        { name: 'Витамины', description: 'Витамины и БАДы', image: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop' },
        { name: 'Красота', description: 'Средства по уходу', image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=300&h=200&fit=crop' },
        { name: 'Гигиена', description: 'Средства личной гигиены', image: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=300&h=200&fit=crop' },
        { name: 'Мама и ребенок', description: 'Товары для матери и ребенка', image: 'https://images.unsplash.com/photo-1516627145497-ae69578b5d77?w=300&h=200&fit=crop' },
        { name: 'Медтехника', description: 'Медицинская техника', image: 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=300&h=200&fit=crop' }
      ];

      for (const category of categoriesData) {
        await db.query(
          'INSERT INTO categories (name, description, image) VALUES ($1, $2, $3)',
          [category.name, category.description, category.image]
        );
      }

      // Добавляем тестовые товары
      const productsData = [
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
          composition: 'Ибупрофен 200 мг',
          indications: 'Головная боль, зубная боль, менструальная боль',
          usage: 'По 1 таблетке 3-4 раза в день',
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
          composition: 'Холекальциферол (витамин D3)',
          indications: 'Профилактика дефицита витамина D',
          usage: 'По 1 капсуле в день во время еды',
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
          composition: 'Парацетамол 500 мг',
          indications: 'Боль и лихорадка',
          usage: 'По 1-2 таблетки 3-4 раза в день',
          image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop'
        }
      ];

      for (const product of productsData) {
        await db.query(
          `INSERT INTO products (name, description, price, old_price, category_id, manufacturer, country, stock_quantity, is_popular, is_new, composition, indications, usage, image) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            product.name, product.description, product.price, product.old_price,
            product.category_id, product.manufacturer, product.country,
            product.stock_quantity, product.is_popular, product.is_new,
            product.composition, product.indications, product.usage, product.image
          ]
        );
      }

      console.log('✅ Тестовые данные успешно добавлены');
    } else {
      console.log('✅ В БД уже есть данные, пропускаем добавление тестовых');
    }
  } catch (error) {
    console.error('❌ Ошибка добавления тестовых данных:', error);
  }
}

// Middleware для подключения к БД
async function databaseMiddleware(req, res, next) {
  try {
    const database = await getDatabaseConnection();
    req.db = database;
    next();
  } catch (error) {
    console.error('❌ Ошибка в databaseMiddleware:', error.message);
    res.status(503).json({
      success: false,
      error: 'Сервис временно недоступен. Ошибка подключения к базе данных.',
      details: error.message
    });
  }
}

// Простая хеш-функция для паролей
function simpleHash(password) {
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return hash.toString();
}

// ==================== API ROUTES ====================

// Health check с подробной информацией
app.get('/health', async (req, res) => {
  const startTime = Date.now();
  const healthInfo = {
    status: 'OK',
    timestamp: new Date().toISOString(),
    service: 'Apteka Online API',
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    uptime: process.uptime(),
    database: {
      provider: 'Neon.tech PostgreSQL',
      status: 'CHECKING',
      connectionAttempts: connectionAttempts,
      lastConnection: lastConnectionTime ? lastConnectionTime.toISOString() : null
    },
    system: {
      node_version: process.version,
      platform: process.platform,
      memory: process.memoryUsage(),
      cpu_usage: process.cpuUsage()
    },
    endpoints: {
      total: 15,
      categories: '/api/categories',
      products: '/api/products', 
      auth: '/api/auth/*',
      cart: '/api/cart/*',
      health: '/health'
    },
    responseTime: 0
  };

  try {
    // Проверяем подключение к БД
    const database = await getDatabaseConnection();
    const dbCheckStart = Date.now();
    await database.query('SELECT 1 as status');
    const dbResponseTime = Date.now() - dbCheckStart;

    // Получаем статистику по таблицам
    const [productsCount, categoriesCount, usersCount, cartCount] = await Promise.all([
      database.query('SELECT COUNT(*) as count FROM products'),
      database.query('SELECT COUNT(*) as count FROM categories'),
      database.query('SELECT COUNT(*) as count FROM users'),
      database.query('SELECT COUNT(*) as count FROM cart_items')
    ]);

    healthInfo.database = {
      ...healthInfo.database,
      status: 'OK',
      responseTime: `${dbResponseTime}ms`,
      tables: {
        products: parseInt(productsCount.rows[0]?.count) || 0,
        categories: parseInt(categoriesCount.rows[0]?.count) || 0,
        users: parseInt(usersCount.rows[0]?.count) || 0,
        cart_items: parseInt(cartCount.rows[0]?.count) || 0
      },
      connection: {
        active: true,
        protocol: 'SSL',
        pool: 'Single connection'
      }
    };

    healthInfo.status = 'OK';
    healthInfo.responseTime = `${Date.now() - startTime}ms`;

    res.json(healthInfo);

  } catch (error) {
    healthInfo.status = 'ERROR';
    healthInfo.database = {
      ...healthInfo.database,
      status: 'ERROR',
      error: error.message,
      connection: {
        active: false,
        error: error.message
      }
    };
    healthInfo.responseTime = `${Date.now() - startTime}ms`;
    
    console.error('❌ Health check failed:', error.message);
    res.status(503).json(healthInfo);
  }
});

// Config
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    service: 'Apteka Online',
    version: '1.0.0',
    features: {
      auth: true,
      cart: true,
      products: true,
      categories: true,
      search: true
    },
    googleClientId: process.env.GOOGLE_CLIENT_ID || 'not-configured'
  });
});

// Categories
app.get('/api/categories', databaseMiddleware, async (req, res) => {
  try {
    console.log('📨 GET /api/categories');
    const { rows } = await req.db.query('SELECT * FROM categories ORDER BY name');
    
    res.json({
      success: true,
      data: rows,
      count: rows.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Categories error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      endpoint: '/api/categories'
    });
  }
});

// Products
app.get('/api/products', databaseMiddleware, async (req, res) => {
  try {
    console.log('📨 GET /api/products', req.query);
    const { category, search, popular, limit = 20, page = 1 } = req.query;
    
    let sql = `
      SELECT p.*, c.name as category_name 
      FROM products p 
      LEFT JOIN categories c ON p.category_id = c.id 
      WHERE 1=1
    `;
    let params = [];
    let paramCount = 1;

    if (category && category !== 'all') {
      sql += ` AND c.name = $${paramCount}`;
      params.push(category);
      paramCount++;
    }

    if (search) {
      sql += ` AND (p.name ILIKE $${paramCount} OR p.description ILIKE $${paramCount + 1} OR p.manufacturer ILIKE $${paramCount + 2})`;
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam);
      paramCount += 3;
    }

    if (popular === 'true') {
      sql += ` AND p.is_popular = true`;
    }

    sql += ` ORDER BY p.created_at DESC`;

    const offset = (parseInt(page) - 1) * parseInt(limit);
    sql += ` LIMIT $${paramCount} OFFSET $${paramCount + 1}`;
    params.push(parseInt(limit), offset);

    const { rows } = await req.db.query(sql, params);

    res.json({ 
      success: true,
      data: rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: rows.length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Products error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      endpoint: '/api/products'
    });
  }
});

// Single product
app.get('/api/products/:id', databaseMiddleware, async (req, res) => {
  try {
    console.log('📨 GET /api/products/' + req.params.id);
    
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
        error: 'Товар не найден',
        product_id: req.params.id
      });
    }
    
    res.json({ 
      success: true,
      data: rows[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Product error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message,
      endpoint: `/api/products/${req.params.id}`
    });
  }
});

// Auth - Register
app.post('/api/auth/register', databaseMiddleware, async (req, res) => {
  try {
    console.log('📨 POST /api/auth/register');
    const { username, email, password, first_name, last_name, phone } = req.body;
    
    if (!username || !email || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Логин, email и пароль обязательны' 
      });
    }
    
    // Проверяем существующего пользователя
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
      `INSERT INTO users (username, email, password, first_name, last_name, phone) 
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, email, first_name, last_name, phone, created_at`,
      [username, email, hashedPassword, first_name, last_name, phone]
    );
    
    res.json({
      success: true,
      message: 'Регистрация успешна',
      data: rows[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Registration error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка регистрации',
      endpoint: '/api/auth/register'
    });
  }
});

// Auth - Login
app.post('/api/auth/login', databaseMiddleware, async (req, res) => {
  try {
    console.log('📨 POST /api/auth/login');
    const { username, password } = req.body;
    
    if (!username || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Логин и пароль обязательны' 
      });
    }
    
    const { rows } = await req.db.query(
      'SELECT * FROM users WHERE username = $1 OR email = $1', 
      [username]
    );
    
    if (rows.length === 0) {
      return res.status(401).json({ 
        success: false,
        error: 'Неверный логин или пароль' 
      });
    }
    
    const user = rows[0];
    const isPasswordValid = simpleHash(password) === user.password;
    
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false,
        error: 'Неверный пароль' 
      });
    }
    
    // Обновляем последний вход
    await req.db.query(
      'UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = $1',
      [user.id]
    );
    
    // Убираем пароль из ответа
    const { password: _, ...userWithoutPassword } = user;
    
    res.json({
      success: true,
      message: 'Вход выполнен успешно',
      data: userWithoutPassword,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Login error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка входа',
      endpoint: '/api/auth/login'
    });
  }
});

// Cart - Add item
app.post('/api/cart/add', databaseMiddleware, async (req, res) => {
  try {
    console.log('📨 POST /api/cart/add', req.body);
    const { user_id, product_id, quantity = 1 } = req.body;

    if (!user_id || !product_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id и product_id обязательны'
      });
    }

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
      data: rows[0],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Cart add error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      endpoint: '/api/cart/add'
    });
  }
});

// Cart - Get cart
app.get('/api/cart', databaseMiddleware, async (req, res) => {
  try {
    console.log('📨 GET /api/cart', req.query);
    const { user_id } = req.query;

    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id обязателен'
      });
    }

    const { rows } = await req.db.query(`
      SELECT ci.*, p.name, p.price, p.image, p.description, p.manufacturer, p.in_stock
      FROM cart_items ci
      LEFT JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = $1
      ORDER BY ci.created_at DESC
    `, [user_id]);

    const total = rows.reduce((sum, item) => sum + (parseFloat(item.price) * item.quantity), 0);

    res.json({
      success: true,
      data: {
        items: rows,
        total: total,
        count: rows.length
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Cart get error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      endpoint: '/api/cart'
    });
  }
});

// Cart - Remove item
app.delete('/api/cart/:itemId', databaseMiddleware, async (req, res) => {
  try {
    console.log('📨 DELETE /api/cart/' + req.params.itemId);
    const { user_id } = req.body;
    
    if (!user_id) {
      return res.status(400).json({
        success: false,
        error: 'user_id обязателен'
      });
    }

    await req.db.query(
      'DELETE FROM cart_items WHERE id = $1 AND user_id = $2',
      [req.params.itemId, user_id]
    );

    res.json({
      success: true,
      message: 'Товар удален из корзины',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Cart delete error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      endpoint: `/api/cart/${req.params.itemId}`
    });
  }
});

// Static routes
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

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.originalUrl,
    method: req.method,
    timestamp: new Date().toISOString()
  });
});

// Error handler
app.use((error, req, res, next) => {
  console.error('❌ Server error:', error);
  res.status(500).json({
    success: false,
    error: 'Internal server error',
    message: error.message,
    timestamp: new Date().toISOString()
  });
});

// Export for Vercel
module.exports = app;

// Start server for local development
if (require.main === module) {
  app.listen(PORT, async () => {
    console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`⏰ ${new Date().toISOString()}`);
    console.log(`🔧 NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    console.log(`📊 DATABASE_URL: ${process.env.DATABASE_URL ? 'Установлена' : 'Не установлена'}`);
    
    // Пытаемся подключиться к БД при старте
    try {
      await getDatabaseConnection();
      console.log('✅ База данных готова к работе');
    } catch (error) {
      console.log('⚠️  База данных недоступна, но сервер запущен');
    }
    
    console.log('\n📋 Доступные endpoints:');
    console.log('   GET  /health          - Проверка здоровья сервера');
    console.log('   GET  /api/categories  - Категории товаров');
    console.log('   GET  /api/products    - Товары');
    console.log('   POST /api/auth/login  - Вход');
    console.log('   POST /api/auth/register - Регистрация');
    console.log('   GET  /api/cart        - Корзина');
    console.log('   POST /api/cart/add    - Добавить в корзину');
  });
}
