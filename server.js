const express = require('express');
const { Client } = require('pg');
const path = require('path');
const cors = require('cors');
const { OAuth2Client } = require('google-auth-library');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:5500', 'https://pharma-plus.vercel.app'],
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Google OAuth client
let googleClient = null;
if (process.env.GOOGLE_CLIENT_ID) {
  googleClient = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
} else {
  console.log('⚠️ Google OAuth не настроен');
}

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

// ==================== GOOGLE OAUTH ROUTES ====================

// Get Google client config
app.get('/api/config/google', (req, res) => {
  res.json({
    success: true,
    googleClientId: process.env.GOOGLE_CLIENT_ID || 'not-configured',
    hasGoogleAuth: !!process.env.GOOGLE_CLIENT_ID
  });
});

// Verify Google token
async function verifyGoogleToken(token) {
  try {
    if (!googleClient) {
      console.log('⚠️ Google OAuth не настроен, пропускаем верификацию');
      // В демо-режиме возвращаем тестовые данные
      return {
        sub: 'demo_google_id_' + Date.now(),
        email: 'demo@example.com',
        email_verified: true,
        name: 'Demo User',
        given_name: 'Demo',
        family_name: 'User',
        picture: 'https://via.placeholder.com/150'
      };
    }
    
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

// Google OAuth endpoint
app.post('/api/auth/google', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/auth/google');
  
  const { credential } = req.body;
  
  if (!credential) {
    return res.status(400).json({
      success: false,
      error: 'Google credential обязателен'
    });
  }

  try {
    const payload = await verifyGoogleToken(credential);
    
    if (!payload) {
      return res.status(401).json({
        success: false,
        error: 'Неверный Google токен'
      });
    }

    console.log('✅ Google payload получен:', {
      sub: payload.sub,
      email: payload.email,
      name: payload.name
    });

    // Проверяем, существует ли пользователь с таким Google ID или email
    const { rows } = await req.db.query(
      'SELECT * FROM users WHERE google_id = $1 OR email = $2',
      [payload.sub, payload.email]
    );

    if (rows.length > 0) {
      const user = rows[0];
      delete user.password;
      
      // Обновляем данные Google, если их нет
      if (!user.google_id) {
        await req.db.query(
          'UPDATE users SET google_id = $1, avatar = $2 WHERE id = $3',
          [payload.sub, payload.picture || user.avatar, user.id]
        );
        user.google_id = payload.sub;
      }
      
      await req.db.query(
        "UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = $1",
        [user.id]
      );
      
      console.log('✅ Существующий пользователь найден:', user.id);
      
      res.json({
        success: true,
        exists: true,
        user: {
          id: user.id,
          username: user.username,
          email: user.email,
          first_name: user.first_name,
          last_name: user.last_name,
          full_name: user.full_name,
          phone: user.phone,
          avatar: user.avatar || payload.picture,
          google_id: user.google_id,
          auth_method: 'google',
          created_at: user.created_at
        }
      });
    } else {
      console.log('🆕 Новый Google пользователь');
      
      res.json({
        success: true,
        exists: false,
        user: {
          google_id: payload.sub,
          email: payload.email,
          email_verified: payload.email_verified,
          name: payload.name,
          given_name: payload.given_name,
          family_name: payload.family_name,
          picture: payload.picture,
          auth_method: 'google'
        }
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
  
  const { google_id, email, username, password, first_name, last_name, phone, avatar } = req.body;
  
  if (!google_id || !email) {
    return res.status(400).json({
      success: false,
      error: 'Google ID и email обязательны'
    });
  }

  try {
    // Проверяем, не существует ли уже пользователь с таким username или email
    let existingUsers = [];
    if (username) {
      const { rows } = await req.db.query(
        'SELECT * FROM users WHERE username = $1 OR email = $2 OR google_id = $3',
        [username, email, google_id]
      );
      existingUsers = rows;
    } else {
      const { rows } = await req.db.query(
        'SELECT * FROM users WHERE email = $1 OR google_id = $2',
        [email, google_id]
      );
      existingUsers = rows;
    }
    
    if (existingUsers.length > 0) {
      return res.status(400).json({
        success: false,
        error: 'Пользователь с таким логином, email или Google ID уже существует'
      });
    }

    // Генерируем username из email если не предоставлен
    const finalUsername = username || email.split('@')[0].replace(/[^a-zA-Z0-9]/g, '') + '_' + Date.now().toString().slice(-4);
    
    let hashedPassword = null;
    if (password && password.length >= 6) {
      hashedPassword = simpleHash(password);
    } else {
      // Генерируем случайный пароль для пользователей, которые регистрируются только через Google
      hashedPassword = simpleHash(Math.random().toString(36) + Date.now().toString());
    }

    const { rows } = await req.db.query(
      `INSERT INTO users (first_name, last_name, username, email, password, phone, avatar, google_id, email_verified, login_count) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id, username, email, first_name, last_name, phone, avatar, google_id, created_at`,
      [
        first_name || '',
        last_name || '',
        finalUsername,
        email,
        hashedPassword,
        phone || null,
        avatar || '',
        google_id,
        true,
        1
      ]
    );
    
    const user = rows[0];
    
    console.log('✅ Google регистрация успешна:', user.id);

    res.json({
      success: true,
      message: 'Google регистрация успешна',
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        full_name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
        phone: user.phone,
        avatar: user.avatar,
        google_id: user.google_id,
        auth_method: 'google',
        created_at: user.created_at
      }
    });
  } catch (err) {
    console.error('❌ Ошибка Google регистрации:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка Google регистрации: ' + err.message
    });
  }
});

// ==================== МАРШРУТЫ ДЛЯ КАРТЫ (MAP.HTML) ====================

// Save delivery address
app.post('/api/delivery/address', databaseMiddleware, validateUser, async (req, res) => {
  console.log('📨 POST /api/delivery/address');
  
  const { address, latitude, longitude } = req.body;
  
  if (!address) {
    return res.status(400).json({
      success: false,
      error: 'Адрес обязателен'
    });
  }

  try {
    // Сохраняем адрес доставки для пользователя
    await req.db.query(
      `INSERT INTO user_addresses (user_id, address, latitude, longitude, is_default, address_type)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) 
       DO UPDATE SET address = $2, latitude = $3, longitude = $4, updated_at = CURRENT_TIMESTAMP`,
      [req.userId, address, latitude || null, longitude || null, true, 'delivery']
    );

    // Также обновляем адрес в таблице пользователей для быстрого доступа
    await req.db.query(
      'UPDATE users SET delivery_address = $1, delivery_latitude = $2, delivery_longitude = $3 WHERE id = $4',
      [address, latitude || null, longitude || null, req.userId]
    );

    res.json({
      success: true,
      message: 'Адрес доставки сохранен',
      address: address,
      coordinates: { latitude, longitude }
    });
  } catch (err) {
    console.error('❌ Ошибка сохранения адреса:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка сохранения адреса: ' + err.message
    });
  }
});

// Get user's delivery address
app.get('/api/delivery/address', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/delivery/address');
  
  const { user_id } = req.query;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    const { rows } = await req.db.query(
      `SELECT ua.* 
       FROM user_addresses ua
       WHERE ua.user_id = $1 AND ua.is_default = true AND ua.address_type = 'delivery'
       ORDER BY ua.updated_at DESC
       LIMIT 1`,
      [user_id]
    );

    if (rows.length === 0) {
      // Пробуем получить из таблицы пользователей
      const { rows: userRows } = await req.db.query(
        'SELECT delivery_address, delivery_latitude, delivery_longitude FROM users WHERE id = $1',
        [user_id]
      );
      
      if (userRows.length > 0 && userRows[0].delivery_address) {
        return res.json({
          success: true,
          address: {
            address: userRows[0].delivery_address,
            latitude: userRows[0].delivery_latitude,
            longitude: userRows[0].delivery_longitude
          }
        });
      }
      
      return res.json({
        success: true,
        address: null
      });
    }

    res.json({
      success: true,
      address: rows[0]
    });
  } catch (err) {
    console.error('❌ Ошибка получения адреса:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка получения адреса: ' + err.message
    });
  }
});

// ==================== COURIER ROUTES (ВЗЯТО ИЗ ПЕРВОГО ФАЙЛА) ====================

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

// ==================== USER PROFILE ROUTES (ВЗЯТО ИЗ ПЕРВОГО ФАЙЛА) ====================

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

// ==================== HEALTH CHECK & CONFIG ====================

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

// ==================== EXISTING ROUTES (сохраняем все предыдущие функции) ====================

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
      `INSERT INTO users (first_name, last_name, username, email, password, phone) 
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, username, email, first_name, last_name, phone, avatar, created_at`,
      [first_name || '', last_name || '', username, email, hashedPassword, phone || null]
    );
    
    const newUser = rows[0];
    newUser.full_name = `${newUser.first_name || ''} ${newUser.last_name || ''}`.trim();
    
    console.log('✅ Регистрация успешна:', newUser.id);
    
    res.json({
      success: true,
      message: 'Регистрация успешна',
      user: newUser
    });
  } catch (err) {
    console.error('❌ Ошибка регистрации:', err);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка создания пользователя: ' + err.message 
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

app.get('/courier-register', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'courier-register.html'));
});

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'netuDostup.html'));
});

app.get('/map', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'map.html'));
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
      console.log(`\n📋 Ключевые endpoints для регистрации:`);
      console.log(`   GET  /api/config/google - Конфигурация Google OAuth`);
      console.log(`   POST /api/auth/google - Google авторизация`);
      console.log(`   POST /api/auth/google/complete - Завершение Google регистрации`);
      console.log(`   POST /api/auth/register - Обычная регистрация`);
      console.log(`   POST /api/auth/login - Вход`);
      console.log(`   GET  /api/auth/me - Получение данных пользователя`);
      console.log(`\n📋 Курьерские endpoints:`);
      console.log(`   POST /api/courier/register - Регистрация курьера`);
      console.log(`   GET  /api/courier/profile - Профиль курьера`);
      console.log(`   GET  /api/courier/orders - Заказы курьера`);
      console.log(`   POST /api/courier/orders/accept - Принять заказ`);
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
