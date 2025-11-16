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

// Упрощенная инициализация базы данных
async function initializeDatabase() {
  try {
    console.log('🔄 Попытка подключения к Supabase...');
    
    if (!process.env.DATABASE_URL) {
      console.error('❌ DATABASE_URL не установлен');
      // Создаем простой mock для тестирования
      db = createMockDB();
      return db;
    }
    
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false }
    });
    
    await client.connect();
    db = client;
    console.log('✅ Успешное подключение к Supabase');
    
    // Пытаемся создать таблицы
    try {
      await createTables();
      console.log('✅ Таблицы созданы/проверены');
    } catch (tableErr) {
      console.log('⚠️ Ошибка создания таблиц, но продолжаем работу:', tableErr.message);
    }
    
    return db;
  } catch (err) {
    console.error('❌ Ошибка подключения к Supabase:', err.message);
    console.log('🔄 Используем mock данные для демонстрации...');
    db = createMockDB();
    return db;
  }
}

// Mock база данных для демонстрации
function createMockDB() {
  console.log('📝 Создаем mock базу данных...');
  
  const mockData = {
    categories: [
      { id: 1, name: 'Лекарства', description: 'Медицинские препараты', image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop' },
      { id: 2, name: 'Витамины', description: 'Витамины и БАДы', image: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop' },
      { id: 3, name: 'Красота', description: 'Средства по уходу', image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=300&h=200&fit=crop' },
      { id: 4, name: 'Гигиена', description: 'Средства личной гигиены', image: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=300&h=200&fit=crop' }
    ],
    products: [
      {
        id: 1, name: 'Нурофен таблетки 200мг №20', description: 'Обезболивающее и жаропонижающее средство',
        price: 250.50, old_price: 280.00, image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop',
        category_id: 1, category_name: 'Лекарства', manufacturer: 'Рекитт Бенкизер', country: 'Великобритания',
        stock_quantity: 50, in_stock: true, is_popular: true, is_new: false, composition: 'Ибупрофен 200 мг'
      },
      {
        id: 2, name: 'Витамин C 1000мг', description: 'Витамин C в таблетках для иммунитета',
        price: 450.00, old_price: 520.00, image: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop',
        category_id: 2, category_name: 'Витамины', manufacturer: 'Solgar', country: 'США',
        stock_quantity: 30, in_stock: true, is_popular: true, is_new: true, composition: 'Аскорбиновая кислота 1000 мг'
      }
    ],
    users: [
      {
        id: 1, first_name: 'Админ', last_name: 'Админов', username: 'admin', email: 'admin@example.com',
        password: 'admin123', phone: '+992 123456789', is_admin: true, login_count: 1
      },
      {
        id: 2, first_name: 'Иван', last_name: 'Иванов', username: 'ivan', email: 'ivan@example.com',
        password: 'password123', phone: '+992 987654321', is_admin: false, login_count: 0
      }
    ],
    cart_items: []
  };

  return {
    query: (sql, params = []) => {
      console.log('📝 Mock DB Query:', sql.substring(0, 100) + '...');
      
      // Имитация запросов
      if (sql.includes('SELECT') && sql.includes('categories')) {
        return { rows: mockData.categories };
      }
      
      if (sql.includes('SELECT') && sql.includes('products')) {
        if (sql.includes('WHERE p.id =')) {
          const id = params[0];
          return { rows: mockData.products.filter(p => p.id == id) };
        }
        return { rows: mockData.products };
      }
      
      if (sql.includes('SELECT') && sql.includes('users')) {
        if (sql.includes('username =') || sql.includes('email =')) {
          const username = params[0];
          return { rows: mockData.users.filter(u => u.username === username || u.email === username) };
        }
        if (sql.includes('id =')) {
          const id = params[0];
          return { rows: mockData.users.filter(u => u.id == id) };
        }
        return { rows: mockData.users };
      }
      
      if (sql.includes('INSERT INTO users')) {
        const newUser = {
          id: Math.max(...mockData.users.map(u => u.id)) + 1,
          first_name: params[0], last_name: params[1], username: params[2],
          email: params[3], password: params[4], phone: params[5],
          is_admin: false, login_count: 0
        };
        mockData.users.push(newUser);
        return { rows: [newUser] };
      }
      
      // Для остальных запросов возвращаем пустой результат
      return { rows: [] };
    }
  };
}

// Создание таблиц (для реальной базы)
async function createTables() {
  // Пропускаем создание таблиц для mock базы
  if (!db.query.toString().includes('Mock DB Query')) {
    const tables = [
      `CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY, name VARCHAR(100) NOT NULL,
        description TEXT, image VARCHAR(500),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY, name VARCHAR(255) NOT NULL,
        description TEXT, price DECIMAL(10,2) NOT NULL,
        old_price DECIMAL(10,2), image VARCHAR(500),
        category_id INTEGER, manufacturer VARCHAR(100),
        country VARCHAR(50), stock_quantity INTEGER DEFAULT 0,
        in_stock BOOLEAN DEFAULT true, is_popular BOOLEAN DEFAULT false,
        is_new BOOLEAN DEFAULT true, composition TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`,
      `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY, first_name VARCHAR(50), last_name VARCHAR(50),
        username VARCHAR(50) UNIQUE NOT NULL, email VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL, phone VARCHAR(20), is_admin BOOLEAN DEFAULT false,
        login_count INTEGER DEFAULT 0, created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`
    ];
    
    for (const tableSql of tables) {
      await db.query(tableSql);
    }
  }
}

// ==================== API ROUTES ====================

// Health check
app.get('/health', async (req, res) => {
  try {
    const isRealDB = !db.query.toString().includes('Mock DB Query');
    
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      database: {
        type: isRealDB ? 'Supabase PostgreSQL' : 'Mock Data',
        connected: true,
        url_configured: !!process.env.DATABASE_URL
      },
      message: isRealDB ? 'Подключено к Supabase' : 'Используются демо-данные'
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
    res.json(rows || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Товары
app.get('/api/products', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM products ORDER BY created_at DESC');
    res.json({ 
      success: true,
      products: rows || [],
      total: rows?.length || 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Получение одного товара
app.get('/api/products/:id', async (req, res) => {
  try {
    const { rows } = await db.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Товар не найден' });
    }
    res.json({ success: true, product: rows[0] });
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
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, username, email, first_name, last_name`,
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
    
    res.json({
      success: true,
      message: 'Вход выполнен успешно',
      user: user
    });
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

// Запуск сервера
async function startServer() {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
      console.log(`📍 http://localhost:${PORT}`);
      console.log(`🗄️ База данных: ${db.query.toString().includes('Mock DB Query') ? 'Mock Data' : 'Supabase PostgreSQL'}`);
      console.log(`\n📋 Доступные endpoints:`);
      console.log(`   GET  /health - Проверка работы`);
      console.log(`   GET  /api/categories - Категории`);
      console.log(`   GET  /api/products - Товары`);
      console.log(`   POST /api/auth/register - Регистрация`);
      console.log(`   POST /api/auth/login - Вход`);
    });
  } catch (err) {
    console.error('❌ Не удалось запустить сервер:', err);
    process.exit(1);
  }
}

startServer();
