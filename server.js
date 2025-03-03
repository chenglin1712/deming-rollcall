require("dotenv").config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcrypt");
const session = require("express-session");
const cookieParser = require("cookie-parser");

const app = express();
const port = process.env.PORT || 3000;
const host = "0.0.0.0"; // ✅ 允許所有 IP 存取

app.use(cookieParser()); // ✅ 解析 cookie

// ✅ 修正 CORS，確保跨網域 session 有效
app.use(
  cors({
    origin: "*", // ✅ 允許任何來源（適用於外網）
    methods: "GET,POST,OPTIONS",
    allowedHeaders: "Content-Type",
    credentials: true, // ✅ 允許攜帶 session
  })
);

app.use(bodyParser.json());
app.use(express.static(__dirname));

app.use(
  session({
    secret: "secret_key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: false, // ✅ `false` 避免 HTTP 無法存取 session
      httpOnly: true,
      maxAge: 24 * 60 * 60 * 1000, // ✅ 確保 session 存活 24 小時
    },
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

// **📌 預設帳號**
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
    return res.status(401).json({ success: false, message: "未登入" }); // ✅ 修改為 401，避免前端錯誤
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
        req.session.save(() => {
          res.json({ success: true, user: req.session.user });
        });
      } else {
        res.status(401).json({ success: false, message: "帳號或密碼錯誤" });
      }
    });
  });
});

// **📌 確認登入狀態 API**
app.get("/api/check-login", (req, res) => {
  console.log("🔍 session 狀態:", req.session.user);
  res.json({ loggedIn: !!req.session.user, user: req.session.user });
});

// **📌 取得學生列表 API**
app.get("/api/students/all", requireLogin, (req, res) => {
  const groupName = req.query.group;
  if (!groupName) {
    return res.status(400).json({ error: "缺少群組名稱" });
  }

  db.all(
    "SELECT id, name, roomNumber FROM students WHERE TRIM(group_name) = ?",
    [groupName.trim()],
    (err, rows) => {
      if (err) {
        console.error("❌ 查詢學生名單失敗:", err.message);
        return res.status(500).json({ error: "無法取得學生名單" });
      }
      if (rows.length === 0) {
        console.warn(`⚠️ 群組 '${groupName}' 沒有學生資料`);
      }
      res.json(rows);
    }
  );
});

// **📌 取得點名群組 API**
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

// **📌 取得歷史點名紀錄 API**
app.get("/api/attendance/history", requireLogin, (req, res) => {
  db.all(
    `SELECT attendance.date, attendance.student_id, attendance.studentName, attendance.status, students.roomNumber 
     FROM attendance 
     LEFT JOIN students ON attendance.student_id = students.id
     ORDER BY attendance.date DESC`,
    [],
    (err, records) => {
      if (err) {
        return res
          .status(500)
          .json({ success: false, message: "❌ 無法取得歷史紀錄" });
      }
      res.json({ success: true, data: records });
    }
  );
});

// **📌 取得可選的點名日期**
app.get("/api/attendance/dates", requireLogin, (req, res) => {
  db.all(
    `SELECT DISTINCT date FROM attendance ORDER BY date DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.error("❌ 無法取得歷史日期:", err.message);
        return res
          .status(500)
          .json({ success: false, message: "無法取得歷史日期" });
      }
      res.json(rows.map((row) => row.date));
    }
  );
});

// **📌 修正點名提交 API**
app.post("/api/attendance/submit", requireLogin, (req, res) => {
  const { date, group, attendanceData } = req.body;

  if (!date || !group || !attendanceData || !Array.isArray(attendanceData)) {
    return res.status(400).json({ error: "請提供完整的點名資料" });
  }

  const stmt = db.prepare(
    "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, ?, ?, ?, ?)"
  );

  attendanceData.forEach(({ student_id, studentName, status }) => {
    db.get(
      "SELECT roomNumber FROM students WHERE id = ?",
      [student_id],
      (err, row) => {
        if (err || !row) {
          stmt.run(date, student_id, studentName, status, "N/A"); // 如果找不到房號則顯示 "N/A"
        } else {
          stmt.run(date, student_id, studentName, status, row.roomNumber);
        }
      }
    );
  });

  stmt.finalize();
  res.json({ success: true, message: "點名成功！" });
});

// **📌 修正受保護頁面**
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

// **📌 修正登入後跳轉 `index.html`**
app.get("/", (req, res) => {
  if (req.session.user) {
    res.sendFile(path.join(__dirname, "index.html"));
  } else {
    res.redirect("/login.html");
  }
});

// **🚀 啟動伺服器**
app.listen(port, host, () => {
  console.log(`🚀 伺服器運行於 http://${host}:${port}`);
});
