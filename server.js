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
    console.log('🔄 Подключение к PostgreSQL...');
    
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
    
    console.log('✅ Успешное подключение к базе данных');
    
    // Проверяем и создаем необходимые таблицы
    await createTablesIfNeeded();
    
    return db;
  } catch (err) {
    console.error('❌ Ошибка подключения к базе данных:', err);
    isDatabaseConnected = false;
    db = null;
    throw err;
  }
}

// Создание таблиц если не существуют
async function createTablesIfNeeded() {
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

    console.log('✅ Таблицы проверены/созданы');
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
        phone, auth_method, login_count
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
        'email',
        0
      ]
    );
    
    const newUser = rows[0];
    console.log('✅ Новый пользователь зарегистрирован:', newUser.email);
    
    // Auto-login after registration
    const { rows: loginRows } = await req.db.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );
    
    const loggedInUser = loginRows[0];
    delete loggedInUser.password;
    
    // Update login stats
    await req.db.query(
      "UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = $1",
      [loggedInUser.id]
    );
    
    res.json({
      success: true,
      user: loggedInUser,
      message: 'Регистрация и вход успешны'
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
    const passwordValid = await comparePassword(password, user.password);
    
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
    console.error('❌ Ошибка получения пользователя:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
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

// ==================== USER PROFILE ====================

// Update user profile
app.put('/api/user/profile', databaseMiddleware, async (req, res) => {
  console.log('📨 PUT /api/user/profile');
  
  const { 
    user_id, 
    first_name, 
    last_name, 
    phone, 
    avatar_url 
  } = req.body;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    // Build update query dynamically
    const updates = [];
    const values = [];
    let valueIndex = 1;
    
    if (first_name !== undefined) {
      updates.push(`first_name = $${valueIndex++}`);
      values.push(first_name);
    }
    
    if (last_name !== undefined) {
      updates.push(`last_name = $${valueIndex++}`);
      values.push(last_name);
    }
    
    if (phone !== undefined) {
      updates.push(`phone = $${valueIndex++}`);
      values.push(phone);
    }
    
    if (avatar_url !== undefined) {
      updates.push(`avatar_url = $${valueIndex++}`);
      values.push(avatar_url);
    }
    
    if (updates.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Нет данных для обновления'
      });
    }
    
    updates.push(`updated_at = CURRENT_TIMESTAMP`);
    
    values.push(user_id);
    
    const query = `
      UPDATE users 
      SET ${updates.join(', ')}
      WHERE id = $${valueIndex}
      RETURNING id, username, email, full_name, first_name, last_name, 
                phone, avatar_url, google_id, email_verified, auth_method
    `;
    
    const { rows } = await req.db.query(query, values);
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }
    
    const updatedUser = rows[0];
    
    // Update full_name if first_name or last_name changed
    if (first_name !== undefined || last_name !== undefined) {
      const newFullName = `${updatedUser.first_name || ''} ${updatedUser.last_name || ''}`.trim();
      if (newFullName) {
        await req.db.query(
          'UPDATE users SET full_name = $1 WHERE id = $2',
          [newFullName, user_id]
        );
        updatedUser.full_name = newFullName;
      }
    }
    
    res.json({
      success: true,
      user: updatedUser,
      message: 'Профиль обновлен'
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
app.post('/api/user/change-password', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/user/change-password');
  
  const { user_id, current_password, new_password } = req.body;
  
  if (!user_id || !current_password || !new_password) {
    return res.status(400).json({
      success: false,
      error: 'Все поля обязательны'
    });
  }

  if (new_password.length < 6) {
    return res.status(400).json({
      success: false,
      error: 'Новый пароль должен содержать минимум 6 символов'
    });
  }

  try {
    // Get user with password
    const { rows } = await req.db.query(
      'SELECT * FROM users WHERE id = $1',
      [user_id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Пользователь не найден'
      });
    }
    
    const user = rows[0];
    
    // Check current password
    const passwordValid = await comparePassword(current_password, user.password);
    
    if (!passwordValid) {
      return res.status(400).json({
        success: false,
        error: 'Текущий пароль неверен'
      });
    }
    
    // Hash new password
    const hashedNewPassword = await hashPassword(new_password);
    
    // Update password
    await req.db.query(
      'UPDATE users SET password = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2',
      [hashedNewPassword, user_id]
    );
    
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

// ==================== PRODUCTS & CATEGORIES ====================

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

// Get products with filters
app.get('/api/products', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/products');
  
  const { 
    category_id, 
    search, 
    popular, 
    new: newProducts, 
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
              p.manufacturer, p.in_stock, p.stock_quantity
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
app.post('/api/cart/add', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/cart/add');
  
  const { user_id, product_id, quantity = 1 } = req.body;
  
  if (!user_id || !product_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id и product_id обязательны'
    });
  }

  try {
    // Check if product exists
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
    
    // Add or update item in cart
    const { rows } = await req.db.query(
      `INSERT INTO cart_items (user_id, product_id, quantity) 
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, product_id) 
       DO UPDATE SET quantity = cart_items.quantity + $3,
                     updated_at = CURRENT_TIMESTAMP
       RETURNING *`,
      [user_id, product_id, quantity]
    );
    
    res.json({
      success: true,
      item: rows[0],
      message: 'Товар добавлен в корзину'
    });
    
  } catch (err) {
    console.error('❌ Ошибка добавления в корзину:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка добавления в корзину: ' + err.message
    });
  }
});

// Update cart item quantity
app.put('/api/cart/:item_id', databaseMiddleware, async (req, res) => {
  console.log('📨 PUT /api/cart/' + req.params.item_id);
  
  const { user_id, quantity } = req.body;
  
  if (!user_id || !quantity || quantity < 1) {
    return res.status(400).json({
      success: false,
      error: 'user_id и корректное количество обязательны'
    });
  }

  try {
    const { rows } = await req.db.query(
      `UPDATE cart_items 
       SET quantity = $1, updated_at = CURRENT_TIMESTAMP 
       WHERE id = $2 AND user_id = $3
       RETURNING *`,
      [quantity, req.params.item_id, user_id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Элемент корзины не найден'
      });
    }
    
    res.json({
      success: true,
      item: rows[0],
      message: 'Количество обновлено'
    });
    
  } catch (err) {
    console.error('❌ Ошибка обновления корзины:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка обновления корзины: ' + err.message
    });
  }
});

// Remove from cart
app.delete('/api/cart/:item_id', databaseMiddleware, async (req, res) => {
  console.log('📨 DELETE /api/cart/' + req.params.item_id);
  
  const { user_id } = req.query;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    const { rows } = await req.db.query(
      `DELETE FROM cart_items 
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [req.params.item_id, user_id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Элемент корзины не найден'
      });
    }
    
    res.json({
      success: true,
      message: 'Товар удален из корзины'
    });
    
  } catch (err) {
    console.error('❌ Ошибка удаления из корзины:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка удаления из корзины: ' + err.message
    });
  }
});

// Clear cart
app.delete('/api/cart', databaseMiddleware, async (req, res) => {
  console.log('📨 DELETE /api/cart');
  
  const { user_id } = req.query;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    await req.db.query(
      'DELETE FROM cart_items WHERE user_id = $1',
      [user_id]
    );
    
    res.json({
      success: true,
      message: 'Корзина очищена'
    });
    
  } catch (err) {
    console.error('❌ Ошибка очистки корзины:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка очистки корзины: ' + err.message
    });
  }
});

// ==================== ORDER MANAGEMENT ====================

// Create order
app.post('/api/orders/create', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/orders/create');
  
  const {
    user_id,
    items,
    total_amount,
    delivery_address,
    customer_name,
    customer_phone,
    customer_notes,
    payment_method = 'cash'
  } = req.body;
  
  if (!user_id || !items || !total_amount || !delivery_address || !customer_name || !customer_phone) {
    return res.status(400).json({
      success: false,
      error: 'Все обязательные поля должны быть заполнены'
    });
  }

  try {
    // Generate unique order code
    const orderCode = 'ORD-' + Date.now().toString().slice(-8);
    
    // Start transaction
    await req.db.query('BEGIN');
    
    // Create order
    const { rows: orderRows } = await req.db.query(
      `INSERT INTO orders (
        order_code, user_id, total_amount, delivery_address, 
        customer_name, customer_phone, customer_notes, payment_method, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        orderCode, 
        user_id, 
        total_amount, 
        delivery_address, 
        customer_name, 
        customer_phone, 
        customer_notes || '', 
        payment_method,
        'pending'
      ]
    );
    
    const order = orderRows[0];
    
    // Add order items
    for (const item of items) {
      await req.db.query(
        `INSERT INTO order_items (
          order_id, product_id, product_name, quantity, unit_price, total_price
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          order.id,
          item.product_id,
          item.product_name,
          item.quantity,
          item.unit_price,
          item.total_price
        ]
      );
    }
    
    // Clear user's cart
    await req.db.query(
      'DELETE FROM cart_items WHERE user_id = $1',
      [user_id]
    );
    
    await req.db.query('COMMIT');
    
    console.log('✅ Заказ успешно создан:', order.id);
    
    res.json({
      success: true,
      order: order,
      message: 'Заказ успешно создан'
    });
    
  } catch (err) {
    await req.db.query('ROLLBACK');
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
                  'product_id', oi.product_id,
                  'product_name', oi.product_name,
                  'quantity', oi.quantity,
                  'unit_price', oi.unit_price,
                  'total_price', oi.total_price
                )
              ) as items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
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

// ==================== HEALTH CHECK & CONFIG ====================

// Health check
app.get('/health', databaseMiddleware, async (req, res) => {
  try {
    const usersCount = await db.query('SELECT COUNT(*) as count FROM users');
    const productsCount = await db.query('SELECT COUNT(*) as count FROM products');
    const categoriesCount = await db.query('SELECT COUNT(*) as count FROM categories');
    
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      database: 'Connected',
      tables: {
        users: parseInt(usersCount.rows[0]?.count) || 0,
        products: parseInt(productsCount.rows[0]?.count) || 0,
        categories: parseInt(categoriesCount.rows[0]?.count) || 0
      },
      googleAuth: {
        configured: !!process.env.GOOGLE_CLIENT_ID
      }
    });
  } catch (err) {
    res.status(500).json({ 
      status: 'ERROR', 
      timestamp: new Date().toISOString(),
      error: err.message
    });
  }
});

// Main config endpoint
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    googleClientId: process.env.GOOGLE_CLIENT_ID || 'not-configured',
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
      console.log(`🗄️ База данных: PostgreSQL (Neon.tech)`);
      console.log(`🔐 Google OAuth: ${process.env.GOOGLE_CLIENT_ID ? '✅ Настроен' : '❌ Не настроен'}`);
      
      console.log(`\n📋 Основные endpoints:`);
      console.log(`   GET  /api/config/google - Конфигурация Google OAuth`);
      console.log(`   POST /api/auth/google - Вход/регистрация через Google`);
      console.log(`   POST /api/auth/google/complete - Завершение регистрации Google`);
      console.log(`   POST /api/auth/register - Регистрация по email`);
      console.log(`   POST /api/auth/login - Вход по email`);
      console.log(`   GET  /api/auth/me - Получение текущего пользователя`);
      console.log(`   POST /api/addresses/save - Сохранение адреса с карты`);
      console.log(`   GET  /api/products - Получение товаров`);
      console.log(`   GET  /api/categories - Получение категорий`);
      console.log(`   POST /api/cart/add - Добавление в корзину`);
      console.log(`   GET  /api/cart - Получение корзины`);
      console.log(`   POST /api/orders/create - Создание заказа`);
      console.log(`   GET  /health - Проверка работы сервера`);
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
