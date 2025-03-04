require("dotenv").config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");
const cors = require("cors");
const bcrypt = require("bcrypt");
const session = require("express-session");
const cookieParser = require("cookie-parser");
const SQLiteStore = require("connect-sqlite3")(session);

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
    store: new SQLiteStore({ db: "sessions.db", dir: "./", ttl: 86400 }), // 24 小時自動刪除過期 session
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
    `SELECT id, name, roomNumber, COALESCE(phoneNumber, '無資料') AS phoneNumber 
     FROM students WHERE TRIM(group_name) = ?`,
    [groupName.trim()],
    (err, rows) => {
      if (err) {
        console.error("❌ 查詢學生名單失敗:", err.message);
        return res.status(500).json({ error: "無法取得學生名單" });
      }
      console.log("📋 查詢到的學生資料:", rows); // 🛠 Debug
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

  db.serialize(() => {
    let errors = [];
    let alreadyMarked = [];
    let completed = 0;

    // 檢查哪些學生已經點過名
    const studentIds = attendanceData.map(({ student_id }) => student_id);
    db.all(
      `SELECT student_id FROM attendance WHERE date = ? AND student_id IN (${studentIds
        .map(() => "?")
        .join(",")})`,
      [date, ...studentIds],
      (err, rows) => {
        if (err) {
          return res.status(500).json({ error: "❌ 無法檢查點名狀態" });
        }

        // 取得已點名的 student_id
        alreadyMarked = rows.map((row) => row.student_id);

        // 過濾出尚未點名的學生
        const newAttendance = attendanceData.filter(
          ({ student_id }) => !alreadyMarked.includes(student_id)
        );

        if (newAttendance.length === 0) {
          return res.status(409).json({ error: "❌ 已完成點名，請洽系統管理" });
        }

        // 準備插入點名紀錄
        const stmt = db.prepare(
          "INSERT INTO attendance (date, student_id, studentName, status, roomNumber) VALUES (?, ?, ?, ?, ?)"
        );

        newAttendance.forEach(({ student_id, studentName, status }) => {
          db.get(
            "SELECT roomNumber FROM students WHERE id = ?",
            [student_id],
            (err, row) => {
              if (err || !row) {
                errors.push(student_id);
                stmt.run(date, student_id, studentName, status, "N/A");
              } else {
                stmt.run(date, student_id, studentName, status, row.roomNumber);
              }
              completed++;

              if (completed === newAttendance.length) {
                stmt.finalize();
                if (errors.length > 0) {
                  res.status(207).json({
                    success: true,
                    message: `✅ 點名成功，但學生 ID (${errors.join(
                      ", "
                    )}) 未找到房號，已存為 "N/A"。`,
                  });
                } else {
                  res.json({ success: true, message: "✅ 點名成功！" });
                }
              }
            }
          );
        });
      }
    );
  });
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
