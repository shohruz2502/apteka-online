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
    
    return db;
  } catch (err) {
    console.error('❌ Ошибка подключения к Neon.tech:', err);
    isDatabaseConnected = false;
    db = null;
    throw err;
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

// ==================== API ROUTES ====================

// ==================== COURIER PROFILE ROUTES ====================

// Courier - Get profile
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
      'SELECT * FROM couriers WHERE user_id = $1',
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

    const { rows } = await req.db.query(
      `SELECT cm.* FROM courier_messages cm 
       JOIN couriers c ON cm.courier_id = c.id 
       WHERE c.user_id = $1 
       ORDER BY cm.created_at DESC`,
      [user_id]
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

    const { rows } = await req.db.query(
      `SELECT cc.* FROM courier_chats cc 
       JOIN couriers c ON cc.courier_id = c.id 
       WHERE c.user_id = $1 AND cc.is_active = true 
       ORDER BY cc.last_message_at DESC`,
      [user_id]
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
      'SELECT * FROM courier_chat_messages WHERE chat_id = $1 ORDER BY created_at ASC',
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
    // Получаем данные курьера для имени
    const { rows: courierRows } = await req.db.query(
      'SELECT first_name FROM couriers WHERE user_id = $1',
      [user_id]
    );

    if (courierRows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Курьер не найден'
      });
    }

    const courierName = courierRows[0]?.first_name || 'Курьер';

    // Добавляем сообщение
    const { rows } = await req.db.query(
      `INSERT INTO courier_chat_messages (chat_id, sender_type, sender_name, message) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.params.chatId, 'courier', courierName, message]
    );

    // Обновляем последнее сообщение в чате
    await req.db.query(
      'UPDATE courier_chats SET last_message = $1, last_message_at = CURRENT_TIMESTAMP WHERE id = $2',
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

// Auth - Register (ИСПРАВЛЕННАЯ ВЕРСИЯ)
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
    
    // ИСПРАВЛЕНИЕ: phone теперь не обязателен
    const { rows } = await req.db.query(
      `INSERT INTO users (first_name, last_name, username, email, password, phone, login_count) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [first_name, last_name, username, email, hashedPassword, phone || null, 0]
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
app.put('/api/user/update-profile', databaseMiddleware, validateUser, async (req, res) => {
  console.log('📨 PUT /api/user/update-profile');
  
  const { first_name, last_name, middle_name, phone } = req.body;
  
  try {
    await req.db.query(
      'UPDATE users SET first_name = $1, last_name = $2, middle_name = $3, phone = $4 WHERE id = $5',
      [first_name, last_name, middle_name, phone, req.userId]
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

// User - Change password
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
    
    const isPasswordValid = comparePassword(current_password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({
        success: false,
        error: 'Текущий пароль неверен'
      });
    }

    const hashedNewPassword = simpleHash(new_password);
    await req.db.query('UPDATE users SET password = $1 WHERE id = $2', [hashedNewPassword, req.userId]);

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
app.post('/api/user/upload-avatar', databaseMiddleware, validateUser, async (req, res) => {
  console.log('📨 POST /api/user/upload-avatar');
  
  const { avatar } = req.body;
  
  try {
    await req.db.query(
      'UPDATE users SET avatar = $1 WHERE id = $2',
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

// ==================== CART ROUTES ====================

// Cart - Add item
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
    const { rows } = await req.db.query(`
      INSERT INTO cart_items (user_id, product_id, quantity) 
      VALUES ($1, $2, $3)
      ON CONFLICT (user_id, product_id) 
      DO UPDATE SET quantity = cart_items.quantity + $3
      RETURNING *
    `, [req.userId, product_id, quantity]);

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
      'UPDATE cart_items SET quantity = $1 WHERE id = $2 AND user_id = $3',
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

// Cart - Remove item
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

// Cart - Clear cart
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

// ==================== ORDER ROUTES ====================

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
    
    // Создаем заказ
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

    res.json({
      success: true,
      orders: orders
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
      'UPDATE delivery_orders SET status = $1, courier_id = $2, assigned_at = CURRENT_TIMESTAMP WHERE id = $3 AND status = $4 RETURNING *',
      ['assigned', courierId, order_id, 'pending']
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
        requires_additional_info: false // ИЗМЕНЕНИЕ: теперь всегда false
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

// Google OAuth register (ИСПРАВЛЕННАЯ ВЕРСИЯ)
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
        [first_name, last_name, phone || null, avatar, email_verified, google_id, user.id]
      );
    } else {
      const username = email.split('@')[0] + '_google';
      const tempPassword = simpleHash(Math.random().toString(36));
      
      const result = await req.db.query(
        `INSERT INTO users (first_name, last_name, username, email, password, phone, avatar, google_id, email_verified, login_count) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *`,
        [first_name, last_name, username, email, tempPassword, phone || null, avatar, google_id, email_verified, 1]
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
