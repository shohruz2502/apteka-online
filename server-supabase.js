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

let db;

// Инициализация базы данных ТОЛЬКО с Supabase
async function initializeDatabase() {
  try {
    console.log('🔄 Подключение к Supabase PostgreSQL...');
    
    if (!process.env.DATABASE_URL) {
      throw new Error('❌ DATABASE_URL не установлен. Добавьте в Vercel: Settings → Environment Variables');
    }
    
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    await client.connect();
    db = client;
    console.log('✅ Успешное подключение к Supabase');
    
    await createTables();
    await addSampleData();
    
    console.log('✅ База данных готова к работе');
    return db;
  } catch (err) {
    console.error('❌ Ошибка подключения к Supabase:', err.message);
    console.log('💡 Решение:');
    console.log('   1. Зайдите в Vercel → Settings → Environment Variables');
    console.log('   2. Добавьте DATABASE_URL с вашей строкой подключения от Supabase');
    console.log('   3. Передеплойте приложение');
    throw err;
  }
}

// Создание таблиц
async function createTables() {
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

// Добавление тестовых данных
async function addSampleData() {
  try {
    // Проверяем есть ли категории
    const { rows: existingCategories } = await db.query('SELECT COUNT(*) as count FROM categories');
    if (parseInt(existingCategories[0].count) === 0) {
      console.log('📝 Добавляем тестовые категории...');
      await db.query(`
        INSERT INTO categories (name, description, image) VALUES
        ('Лекарства', 'Медицинские препараты', 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop'),
        ('Витамины', 'Витамины и БАДы', 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop'),
        ('Красота', 'Средства по уходу', 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=300&h=200&fit=crop'),
        ('Гигиена', 'Средства личной гигиены', 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=300&h=200&fit=crop')
      `);
    }

    // Проверяем есть ли продукты
    const { rows: existingProducts } = await db.query('SELECT COUNT(*) as count FROM products');
    if (parseInt(existingProducts[0].count) === 0) {
      console.log('📝 Добавляем тестовые продукты...');
      await db.query(`
        INSERT INTO products (name, description, price, old_price, image, category_id, manufacturer, country, stock_quantity, is_popular, composition) VALUES
        ('Нурофен таблетки 200мг №20', 'Обезболивающее и жаропонижающее средство', 250.50, 280.00, 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop', 1, 'Рекитт Бенкизер', 'Великобритания', 50, true, 'Ибупрофен 200 мг'),
        ('Витамин C 1000мг', 'Витамин C в таблетках для иммунитета', 450.00, 520.00, 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop', 2, 'Solgar', 'США', 30, true, 'Аскорбиновая кислота 1000 мг'),
        ('Панадол 500мг №12', 'Обезболивающее средство', 180.00, NULL, 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop', 1, 'ГлаксоСмитКляйн', 'Великобритания', 25, false, 'Парацетамол 500 мг')
      `);
    }

    // Добавляем тестового пользователя если нет
    const { rows: existingUsers } = await db.query('SELECT COUNT(*) as count FROM users');
    if (parseInt(existingUsers[0].count) === 0) {
      console.log('📝 Добавляем тестовых пользователей...');
      await db.query(`
        INSERT INTO users (first_name, last_name, username, email, password, phone, is_admin) VALUES
        ('Админ', 'Админов', 'admin', 'admin@example.com', 'admin123', '+992 123456789', true),
        ('Иван', 'Иванов', 'ivan', 'ivan@example.com', 'password123', '+992 987654321', false)
      `);
    }

    console.log('✅ Тестовые данные добавлены');
  } catch (err) {
    console.error('❌ Ошибка добавления тестовых данных:', err);
  }
}

// ==================== API ROUTES ====================

// Health check
app.get('/health', async (req, res) => {
  try {
    const productsCount = await db.query('SELECT COUNT(*) as count FROM products');
    const categoriesCount = await db.query('SELECT COUNT(*) as count FROM categories');
    const usersCount = await db.query('SELECT COUNT(*) as count FROM users');
    
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      database: 'Supabase PostgreSQL',
      tables: {
        products: parseInt(productsCount.rows[0]?.count) || 0,
        categories: parseInt(categoriesCount.rows[0]?.count) || 0,
        users: parseInt(usersCount.rows[0]?.count) || 0
      }
    });
  } catch (err) {
    res.status(500).json({ 
      status: 'ERROR', 
      error: err.message 
    });
  }
});

// Категории
app.get('/api/categories', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM categories ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Товары с фильтрацией
app.get('/api/products', async (req, res) => {
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
      sql += ` AND (p.name ILIKE $${paramCount} OR p.description ILIKE $${paramCount + 1} OR p.manufacturer ILIKE $${paramCount + 2})`;
      const searchParam = `%${search}%`;
      params.push(searchParam, searchParam, searchParam);
      paramCount += 3;
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

    res.json({ 
      success: true,
      products: rows,
      total: rows.length,
      page: parseInt(page),
      limit: parseInt(limit)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получение одного товара
app.get('/api/products/:id', async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = $1`,
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Товар не найден' });
    }
    
    res.json({ success: true, product: rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Добавление товара (админка)
app.post('/api/admin/products', async (req, res) => {
  const {
    name, category_id, description, price, old_price, manufacturer, country,
    stock_quantity, in_stock, is_popular, is_new, composition, indications,
    usage, contraindications, dosage, expiry_date, storage_conditions
  } = req.body;

  if (!name || !category_id || !price) {
    return res.status(400).json({ error: 'Название, категория и цена обязательны' });
  }

  try {
    const demoImages = [
      'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop',
      'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop',
      'https://images.unsplash.com/photo-1576671414121-d0b01c6c5f60?w=300&h=200&fit=crop'
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
        name, category_id, description || '', parseFloat(price), 
        old_price ? parseFloat(old_price) : null, manufacturer || '', country || '',
        parseInt(stock_quantity) || 0, Boolean(in_stock), Boolean(is_popular), 
        Boolean(is_new), composition || '', indications || '', usage || '', 
        contraindications || '', dosage || '', expiry_date || '', 
        storage_conditions || '', randomImage
      ]
    );

    res.json({
      success: true,
      message: 'Товар успешно добавлен',
      product: rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Регистрация
app.post('/api/auth/register', async (req, res) => {
  const { first_name, last_name, username, email, password, phone } = req.body;
  
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'Логин, email и пароль обязательны' });
  }
  
  try {
    const { rows: existing } = await db.query(
      'SELECT * FROM users WHERE username = $1 OR email = $2', 
      [username, email]
    );
    
    if (existing.length > 0) {
      return res.status(400).json({ error: 'Пользователь уже существует' });
    }
    
    const { rows } = await db.query(
      `INSERT INTO users (first_name, last_name, username, email, password, phone) 
       VALUES ($1, $2, $3, $4, $5, $6) 
       RETURNING id, username, email, first_name, last_name, phone, is_admin`,
      [first_name, last_name, username, email, password, phone]
    );
    
    res.json({
      success: true,
      message: 'Регистрация успешна',
      user: rows[0]
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Вход
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: 'Логин и пароль обязательны' });
  }
  
  try {
    const { rows } = await db.query(
      "SELECT * FROM users WHERE username = $1 OR email = $1", 
      [username]
    );
    
    if (rows.length === 0 || rows[0].password !== password) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    
    const user = rows[0];
    delete user.password;
    
    // Обновляем счетчик входа
    await db.query(
      "UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = $1",
      [user.id]
    );
    
    res.json({
      success: true,
      message: 'Вход выполнен успешно',
      user: user
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Корзина - добавление товара
app.post('/api/cart/add', async (req, res) => {
  const { user_id, product_id, quantity = 1 } = req.body;

  if (!user_id || !product_id) {
    return res.status(400).json({ error: 'user_id и product_id обязательны' });
  }

  try {
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
    res.status(500).json({ error: err.message });
  }
});

// Корзина - получение
app.get('/api/cart', async (req, res) => {
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({ error: 'user_id обязателен' });
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
      items: rows,
      total: rows.reduce((sum, item) => sum + (item.price * item.quantity), 0)
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Корзина - обновление количества
app.put('/api/cart/:itemId', async (req, res) => {
  const { user_id, quantity } = req.body;
  
  if (!user_id || !quantity || quantity < 1) {
    return res.status(400).json({ error: 'user_id и quantity (>=1) обязательны' });
  }

  try {
    await db.query(
      'UPDATE cart_items SET quantity = $1 WHERE id = $2 AND user_id = $3',
      [quantity, req.params.itemId, user_id]
    );

    res.json({ success: true, message: 'Количество обновлено' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Корзина - удаление товара
app.delete('/api/cart/:itemId', async (req, res) => {
  const { user_id } = req.body;
  
  if (!user_id) {
    return res.status(400).json({ error: 'user_id обязателен' });
  }

  try {
    await db.query(
      'DELETE FROM cart_items WHERE id = $1 AND user_id = $2',
      [req.params.itemId, user_id]
    );

    res.json({ success: true, message: 'Товар удален из корзины' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

// Запуск сервера
async function startServer() {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
      console.log(`📍 http://localhost:${PORT}`);
      console.log(`🗄️ База данных: Supabase PostgreSQL`);
      console.log(`\n📋 Все функции доступны:`);
      console.log(`   ✅ Добавление товаров`);
      console.log(`   ✅ Регистрация/вход`);
      console.log(`   ✅ Корзина`);
      console.log(`   ✅ Поиск и фильтрация`);
    });
  } catch (err) {
    console.error('\n❌ Не удалось запустить сервер:', err.message);
    console.error('\n💡 Для исправления:');
    console.error('   1. Зайдите в Vercel → Settings → Environment Variables');
    console.error('   2. Добавьте DATABASE_URL с вашей строкой подключения от Supabase');
    console.error('   3. Передеплойте приложение');
    process.exit(1);
  }
}

startServer();
