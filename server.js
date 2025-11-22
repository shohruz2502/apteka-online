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

// ✅ Neon.tech PostgreSQL подключение
const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

let db;
let isDatabaseConnected = false;

// Инициализация базы данных
async function initializeDatabase() {
  try {
    console.log('🔄 Подключение к Neon.tech PostgreSQL...');
    await client.connect();
    db = client;
    isDatabaseConnected = true;
    console.log('✅ Успешное подключение к Neon.tech');
    
    await createTables();
    await seedInitialData();
    console.log('✅ База данных готова к работе');
    return db;
  } catch (err) {
    console.error('❌ Ошибка подключения к Neon.tech:', err);
    isDatabaseConnected = false;
    throw new Error('Не удалось подключиться к базе данных');
  }
}

// Создание таблиц
async function createTables() {
  if (!isDatabaseConnected) throw new Error('База данных не подключена');

  try {
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

    console.log('✅ Таблицы созданы/проверены');
    
  } catch (err) {
    console.error('❌ Ошибка создания таблиц:', err);
    throw err;
  }
}

// Заполнение начальными данными
async function seedInitialData() {
  try {
    // Проверяем, есть ли уже категории
    const { rows: existingCategories } = await db.query('SELECT COUNT(*) as count FROM categories');
    if (parseInt(existingCategories[0].count) === 0) {
      console.log('🌱 Заполнение начальными данными...');
      
      // Добавляем категории
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

      // Добавляем тестовые товары
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
  } catch (err) {
    console.error('❌ Ошибка заполнения начальных данных:', err);
  }
}

// Middleware для проверки подключения к БД
function checkDatabaseConnection(req, res, next) {
  if (!isDatabaseConnected) {
    return res.status(503).json({
      success: false,
      error: 'Сервис временно недоступен. База данных не подключена.'
    });
  }
  next();
}

// Вспомогательная функция для простого хеширования пароля (без bcrypt)
function simpleHash(password) {
  // Простая хеш-функция для демонстрации
  let hash = 0;
  for (let i = 0; i < password.length; i++) {
    const char = password.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash.toString();
}

// Вспомогательная функция для проверки пароля
function comparePassword(password, hashedPassword) {
  return simpleHash(password) === hashedPassword;
}

// ==================== API ROUTES ====================

// Получение текущего пользователя
app.get('/api/auth/me', checkDatabaseConnection, async (req, res) => {
  console.log('📨 GET /api/auth/me');
  
  try {
    const userId = req.query.user_id || req.headers['user-id'];
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Не авторизован'
      });
    }

    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
    
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

// Обновление профиля пользователя
app.put('/api/user/update-profile', checkDatabaseConnection, async (req, res) => {
  console.log('📨 PUT /api/user/update-profile');
  
  const { user_id, first_name, last_name, middle_name, phone } = req.body;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'ID пользователя обязателен'
    });
  }

  try {
    await db.query(
      'UPDATE users SET first_name = $1, last_name = $2, middle_name = $3, phone = $4 WHERE id = $5',
      [first_name, last_name, middle_name, phone, user_id]
    );

    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [user_id]);
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

// Смена пароля
app.post('/api/user/change-password', checkDatabaseConnection, async (req, res) => {
  console.log('📨 POST /api/user/change-password');
  
  const { user_id, current_password, new_password } = req.body;
  
  if (!user_id || !current_password || !new_password) {
    return res.status(400).json({
      success: false,
      error: 'Все поля обязательны'
    });
  }

  try {
    const { rows } = await db.query('SELECT * FROM users WHERE id = $1', [user_id]);
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }

    const user = rows[0];
    
    // Проверяем текущий пароль
    const isPasswordValid = comparePassword(current_password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        error: 'Текущий пароль неверен'
      });
    }

    // Хешируем новый пароль
    const hashedNewPassword = simpleHash(new_password);
    await db.query('UPDATE users SET password = $1 WHERE id = $2', [hashedNewPassword, user_id]);

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

// Загрузка аватарки
app.post('/api/user/upload-avatar', checkDatabaseConnection, async (req, res) => {
  console.log('📨 POST /api/user/upload-avatar');
  
  const { user_id, avatar } = req.body;
  
  if (!user_id) {
    return res.status(400).json({ 
      success: false, 
      error: 'ID пользователя обязателен' 
    });
  }

  try {
    await db.query(
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

// Категории
app.get('/api/categories', checkDatabaseConnection, async (req, res) => {
  console.log('📨 GET /api/categories');
  try {
    const { rows } = await db.query('SELECT * FROM categories ORDER BY name');
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Ошибка получения категорий:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
});

// Товары
app.get('/api/products', checkDatabaseConnection, async (req, res) => {
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

    const { rows } = await db.query(sql, params);
    
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

    const { rows: countResult } = await db.query(countSql, countParams);

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

// Получение одного товара
app.get('/api/products/:id', checkDatabaseConnection, async (req, res) => {
  const productId = req.params.id;
  console.log('📨 GET /api/products/' + productId);
  
  try {
    const { rows } = await db.query(
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

// Регистрация
app.post('/api/auth/register', checkDatabaseConnection, async (req, res) => {
  console.log('📨 POST /api/auth/register');
  const { first_name, last_name, username, email, password, phone } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ 
      success: false,
      error: 'Логин, email и пароль обязательны' 
    });
  }
  
  try {
    const { rows: existingUsers } = await db.query(
      'SELECT * FROM users WHERE username = $1 OR email = $2', 
      [username, email]
    );
    
    if (existingUsers.length > 0) {
      return res.status(400).json({ 
        success: false,
        error: 'Пользователь с таким логином или email уже существует' 
      });
    }
    
    // Хешируем пароль
    const hashedPassword = simpleHash(password);
    
    const { rows } = await db.query(
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

// Вход
app.post('/api/auth/login', checkDatabaseConnection, async (req, res) => {
  console.log('📨 POST /api/auth/login');
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ 
      success: false,
      error: 'Логин и пароль обязательны' 
    });
  }
  
  try {
    const { rows } = await db.query(
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
    
    // Проверяем пароль
    const isPasswordValid = comparePassword(password, user.password);
    if (!isPasswordValid) {
      return res.status(401).json({ 
        success: false,
        error: 'Неверный пароль' 
      });
    }
    
    await db.query(
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

// ==================== GOOGLE AUTH ====================

// Верификация Google токена
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

// Google OAuth проверка
app.post('/api/auth/google', checkDatabaseConnection, async (req, res) => {
  console.log('📨 POST /api/auth/google');
  
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({
      success: false,
      error: 'Токен обязателен'
    });
  }

  try {
    // Верифицируем Google токен
    const payload = await verifyGoogleToken(token);
    
    if (!payload) {
      return res.status(401).json({
        success: false,
        error: 'Неверный Google токен'
      });
    }

    // Проверяем, есть ли пользователь
    const { rows } = await db.query(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2',
      [payload.sub, payload.email]
    );

    if (rows.length > 0) {
      // Пользователь существует
      const user = rows[0];
      delete user.password;
      
      // Обновляем последний вход
      await db.query(
        "UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = $1",
        [user.id]
      );
      
      res.json({
        success: true,
        user: user,
        requires_additional_info: false
      });
    } else {
      // Новый пользователь
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

// Google OAuth регистрация/вход
app.post('/api/auth/google/register', checkDatabaseConnection, async (req, res) => {
  console.log('📨 POST /api/auth/google/register');
  
  const { google_id, email, first_name, last_name, phone, avatar, email_verified } = req.body;
  
  if (!google_id || !email) {
    return res.status(400).json({
      success: false,
      error: 'Google ID и email обязательны'
    });
  }

  try {
    // Проверяем, есть ли пользователь с таким google_id
    let { rows } = await db.query(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2',
      [google_id, email]
    );

    let user;

    if (rows.length > 0) {
      // Обновляем существующего пользователя
      user = rows[0];
      await db.query(
        'UPDATE users SET first_name = $1, last_name = $2, phone = $3, avatar = $4, email_verified = $5, google_id = $6, last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = $7',
        [first_name, last_name, phone, avatar, email_verified, google_id, user.id]
      );
    } else {
      // Создаем нового пользователя
      const username = email.split('@')[0] + '_google';
      const tempPassword = simpleHash(Math.random().toString(36));
      
      const result = await db.query(
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

// ==================== КОРЗИНА ====================

// Корзина - добавление товара
app.post('/api/cart/add', checkDatabaseConnection, async (req, res) => {
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
    // Проверяем существование товара
    const { rows: products } = await db.query('SELECT * FROM products WHERE id = $1', [product_id]);
    if (products.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Товар не найден'
      });
    }

    // Проверяем существование пользователя
    const { rows: users } = await db.query('SELECT * FROM users WHERE id = $1', [user_id]);
    if (users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }

    // Добавляем или обновляем товар в корзине
    const { rows } = await db.query(`
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

// Корзина - получение содержимого
app.get('/api/cart', checkDatabaseConnection, async (req, res) => {
  console.log('📨 GET /api/cart');
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    const { rows } = await db.query(`
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

// Корзина - обновление количества
app.put('/api/cart/:itemId', checkDatabaseConnection, async (req, res) => {
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
    await db.query(
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

// Корзина - удаление товара
app.delete('/api/cart/:itemId', checkDatabaseConnection, async (req, res) => {
  console.log('📨 DELETE /api/cart/' + req.params.itemId);
  const { user_id } = req.body;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    await db.query(
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

// Корзина - очистка корзины
app.delete('/api/cart', checkDatabaseConnection, async (req, res) => {
  console.log('📨 DELETE /api/cart');
  const { user_id } = req.body;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    await db.query('DELETE FROM cart_items WHERE user_id = $1', [user_id]);

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

// ==================== ADMIN ROUTES ====================

// Добавление товара через админку
app.post('/api/admin/products', checkDatabaseConnection, async (req, res) => {
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
    const { rows: categoryRows } = await db.query(
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

    const { rows } = await db.query(
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

// Статические страницы
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

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'netuDostup.html'));
});

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

// Обработка ошибок подключения к БД
process.on('unhandledRejection', (err) => {
  console.error('❌ Необработанная ошибка:', err);
});

// Запуск сервера
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
    console.error('💡 Убедитесь, что:');
    console.error('   1. Переменная окружения DATABASE_URL установлена правильно');
    console.error('   2. Neon.tech база данных доступна');
    console.error('   3. Параметры подключения корректны');
    
    // Запускаем сервер даже без БД, но API будет возвращать ошибки
    app.listen(PORT, () => {
      console.log(`\n⚠️  Сервер запущен без подключения к БД на порту ${PORT}`);
      console.log(`📍 http://localhost:${PORT}`);
      console.log(`❌ API endpoints будут возвращать ошибки`);
    });
  }
}

// Для Vercel
module.exports = app;

// Для локальной разработки
if (require.main === module) {
  startServer();
}
