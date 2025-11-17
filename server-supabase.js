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
let isConnected = false;

// Простая функция для создания временной базы данных
function createSimpleDB() {
  console.log('📝 Создаем временную базу данных в памяти...');
  
  const data = {
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
      },
      {
        id: 3, name: 'Панадол 500мг №12', description: 'Обезболивающее средство',
        price: 180.00, old_price: null, image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop',
        category_id: 1, category_name: 'Лекарства', manufacturer: 'ГлаксоСмитКляйн', country: 'Великобритания',
        stock_quantity: 25, in_stock: true, is_popular: false, is_new: true, composition: 'Парацетамол 500 мг'
      }
    ],
    users: [
      {
        id: 1, first_name: 'Админ', last_name: 'Админов', username: 'admin', email: 'admin@example.com',
        password: 'admin123', phone: '+992 123456789', is_admin: true, login_count: 1, avatar: null
      },
      {
        id: 2, first_name: 'Иван', last_name: 'Иванов', username: 'ivan', email: 'ivan@example.com',
        password: 'password123', phone: '+992 987654321', is_admin: false, login_count: 0, avatar: null
      }
    ],
    cart_items: [],
    nextId: { products: 4, users: 3, categories: 5, cart_items: 1 }
  };

  return {
    query: (sql, params = []) => {
      console.log('📝 Simple DB Query:', sql.substring(0, 100) + '...');
      
      // SELECT categories
      if (sql.includes('SELECT') && sql.includes('categories')) {
        if (sql.includes('WHERE id =')) {
          const id = params[0];
          return { rows: data.categories.filter(c => c.id == id) };
        }
        return { rows: data.categories };
      }
      
      // SELECT products
      if (sql.includes('SELECT') && sql.includes('products')) {
        if (sql.includes('WHERE p.id =') || sql.includes('WHERE id =')) {
          const id = params[0];
          const product = data.products.find(p => p.id == id);
          return { rows: product ? [product] : [] };
        }
        
        if (sql.includes('COUNT(*)')) {
          return { rows: [{ count: data.products.length, total: data.products.length }] };
        }
        
        if (sql.includes('c.name =')) {
          const categoryName = params[0];
          const filtered = data.products.filter(p => {
            const category = data.categories.find(c => c.id == p.category_id);
            return category?.name === categoryName;
          });
          return { rows: filtered };
        }
        
        if (sql.includes('p.category_id =')) {
          const categoryId = params[0];
          const filtered = data.products.filter(p => p.category_id == categoryId);
          return { rows: filtered };
        }
        
        if (sql.includes('ILIKE')) {
          const searchTerm = params[0].replace(/%/g, '').toLowerCase();
          const filtered = data.products.filter(p => 
            p.name.toLowerCase().includes(searchTerm) ||
            p.description.toLowerCase().includes(searchTerm) ||
            p.manufacturer.toLowerCase().includes(searchTerm)
          );
          return { rows: filtered };
        }
        
        return { rows: data.products };
      }
      
      // SELECT users
      if (sql.includes('SELECT') && sql.includes('users')) {
        if (sql.includes('username =') || sql.includes('email =')) {
          const username = params[0];
          const user = data.users.find(u => u.username === username || u.email === username);
          return { rows: user ? [user] : [] };
        }
        
        if (sql.includes('id =')) {
          const id = params[0];
          const user = data.users.find(u => u.id == id);
          return { rows: user ? [user] : [] };
        }
        
        return { rows: data.users };
      }
      
      // INSERT users (регистрация)
      if (sql.includes('INSERT INTO users')) {
        const newUser = {
          id: data.nextId.users++,
          first_name: params[0] || '',
          last_name: params[1] || '',
          username: params[2],
          email: params[3],
          password: params[4],
          phone: params[5] || '',
          is_admin: false,
          login_count: 0,
          avatar: null,
          created_at: new Date()
        };
        data.users.push(newUser);
        return { rows: [newUser] };
      }
      
      // UPDATE users (логин)
      if (sql.includes('UPDATE users SET last_login')) {
        const userId = params[0];
        const user = data.users.find(u => u.id == userId);
        if (user) {
          user.login_count = (user.login_count || 0) + 1;
          user.last_login = new Date();
        }
        return { rows: [] };
      }
      
      // INSERT products (добавление товара)
      if (sql.includes('INSERT INTO products')) {
        const newProduct = {
          id: data.nextId.products++,
          name: params[0],
          category_id: params[1],
          description: params[2] || '',
          price: parseFloat(params[3]),
          old_price: params[4] ? parseFloat(params[4]) : null,
          manufacturer: params[5] || '',
          country: params[6] || '',
          stock_quantity: parseInt(params[7]) || 0,
          in_stock: Boolean(params[8]),
          is_popular: Boolean(params[9]),
          is_new: Boolean(params[10]),
          composition: params[11] || '',
          indications: params[12] || '',
          usage: params[13] || '',
          contraindications: params[14] || '',
          dosage: params[15] || '',
          expiry_date: params[16] || '',
          storage_conditions: params[17] || '',
          image: params[18] || 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop',
          category_name: data.categories.find(c => c.id == params[1])?.name || 'Категория',
          created_at: new Date()
        };
        data.products.push(newProduct);
        return { rows: [newProduct] };
      }
      
      // Корзина - добавление
      if (sql.includes('INSERT INTO cart_items')) {
        const userId = params[0];
        const productId = params[1];
        const quantity = params[2] || 1;
        
        const existingItem = data.cart_items.find(item => 
          item.user_id == userId && item.product_id == productId
        );
        
        if (existingItem) {
          existingItem.quantity += quantity;
          return { rows: [existingItem] };
        } else {
          const newItem = {
            id: data.nextId.cart_items++,
            user_id: userId,
            product_id: productId,
            quantity: quantity,
            created_at: new Date()
          };
          data.cart_items.push(newItem);
          return { rows: [newItem] };
        }
      }
      
      // Корзина - получение
      if (sql.includes('cart_items') && sql.includes('products') && sql.includes('LEFT JOIN')) {
        const userId = params[0];
        const userCart = data.cart_items
          .filter(item => item.user_id == userId)
          .map(item => {
            const product = data.products.find(p => p.id == item.product_id);
            return {
              ...item,
              name: product?.name,
              price: product?.price,
              image: product?.image,
              description: product?.description,
              manufacturer: product?.manufacturer,
              in_stock: product?.in_stock
            };
          });
        return { rows: userCart };
      }
      
      // Корзина - обновление
      if (sql.includes('UPDATE cart_items SET quantity =')) {
        const quantity = params[0];
        const itemId = params[1];
        const userId = params[2];
        
        const item = data.cart_items.find(i => i.id == itemId && i.user_id == userId);
        if (item) {
          item.quantity = quantity;
        }
        return { rows: [] };
      }
      
      // Корзина - удаление
      if (sql.includes('DELETE FROM cart_items')) {
        const itemId = params[0];
        const userId = params[1];
        
        data.cart_items = data.cart_items.filter(item => 
          !(item.id == itemId && item.user_id == userId)
        );
        return { rows: [] };
      }
      
      return { rows: [] };
    }
  };
}

// Инициализация базы данных
async function initializeDatabase() {
  try {
    console.log('🔄 Попытка подключения к Supabase...');
    
    if (!process.env.DATABASE_URL) {
      console.log('❌ DATABASE_URL не установлен, используем временную базу');
      db = createSimpleDB();
      return db;
    }
    
    console.log('📡 DATABASE_URL установлен, подключаемся...');
    
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 10000,
      query_timeout: 10000
    });
    
    await client.connect();
    db = client;
    isConnected = true;
    console.log('✅ Успешное подключение к Supabase!');
    
    return db;
  } catch (err) {
    console.error('❌ Ошибка подключения к Supabase:', err.message);
    console.log('🔄 Используем временную базу данных...');
    db = createSimpleDB();
    return db;
  }
}

// ==================== API ROUTES ====================

// Health check
app.get('/health', async (req, res) => {
  try {
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      database: isConnected ? 'Supabase PostgreSQL' : 'Временная база (в памяти)',
      message: isConnected ? 'Подключено к Supabase' : 'Используются временные данные',
      environment: {
        DATABASE_URL: process.env.DATABASE_URL ? 'установлен' : 'не установлен',
        node_version: process.version
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

// Товары
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
      console.log(`🗄️ База данных: ${isConnected ? 'Supabase PostgreSQL' : 'Временная база (в памяти)'}`);
      console.log(`\n📋 Все функции доступны:`);
      console.log(`   ✅ Добавление товаров`);
      console.log(`   ✅ Регистрация/вход`);
      console.log(`   ✅ Корзина`);
      console.log(`   ✅ Поиск и фильтрация`);
      console.log(`\n💡 Проверьте работу: https://apteka-online.vercel.app/health`);
    });
  } catch (err) {
    console.error('\n❌ Не удалось запустить сервер:', err.message);
    process.exit(1);
  }
}

startServer();
