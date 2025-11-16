const __dirname = path.resolve();
const express = require('express');
const { Client } = require('pg');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Supabase PostgreSQL подключение
const client = new Client({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/pharmacy',
  ssl: { rejectUnauthorized: false }
});

let db;

async function initializeDatabase() {
  try {
    console.log('🔄 Подключение к Supabase PostgreSQL...');
    await client.connect();
    db = client;
    console.log('✅ Успешное подключение к Supabase');
    
    // Создаем таблицы если их нет
    await createTables();
    
    console.log('✅ База данных готова к работе');
    return db;
  } catch (err) {
    console.error('❌ Ошибка подключения к Supabase:', err);
    console.log('🔄 Создаем in-memory хранилище для демонстрации...');
    db = createMemoryDB();
    return db;
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

    // Добавляем тестовые данные если таблицы пустые
    await addSampleData();
    
  } catch (err) {
    console.error('❌ Ошибка создания таблиц:', err);
  }
}

// Добавление тестовых данных
async function addSampleData() {
  try {
    // Проверяем есть ли категории
    const { rows: existingCategories } = await db.query('SELECT COUNT(*) as count FROM categories');
    if (parseInt(existingCategories[0].count) === 0) {
      // Добавляем категории
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
      // Добавляем продукты
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

// In-memory хранилище для демонстрации
function createMemoryDB() {
  const memoryDB = {
    data: {
      categories: [
        { id: 1, name: 'Лекарства', description: 'Медицинские препараты', image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop' },
        { id: 2, name: 'Витамины', description: 'Витамины и БАДы', image: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop' },
        { id: 3, name: 'Красота', description: 'Средства по уходу', image: 'https://images.unsplash.com/photo-1596462502278-27bfdc403348?w=300&h=200&fit=crop' },
        { id: 4, name: 'Гигиена', description: 'Средства личной гигиены', image: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=300&h=200&fit=crop' }
      ],
      products: [
        {
          id: 1,
          name: 'Нурофен таблетки 200мг №20',
          description: 'Обезболивающее и жаропонижающее средство',
          price: 250.50,
          old_price: 280.00,
          image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop',
          category_id: 1,
          category_name: 'Лекарства',
          manufacturer: 'Рекитт Бенкизер',
          country: 'Великобритания',
          stock_quantity: 50,
          in_stock: true,
          is_popular: true,
          is_new: false,
          composition: 'Ибупрофен 200 мг',
          indications: 'Головная боль, зубная боль, мигрень',
          usage: 'По 1 таблетке 3-4 раза в день',
          contraindications: 'Язвенная болезнь, беременность'
        },
        {
          id: 2,
          name: 'Витамин C 1000мг',
          description: 'Витамин C в таблетках для иммунитета',
          price: 450.00,
          old_price: 520.00,
          image: 'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop',
          category_id: 2,
          category_name: 'Витамины',
          manufacturer: 'Solgar',
          country: 'США',
          stock_quantity: 30,
          in_stock: true,
          is_popular: true,
          is_new: true,
          composition: 'Аскорбиновая кислота 1000 мг'
        },
        {
          id: 3,
          name: 'Панадол 500мг №12',
          description: 'Обезболивающее средство',
          price: 180.00,
          old_price: null,
          image: 'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop',
          category_id: 1,
          category_name: 'Лекарства',
          manufacturer: 'ГлаксоСмитКляйн',
          country: 'Великобритания',
          stock_quantity: 25,
          in_stock: true,
          is_popular: false,
          is_new: true,
          composition: 'Парацетамол 500 мг'
        }
      ],
      users: [
        {
          id: 1,
          first_name: 'Админ',
          last_name: 'Админов',
          username: 'admin',
          email: 'admin@example.com',
          password: 'admin123',
          phone: '+992 123456789',
          is_admin: true,
          login_count: 1,
          created_at: new Date()
        },
        {
          id: 2,
          first_name: 'Иван',
          last_name: 'Иванов',
          username: 'ivan',
          email: 'ivan@example.com',
          password: 'password123',
          phone: '+992 987654321',
          is_admin: false,
          login_count: 0,
          created_at: new Date()
        }
      ],
      cart_items: [
        {
          id: 1,
          user_id: 2,
          product_id: 1,
          quantity: 2,
          created_at: new Date()
        },
        {
          id: 2,
          user_id: 2,
          product_id: 2,
          quantity: 1,
          created_at: new Date()
        }
      ]
    },
    query: function(sql, params = []) {
      console.log('📝 Memory DB Query:', sql, params);
      
      // Простая имитация SQL запросов
      if (sql.includes('SELECT') && sql.includes('categories')) {
        if (sql.includes('WHERE id =')) {
          const id = params[0];
          const category = this.data.categories.find(c => c.id == id);
          return { rows: category ? [category] : [] };
        }
        return { rows: this.data.categories };
      }
      
      if (sql.includes('SELECT') && sql.includes('products')) {
        if (sql.includes('WHERE p.id =')) {
          const id = params[0];
          const product = this.data.products.find(p => p.id == id);
          return { rows: product ? [product] : [] };
        }
        
        if (sql.includes('COUNT(*)')) {
          return { rows: [{ total: this.data.products.length }] };
        }
        
        // Фильтрация по категории
        if (sql.includes('c.name =')) {
          const categoryName = params[0];
          const filteredProducts = this.data.products.filter(p => 
            p.category_name === categoryName
          );
          return { rows: filteredProducts };
        }

        if (sql.includes('p.category_id =')) {
          const categoryId = params[0];
          const filteredProducts = this.data.products.filter(p => 
            p.category_id == categoryId
          );
          return { rows: filteredProducts };
        }
        
        // Поиск
        if (sql.includes('ILIKE')) {
          const searchParam = params[0].replace(/%/g, '');
          const filteredProducts = this.data.products.filter(p => 
            p.name.toLowerCase().includes(searchParam.toLowerCase()) ||
            p.description.toLowerCase().includes(searchParam.toLowerCase()) ||
            p.manufacturer.toLowerCase().includes(searchParam.toLowerCase())
          );
          return { rows: filteredProducts };
        }
        
        return { rows: this.data.products };
      }
      
      if (sql.includes('INSERT INTO users')) {
        const newId = Math.max(0, ...this.data.users.map(u => u.id)) + 1;
        const newUser = {
          id: newId,
          first_name: params[0],
          last_name: params[1],
          username: params[2],
          email: params[3],
          password: params[4],
          phone: params[5],
          login_count: params[6],
          is_admin: false,
          created_at: new Date()
        };
        this.data.users.push(newUser);
        return { rows: [newUser] };
      }
      
      if (sql.includes('SELECT * FROM users WHERE username =') || sql.includes('SELECT * FROM users WHERE email =')) {
        const username = params[0];
        const user = this.data.users.find(u => u.username === username || u.email === username);
        return { rows: user ? [user] : [] };
      }

      if (sql.includes('SELECT * FROM users WHERE id =')) {
        const id = params[0];
        const user = this.data.users.find(u => u.id == id);
        return { rows: user ? [user] : [] };
      }
      
      if (sql.includes('UPDATE users SET')) {
        if (sql.includes('avatar')) {
          const avatar = params[0];
          const id = params[1];
          const user = this.data.users.find(u => u.id == id);
          if (user) {
            user.avatar = avatar;
          }
        } else if (sql.includes('first_name')) {
          const firstName = params[0];
          const lastName = params[1];
          const middleName = params[2];
          const phone = params[3];
          const id = params[4];
          const user = this.data.users.find(u => u.id == id);
          if (user) {
            user.first_name = firstName;
            user.last_name = lastName;
            user.middle_name = middleName;
            user.phone = phone;
          }
        } else if (sql.includes('last_login')) {
          // Просто обновляем счетчик входа
          const id = params[1];
          const user = this.data.users.find(u => u.id == id);
          if (user) {
            user.login_count = (user.login_count || 0) + 1;
            user.last_login = new Date();
          }
        }
        return { rows: [] };
      }

      // INSERT INTO products
      if (sql.includes('INSERT INTO products')) {
        const newId = Math.max(0, ...this.data.products.map(p => p.id)) + 1;
        const demoImages = [
          'https://images.unsplash.com/photo-1585435557343-3b092031d5ad?w=300&h=200&fit=crop',
          'https://images.unsplash.com/photo-1550258987-190a2d41a8ba?w=300&h=200&fit=crop',
          'https://images.unsplash.com/photo-1576671414121-d0b01c6c5f60?w=300&h=200&fit=crop',
          'https://images.unsplash.com/photo-1559056199-641a0ac8b55e?w=300&h=200&fit=crop'
        ];
        const randomImage = demoImages[Math.floor(Math.random() * demoImages.length)];

        const newProduct = {
          id: newId,
          name: params[0],
          category_id: params[1],
          description: params[2],
          price: parseFloat(params[3]),
          old_price: params[4] ? parseFloat(params[4]) : null,
          manufacturer: params[5],
          country: params[6],
          stock_quantity: parseInt(params[7]),
          in_stock: Boolean(params[8]),
          is_popular: Boolean(params[9]),
          is_new: Boolean(params[10]),
          composition: params[11],
          indications: params[12],
          usage: params[13],
          contraindications: params[14],
          dosage: params[15],
          expiry_date: params[16],
          storage_conditions: params[17],
          image: randomImage,
          category_name: this.data.categories.find(c => c.id == params[1])?.name || 'Категория',
          created_at: new Date()
        };
        this.data.products.push(newProduct);
        return { rows: [newProduct] };
      }

      // Корзина - получение товаров корзины с информацией о продуктах
      if (sql.includes('cart_items') && sql.includes('products') && sql.includes('LEFT JOIN')) {
        const userId = params[0];
        const userCart = this.data.cart_items
          .filter(item => item.user_id == userId)
          .map(item => {
            const product = this.data.products.find(p => p.id == item.product_id);
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

      // Корзина - добавление товара
      if (sql.includes('INSERT INTO cart_items')) {
        const userId = params[0];
        const productId = params[1];
        const quantity = params[2] || 1;

        // Проверяем есть ли уже такой товар в корзине
        const existingItem = this.data.cart_items.find(
          item => item.user_id == userId && item.product_id == productId
        );

        if (existingItem) {
          // Обновляем количество
          existingItem.quantity += quantity;
          return { rows: [existingItem] };
        } else {
          // Добавляем новый товар
          const newId = Math.max(0, ...this.data.cart_items.map(i => i.id)) + 1;
          const newItem = {
            id: newId,
            user_id: userId,
            product_id: productId,
            quantity: quantity,
            created_at: new Date()
          };
          this.data.cart_items.push(newItem);
          return { rows: [newItem] };
        }
      }

      // Корзина - обновление количества
      if (sql.includes('UPDATE cart_items SET quantity =')) {
        const quantity = params[0];
        const itemId = params[1];
        const userId = params[2];
        
        const item = this.data.cart_items.find(i => i.id == itemId && i.user_id == userId);
        if (item) {
          item.quantity = quantity;
        }
        return { rows: [] };
      }

      // Корзина - удаление товара
      if (sql.includes('DELETE FROM cart_items')) {
        const itemId = params[0];
        const userId = params[1];
        
        this.data.cart_items = this.data.cart_items.filter(
          item => !(item.id == itemId && item.user_id == userId)
        );
        return { rows: [] };
      }

      // Корзина - получение общей суммы
      if (sql.includes('SUM(p.price * ci.quantity)')) {
        const userId = params[0];
        const userCart = this.data.cart_items.filter(item => item.user_id == userId);
        let total = 0;
        
        userCart.forEach(item => {
          const product = this.data.products.find(p => p.id == item.product_id);
          if (product) {
            total += product.price * item.quantity;
          }
        });
        
        return { rows: [{ total: total }] };
      }
      
      return { rows: [] };
    }
  };
  
  return memoryDB;
}

// ==================== API ROUTES ====================

// Получение текущего пользователя
app.get('/api/auth/me', async (req, res) => {
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
app.put('/api/user/update-profile', async (req, res) => {
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
app.post('/api/user/change-password', async (req, res) => {
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
    
    if (user.password !== current_password) {
      return res.status(400).json({
        success: false,
        error: 'Текущий пароль неверен'
      });
    }

    await db.query('UPDATE users SET password = $1 WHERE id = $2', [new_password, user_id]);

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
app.post('/api/user/upload-avatar', async (req, res) => {
  console.log('📨 POST /api/user/upload-avatar');
  
  const { user_id, avatar } = req.body;
  
  if (!user_id) {
    return res.status(400).json({ 
      success: false, 
      error: 'ID пользователя обязателен' 
    });
  }

  try {
    const avatarUrl = avatar;

    await db.query(
      'UPDATE users SET avatar = $1 WHERE id = $2',
      [avatarUrl, user_id]
    );

    res.json({
      success: true,
      message: 'Аватар успешно загружен',
      avatar_url: avatarUrl
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
app.get('/api/categories', async (req, res) => {
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
app.get('/api/products', async (req, res) => {
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
app.get('/api/products/:id', async (req, res) => {
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

// Добавление товара через админку
app.post('/api/admin/products', async (req, res) => {
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

// Регистрация
app.post('/api/auth/register', async (req, res) => {
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
    
    const { rows } = await db.query(
      `INSERT INTO users (first_name, last_name, username, email, password, phone, login_count) 
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [first_name, last_name, username, email, password, phone, 0]
    );
    
    const newUser = rows[0];
    
    res.json({
      success: true,
      message: 'Регистрация успешна',
      user: {
        id: newUser.id,
        first_name: newUser.first_name,
        last_name: newUser.last_name,
        username: newUser.username,
        email: newUser.email,
        phone: newUser.phone,
        is_admin: newUser.is_admin
      }
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
app.post('/api/auth/login', async (req, res) => {
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
    
    if (user.password !== password) {
      return res.status(401).json({ 
        success: false,
        error: 'Неверный пароль' 
      });
    }
    
    await db.query(
      "UPDATE users SET last_login = CURRENT_TIMESTAMP, login_count = login_count + 1 WHERE id = $1",
      [user.id]
    );
    
    res.json({
      success: true,
      message: 'Вход выполнен успешно',
      user: {
        id: user.id,
        first_name: user.first_name,
        last_name: user.last_name,
        username: user.username,
        email: user.email,
        phone: user.phone,
        is_admin: user.is_admin
      }
    });
  } catch (err) {
    console.error('❌ Ошибка входа:', err);
    res.status(500).json({ 
      success: false,
      error: 'Ошибка сервера' 
    });
  }
});

// ==================== КОРЗИНА ====================

// Корзина - добавление товара
app.post('/api/cart/add', async (req, res) => {
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
app.get('/api/cart', async (req, res) => {
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
app.put('/api/cart/:itemId', async (req, res) => {
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
app.delete('/api/cart/:itemId', async (req, res) => {
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

// Корзина - получение общей суммы
app.get('/api/cart/total', async (req, res) => {
  console.log('📨 GET /api/cart/total');
  const { user_id } = req.query;
  
  if (!user_id) {
    return res.status(400).json({
      success: false,
      error: 'user_id обязателен'
    });
  }

  try {
    const { rows } = await db.query(`
      SELECT SUM(p.price * ci.quantity) as total
      FROM cart_items ci
      LEFT JOIN products p ON ci.product_id = p.id
      WHERE ci.user_id = $1
    `, [user_id]);

    const total = parseFloat(rows[0]?.total) || 0;

    res.json({
      success: true,
      total: total
    });
  } catch (err) {
    console.error('❌ Ошибка получения суммы корзины:', err);
    res.status(500).json({
      success: false,
      error: 'Ошибка сервера'
    });
  }
});

// Корзина - очистка корзины
app.delete('/api/cart', async (req, res) => {
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
    const productsCount = await db.query('SELECT COUNT(*) as count FROM products');
    const categoriesCount = await db.query('SELECT COUNT(*) as count FROM categories');
    const usersCount = await db.query('SELECT COUNT(*) as count FROM users');
    const cartCount = await db.query('SELECT COUNT(*) as count FROM cart_items');
    
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      database: db === client ? 'Supabase PostgreSQL' : 'In-memory хранилище',
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
      error: err.message
    });
  }
});

// Запуск сервера
async function startServer() {
  try {
    await initializeDatabase();
    
    app.listen(PORT, () => {
      console.log(`\n🚀 Сервер запущен на порту ${PORT}`);
      console.log(`📍 http://localhost:${PORT}`);
      console.log(`🗄️ База данных: ${db === client ? 'Supabase PostgreSQL' : 'In-memory хранилище'}`);
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
      console.log(`   GET  /health - Проверка работы`);
    });
  } catch (err) {
    console.error('❌ Не удалось запустить сервер:', err);
    process.exit(1);
  }
}


startServer();
