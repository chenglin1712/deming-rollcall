require("dotenv").config();
const express = require("express");
const sqlite3 = require("sqlite3").verbose();
const bodyParser = require("body-parser");
const path = require("path");
const cors = require("cors");
const ExcelJS = require("exceljs");

const app = express();
const port = process.env.PORT || 3000;
const host = process.env.HOST || "192.168.0.115"; // 讓伺服器綁定你的內網 IP

// 設定 CORS 允許外部設備訪問
const corsOptions = {
  origin: "*", // 允許所有網域請求
  methods: "GET,POST",
  allowedHeaders: "Content-Type",
};
app.use(cors(corsOptions));

app.use(bodyParser.json());
app.use(express.static(__dirname)); // 讓 Express 提供靜態檔案

// 連接到 SQLite 資料庫
const db = new sqlite3.Database("./dormitory.db", (err) => {
  if (err) {
    console.error("❌ 無法連接到資料庫:", err.message);
  } else {
    console.log("✅ 已連接到 SQLite 資料庫");
    initDatabase();
  }
});

// 初始化資料庫
function initDatabase() {
  db.run(`CREATE TABLE IF NOT EXISTS students (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        roomNumber TEXT NOT NULL,
        phoneNumber TEXT NOT NULL,
        group_name TEXT NOT NULL
    )`);
  db.run(`CREATE TABLE IF NOT EXISTS attendance (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        student_id TEXT NOT NULL,
        status TEXT NOT NULL,
        FOREIGN KEY (student_id) REFERENCES students (id)
    )`);
  console.log("✅ 資料庫表格已初始化");
}

// 檢查資料庫連接 API
app.get("/api/check-connection", (req, res) => {
  db.get("SELECT sqlite_version() as version", (err, row) => {
    if (err) {
      return res.json({ connected: false, error: err.message });
    }
    res.json({ connected: true, version: row.version });
  });
});

// 獲取學生列表的 API，允許外部設備請求
app.get("/api/students", (req, res) => {
  const group = req.query.group;

  if (!group) {
    console.warn("⚠️ `group_name` 參數缺失，請檢查請求是否正確");
    return res.json([]);
  }

  console.log("🔍 查詢 `group_name`:", group);

  const sql =
    "SELECT id, name, roomNumber, phoneNumber, group_name FROM students WHERE group_name = ?";

  db.all(sql, [group], (err, rows) => {
    if (err) {
      console.error("❌ SQL 查詢錯誤:", err.message);
      return res.status(500).json({ error: err.message });
    }

    console.log("✅ 查詢結果:", rows);
    res.json(rows);
  });
});

// 讓 `/` 直接載入 `attendance.html`
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "attendance.html"));
});

// 啟動伺服器
app.listen(port, host, () => {
  console.log(`🚀 伺服器運行於 http://${host}:${port}`);
});
