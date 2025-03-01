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
app.use(express.static(__dirname));

// 連接 SQLite 資料庫
const db = new sqlite3.Database("./dormitory.db", (err) => {
  if (err) {
    console.error("❌ 無法連接到資料庫:", err.message);
  } else {
    console.log("✅ 已連接到 SQLite 資料庫");
  }
});

// 取得所有學生群組 API
app.get("/api/groups", (req, res) => {
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

// 修正 `/api/students/all` API，確保回傳資料
app.get("/api/students/all", (req, res) => {
  let group = req.query.group;

  if (!group) {
    return res.status(400).json({ error: "請提供 group 參數" });
  }

  group = group.trim();
  console.log(`📢 查詢群組: '${group}'`);

  db.all(
    "SELECT name, roomNumber, phoneNumber FROM students WHERE TRIM(group_name) = TRIM(?) COLLATE NOCASE",
    [group],
    (err, rows) => {
      if (err) {
        console.error("❌ SQL 查詢錯誤:", err.message);
        return res.status(500).json({ error: err.message });
      }
      console.log(`✅ 查詢成功，找到 ${rows.length} 筆資料`);
      if (rows.length === 0) {
        console.warn(`⚠️ 沒有找到任何學生資料`);
      }
      res.json(rows);
    }
  );
});

// 讓 `/` 直接載入 `attendance.html`
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "attendance.html"));
});

// 啟動伺服器
app.listen(port, host, () => {
  console.log(`🚀 伺服器運行於 http://${host}:${port}`);
  console.log("📡 啟動 ngrok 後可透過外部設備存取");
});
