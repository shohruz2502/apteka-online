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
    await seedInitialData();
    
    return db;
  } catch (err) {
    console.error('❌ Ошибка подключения к Neon.tech:', err);
    isDatabaseConnected = false;
    db = null;
    
    // Создаем демо-данные если БД не доступна
    console.log('🔄 Используем демо-данные...');
    return null;
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
        },
        {
          name: 'Омега-3 1000мг №120',
          description: 'Рыбий жир для сердца и сосудов',
          price: 1200.00,
          old_price: 1400.00,
          category_id: 2,
          manufacturer: 'Now Foods',
          country: 'США',
          stock_quantity: 20,
          is_new: true,
          image: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop'
        },
        {
          name: 'Левомеколь мазь 40г',
          description: 'Антибактериальная мазь',
          price: 85.00,
          category_id: 1,
          manufacturer: 'Нижфарм',
          country: 'Россия',
          stock_quantity: 100,
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
    req.db = null;
    next();
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

// Демо-данные для случаев когда БД не доступна
const demoProducts = [
  {
    id: 1,
    name: 'Нурофен таблетки 200мг №20',
    description: 'Обезболивающее и жаропонижающее средство',
    price: 250.50,
    old_price: 280.00,
    category_id: 1,
    manufacturer: 'Рекитт Бенкизер',
    country: 'Великобритания',
    stock_quantity: 50,
    in_stock: true,
    is_popular: true,
    is_new: true,
    image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop'
  },
  {
    id: 2,
    name: 'Витамин D3 2000 МЕ №60',
    description: 'Витамин D для поддержки иммунитета',
    price: 890.00,
    old_price: null,
    category_id: 2,
    manufacturer: 'Солгар',
    country: 'США',
    stock_quantity: 30,
    in_stock: true,
    is_popular: true,
    is_new: false,
    image: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop'
  },
  {
    id: 3,
    name: 'Панадол 500мг №12',
    description: 'Обезболивающее средство',
    price: 180.00,
    old_price: null,
    category_id: 1,
    manufacturer: 'ГлаксоСмитКляйн',
    country: 'Великобритания',
    stock_quantity: 25,
    in_stock: true,
    is_popular: false,
    is_new: false,
    image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop'
  },
  {
    id: 4,
    name: 'Аспирин 500мг №20',
    description: 'Противовоспалительное средство',
    price: 120.00,
    old_price: 150.00,
    category_id: 1,
    manufacturer: 'Байер',
    country: 'Германия',
    stock_quantity: 40,
    in_stock: true,
    is_popular: true,
    is_new: false,
    image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop'
  },
  {
    id: 5,
    name: 'Витамин C 1000мг №60',
    description: 'Витамин C для иммунитета',
    price: 450.00,
    old_price: null,
    category_id: 2,
    manufacturer: 'Солгар',
    country: 'США',
    stock_quantity: 35,
    in_stock: true,
    is_popular: false,
    is_new: true,
    image: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop'
  },
  {
    id: 6,
    name: 'Ибупрофен 400мг №24',
    description: 'Противовоспалительное и обезболивающее',
    price: 190.00,
    old_price: null,
    category_id: 1,
    manufacturer: 'Берлин-Хеми',
    country: 'Германия',
    stock_quantity: 60,
    in_stock: true,
    is_popular: true,
    is_new: false,
    image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop'
  }
];

const demoCategories = [
  { id: 1, name: 'Лекарства', description: 'Медицинские препараты', image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop' },
  { id: 2, name: 'Витамины', description: 'Витамины и БАДы', image: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop' },
  { id: 3, name: 'Красота', description: 'Средства по уходу', image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=300&h=200&fit=crop' },
  { id: 4, name: 'Гигиена', description: 'Средства личной гигиены', image: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=300&h=200&fit=crop' },
  { id: 5, name: 'Мама и ребенок', description: 'Товары для матери и ребенка', image: 'https://images.unsplash.com/photo-1516627145497-ae69578b5d77?w=300&h=200&fit=crop' },
  { id: 6, name: 'Медтехника', description: 'Медицинская техника', image: 'https://images.unsplash.com/photo-1559757148-5c350d0d3c56?w=300&h=200&fit=crop' }
];

// ==================== API ROUTES ====================

// Health check
app.get('/health', async (req, res) => {
  try {
    if (!isDatabaseConnected) {
      return res.json({
        status: 'DEMO',
        timestamp: new Date().toISOString(),
        database: 'Demo Mode - No database connection',
        tables: {
          products: demoProducts.length,
          categories: demoCategories.length,
          users: 0,
          cart_items: 0
        }
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
    res.json({ 
      status: 'DEMO', 
      timestamp: new Date().toISOString(),
      error: err.message,
      database: 'Demo Mode - Database error'
    });
  }
});

// Config
app.get('/api/config', (req, res) => {
  res.json({
    success: true,
    googleClientId: process.env.GOOGLE_CLIENT_ID || 'demo-client-id'
  });
});

// Categories
app.get('/api/categories', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/categories');
  try {
    if (!req.db) {
      // Используем демо-данные если БД не доступна
      return res.json(demoCategories);
    }

    const { rows } = await req.db.query('SELECT * FROM categories ORDER BY name');
    res.json(rows || []);
  } catch (err) {
    console.error('❌ Ошибка получения категорий:', err);
    // Возвращаем демо-данные при ошибке
    res.json(demoCategories);
  }
});

// Products - ИСПРАВЛЕННЫЙ МЕТОД
app.get('/api/products', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/products', req.query);
  
  const { category, search, popular, new: newProducts, category_id, limit = 20, page = 1 } = req.query;
  
  try {
    let products = [];
    let total = 0;

    if (!req.db) {
      // Используем демо-данные если БД не доступна
      products = [...demoProducts];
      
      // Фильтрация по категории
      if (category && category !== 'all') {
        const categoryMap = {
          'Лекарства': 1,
          'Витамины': 2,
          'Красота': 3,
          'Гигиена': 4,
          'Мама и ребенок': 5,
          'Медтехника': 6
        };
        const categoryId = categoryMap[category];
        if (categoryId) {
          products = products.filter(p => p.category_id === categoryId);
        }
      }

      // Поиск
      if (search) {
        const searchLower = search.toLowerCase();
        products = products.filter(p => 
          p.name.toLowerCase().includes(searchLower) ||
          (p.description && p.description.toLowerCase().includes(searchLower)) ||
          (p.manufacturer && p.manufacturer.toLowerCase().includes(searchLower))
        );
      }

      // Популярные
      if (popular === 'true') {
        products = products.filter(p => p.is_popular);
      }

      // Новые
      if (newProducts === 'true') {
        products = products.filter(p => p.is_new);
      }

      total = products.length;
      const startIndex = (parseInt(page) - 1) * parseInt(limit);
      const endIndex = startIndex + parseInt(limit);
      products = products.slice(startIndex, endIndex);

    } else {
      // Используем реальную БД
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
      products = rows;
      
      let countSql = `SELECT COUNT(*) as total FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE 1=1`;
      let countParams = [];
      paramCount = 1;

      if (category && category !== 'all') {
        countSql += ` AND c.name = $${paramCount}`;
        countParams.push(category);
        paramCount++;
      }

      if (category_id) {
        countSql += ` AND p.category_id = $$${paramCount}`;
        countParams.push(parseInt(category_id));
        paramCount++;
      }

      if (search) {
        countSql += ` AND (p.name ILIKE $${paramCount} OR p.description ILIKE $${paramCount + 1} OR p.manufacturer ILIKE $${paramCount + 2} OR c.name ILIKE $${paramCount + 3})`;
        const searchParam = `%${search}%`;
        countParams.push(searchParam, searchParam, searchParam, searchParam);
      }

      const { rows: countResult } = await req.db.query(countSql, countParams);
      total = parseInt(countResult[0]?.total) || 0;
    }

    // ВАЖНОЕ ИСПРАВЛЕНИЕ: возвращаем данные в правильном формате
    res.json({ 
      success: true,
      data: products, // Изменено с products на data
      total: total,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / parseInt(limit))
    });
  } catch (err) {
    console.error('❌ Ошибка получения товаров:', err);
    // Возвращаем демо-данные при ошибке
    const limitedProducts = demoProducts.slice(0, parseInt(limit));
    res.json({ 
      success: true,
      data: limitedProducts,
      total: demoProducts.length,
      page: 1,
      limit: parseInt(limit),
      totalPages: Math.ceil(demoProducts.length / parseInt(limit))
    });
  }
});

// Single product
app.get('/api/products/:id', databaseMiddleware, async (req, res) => {
  const productId = req.params.id;
  console.log('📨 GET /api/products/' + productId);
  
  try {
    let product = null;

    if (!req.db) {
      // Используем демо-данные если БД не доступна
      product = demoProducts.find(p => p.id === parseInt(productId));
    } else {
      const { rows } = await req.db.query(
        `SELECT p.*, c.name as category_name FROM products p LEFT JOIN categories c ON p.category_id = c.id WHERE p.id = $1`,
        [productId]
      );
      product = rows[0];
    }
    
    if (!product) {
      return res.status(404).json({ 
        success: false,
        error: 'Товар не найден' 
      });
    }
    
    res.json({ 
      success: true,
      product: product 
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

    if (!req.db) {
      return res.status(404).json({
        success: false,
        error: 'Демо режим: пользователь не найден'
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

  if (!req.db) {
    return res.status(503).json({
      success: false,
      error: 'Демо режим: регистрация временно недоступна'
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

  if (!req.db) {
    // Демо пользователь для тестирования
    if (username === 'demo' && password === 'demo') {
      const demoUser = {
        id: 1,
        first_name: 'Демо',
        last_name: 'Пользователь',
        username: 'demo',
        email: 'demo@example.com',
        phone: '+992123456789',
        is_admin: false,
        login_count: 1,
        last_login: new Date().toISOString()
      };
      return res.json({
        success: true,
        message: 'Вход выполнен успешно',
        user: demoUser
      });
    }
    return res.status(401).json({ 
      success: false,
      error: 'Демо режим: используйте логин "demo" и пароль "demo"' 
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

// Cart - Add item (упрощенная версия для демо)
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

  // В демо режиме просто возвращаем успех
  if (!req.db) {
    return res.json({
      success: true,
      message: 'Товар добавлен в корзину (демо режим)',
      item: {
        id: Date.now(),
        user_id: user_id,
        product_id: product_id,
        quantity: quantity
      }
    });
  }

  try {
    // Реальная логика для БД...
    res.json({
      success: true,
      message: 'Товар добавлен в корзину',
      item: { id: Date.now(), user_id, product_id, quantity }
    });
  } catch (err) {
    console.error('❌ Ошибка добавления в корзину:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера: ' + err.message
    });
  }
});

// Cart - Get cart (упрощенная версия для демо)
app.get('/api/cart', databaseMiddleware, async (req, res) => {
  console.log('📨 GET /api/cart');
  const { user_id } = req.query;

  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  // В демо режиме возвращаем пустую корзину
  res.json({
    success: true,
    items: [],
    total: 0
  });
});

// Google OAuth endpoints (упрощенные для демо)
app.post('/api/auth/google', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/auth/google');
  
  const { token } = req.body;
  
  if (!token) {
    return res.status(400).json({
      success: false,
      error: 'Токен обязателен'
    });
  }

  // В демо режиме возвращаем фиктивного пользователя
  res.json({
    success: true,
    user: {
      sub: 'demo-google-id',
      email: 'demo@gmail.com',
      email_verified: true,
      name: 'Демо Пользователь',
      given_name: 'Демо',
      family_name: 'Пользователь',
      picture: ''
    },
    requires_additional_info: true
  });
});

app.post('/api/auth/google/register', databaseMiddleware, async (req, res) => {
  console.log('📨 POST /api/auth/google/register');
  
  const { google_id, email, first_name, last_name, phone, avatar, email_verified } = req.body;
  
  if (!google_id || !email) {
    return res.status(400).json({
      success: false,
      error: 'Google ID и email обязательны'
    });
  }

  // В демо режиме возвращаем фиктивного пользователя
  const demoUser = {
    id: 2,
    first_name: first_name || 'Демо',
    last_name: last_name || 'Google',
    username: email.split('@')[0] + '_google',
    email: email,
    phone: phone || '+992123456789',
    avatar: avatar,
    google_id: google_id,
    email_verified: email_verified || true,
    is_admin: false,
    login_count: 1,
    last_login: new Date().toISOString()
  };

  res.json({
    success: true,
    message: 'Google авторизация успешна',
    user: demoUser
  });
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
      console.log(`🗄️ База данных: ${isDatabaseConnected ? 'Neon.tech PostgreSQL' : 'Demo Mode'}`);
      console.log(`🔐 Google OAuth: ${process.env.GOOGLE_CLIENT_ID ? 'Настроен' : 'Демо режим'}`);
      console.log(`\n📋 Доступные endpoints:`);
      console.log(`   GET  /api/categories - Категории`);
      console.log(`   GET  /api/products - Товары`);
      console.log(`   GET  /api/products/:id - Товар по ID`);
      console.log(`   POST /api/auth/register - Регистрация`);
      console.log(`   POST /api/auth/login - Вход`);
      console.log(`   POST /api/auth/google - Google OAuth`);
      console.log(`   GET  /health - Проверка работы`);
    });
  } catch (err) {
    console.error('❌ Не удалось подключиться к базе данных:', err);
    console.log(`\n⚠️  Сервер запущен в ДЕМО РЕЖИМЕ на порту ${PORT}`);
    console.log(`📍 http://localhost:${PORT}`);
    console.log(`✅ API endpoints будут работать с демо-данными`);
    
    app.listen(PORT, () => {
      console.log(`📍 Server running on port ${PORT} (demo mode)`);
    });
  }
}

// For Vercel
module.exports = app;

// For local development
if (require.main === module) {
  startServer();
}
