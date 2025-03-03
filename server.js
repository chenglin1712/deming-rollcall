require("dotenv").config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcrypt");
const session = require("express-session");
const ExcelJS = require("exceljs");

const app = express();
const port = process.env.PORT || 3000;
const host = "0.0.0.0"; // ✅ 允許所有 IP 存取，確保 ngrok 可連接

app.use(
  cors({ origin: "*", methods: "GET,POST", allowedHeaders: "Content-Type" })
);
app.use(bodyParser.json());
app.use(express.static(__dirname));

app.use(
  session({
    secret: "secret_key",
    resave: false,
    saveUninitialized: false,
  })
);

// 連接 SQLite 資料庫
const db = new sqlite3.Database("./dormitory.db", (err) => {
  if (err) {
    console.error("❌ 無法連接到資料庫:", err.message);
  } else {
    console.log("✅ 已連接到 SQLite 資料庫");
  }
});

// 建立資料表
db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    display_name TEXT
)`);
db.run(`CREATE TABLE IF NOT EXISTS students (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    roomNumber TEXT,
    phoneNumber TEXT,
    group_name TEXT
)`);
db.run(`CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT,
    student_id INTEGER,
    studentName TEXT,
    status TEXT,
    FOREIGN KEY (student_id) REFERENCES students (id)
)`);

// 預設帳號
const users = [
  { username: "xm2801", password: "admin", display_name: "德銘宿舍羅老師" },
  {
    username: "12130340",
    password: "Yucheng0803",
    display_name: "林煜晟（系統管理）",
  },
  { username: "deming", password: "1234", display_name: "宿舍各樓長" },
];

users.forEach((user) => {
  bcrypt.hash(user.password, 10, (err, hash) => {
    if (!err) {
      db.run(
        `INSERT OR IGNORE INTO users (username, password, display_name) VALUES (?, ?, ?)`,
        [user.username, hash, user.display_name]
      );
    }
  });
});

// **🔒 驗證登入 Middleware**
const requireLogin = (req, res, next) => {
  if (!req.session.user) {
    console.log("🚫 未登入，重定向至 login.html");
    return res.redirect("/login.html");
  }
  next();
};

// **🔐 登入 API**
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res
      .status(400)
      .json({ success: false, message: "請提供帳號與密碼" });
  }

  db.get("SELECT * FROM users WHERE username = ?", [username], (err, user) => {
    if (err || !user) {
      return res
        .status(401)
        .json({ success: false, message: "帳號或密碼錯誤" });
    }
    bcrypt.compare(password, user.password, (err, result) => {
      if (result) {
        req.session.user = {
          username: user.username,
          display_name: user.display_name,
        };
        console.log("✅ 使用者登入成功:", req.session.user);
        res.json({ success: true, user: req.session.user });
      } else {
        res.status(401).json({ success: false, message: "帳號或密碼錯誤" });
      }
    });
  });
});

// **🔐 登出 API**
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true, message: "已成功登出" });
  });
});

// **🔍 驗證登入狀態 API**
app.get("/api/check-login", (req, res) => {
  res.json({ loggedIn: !!req.session.user, user: req.session.user });
});

// **📌 受保護頁面**
const protectedPages = [
  "add_student.html",
  "attendance.html",
  "history.html",
  "index.html",
  "student_list.html",
];
protectedPages.forEach((page) => {
  app.get(`/${page}`, requireLogin, (req, res) => {
    res.sendFile(path.join(__dirname, page));
  });
});

// **📌 取得所有學生群組 API**
app.get("/api/groups", requireLogin, (req, res) => {
  db.all(
    "SELECT DISTINCT TRIM(group_name) as group_name FROM students WHERE group_name IS NOT NULL",
    [],
    (err, rows) => {
      if (err) {
        console.error("❌ 查詢群組名稱錯誤:", err.message);
        return res.status(500).json({ error: err.message });
      }
      res.json(rows.map((row) => row.group_name));
    }
  );
});

// **📌 取得指定群組的學生**
app.get("/api/students/all", requireLogin, (req, res) => {
  let group = req.query.group;

  console.log("📌 接收到的 group 參數:", group);

  if (!group) {
    console.warn("⚠️ 缺少 group 參數");
    return res.status(400).json({ error: "請提供 group 參數" });
  }

  db.all(
    "SELECT id, name, roomNumber, phoneNumber, group_name FROM students WHERE group_name = ? COLLATE NOCASE",
    [group.trim()],
    (err, rows) => {
      if (err) {
        console.error("❌ SQL 查詢錯誤:", err.message);
        return res.status(500).json({ error: err.message });
      }

      console.log("✅ 查詢結果:", rows);
      res.json(rows);
    }
  );
});

// **📌 提交點名 API（防止重複點名）**
app.post("/api/attendance/submit", requireLogin, (req, res) => {
  const { date, group, attendanceData } = req.body;

  if (!date || !group || !attendanceData || !Array.isArray(attendanceData)) {
    return res.status(400).json({ error: "請提供完整的點名資料" });
  }

  const stmt = db.prepare(
    "INSERT INTO attendance (date, student_id, studentName, status) VALUES (?, ?, ?, ?)"
  );

  let duplicateCheckPromises = attendanceData.map(({ student_id }) => {
    return new Promise((resolve, reject) => {
      db.get(
        "SELECT * FROM attendance WHERE date = ? AND student_id = ?",
        [date, student_id],
        (err, row) => {
          if (err) {
            reject(err);
          } else {
            resolve(row);
          }
        }
      );
    });
  });

  Promise.all(duplicateCheckPromises)
    .then((results) => {
      const alreadyMarked = results.filter((r) => r !== undefined);

      if (alreadyMarked.length > 0) {
        return res.status(400).json({
          error: "部分學生已經點名，請勿重複點名！",
          duplicated: alreadyMarked.map((r) => r.studentName),
        });
      }

      attendanceData.forEach(({ student_id, studentName, status }) => {
        stmt.run(date, student_id, studentName, status);
      });

      stmt.finalize();
      res.json({ success: true, message: "點名成功！" });
    })
    .catch((err) => {
      console.error("❌ 查詢點名紀錄錯誤:", err);
      res.status(500).json({ error: "點名過程中發生錯誤" });
    });
});

// **📌 讓 `/` 直接載入 `login.html`**
app.get("/", (req, res) => {
  if (req.session.user) {
    res.redirect("/index.html");
  } else {
    res.redirect("/login.html");
  }
});

// **🚀 啟動伺服器**
app.listen(port, host, () => {
  console.log(`🚀 伺服器運行於 http://${host}:${port}`);
});
